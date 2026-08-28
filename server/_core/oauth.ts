import type { Express, Request, Response } from "express";
import { OAUTH_PROVIDERS, getAuthorizeUrl, exchangeCodeForToken, fetchOAuthUser } from "./oauthProviders";
import {
  upsertUser,
  getUserByOpenId,
  listTransactions,
  createTransaction,
  createBudget,
  createGoal,
} from "../db";
import { signJwt, signRefreshJwt, signOAuthState, verifyOAuthState } from "./jwt";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, REFRESH_COOKIE_NAME, SEVEN_DAYS_MS, THIRTY_DAYS_MS, POST_LOGIN_ROUTE } from "@shared/const";

/**
 * Insert a handful of sample rows the first time the shared demo account is
 * used, so the demo actually shows something. Idempotent enough — it only
 * runs when the account has no transactions yet, so repeat logins don't
 * keep piling on duplicate data.
 */
async function seedDemoData(userId: number): Promise<void> {
  const now = Date.now();
  const day = 86_400_000;
  const txs: Array<{
    type: "income" | "expense" | "saving";
    amount: string;
    category: string;
    note: string;
    occurredAt: number;
  }> = [
    { type: "income", amount: "45000.00", category: "เงินเดือน", note: "เงินเดือนประจำเดือน", occurredAt: now - 2 * day },
    { type: "expense", amount: "1200.00", category: "ค่าอาหาร", note: "กาแฟ + ข้าวกลางวัน", occurredAt: now - 1 * day },
    { type: "expense", amount: "350.00", category: "เดินทาง", note: "รถไฟฟ้า", occurredAt: now - 1 * day + 3_600_000 },
    { type: "expense", amount: "8000.00", category: "ค่าเช่า", note: "ค่าเช่าห้อง", occurredAt: now - 5 * day },
    { type: "expense", amount: "540.00", category: "บันเทิง", note: "ดูหนัง", occurredAt: now - 3 * day },
    { type: "saving", amount: "2000.00", category: "ออมเงิน", note: "โอนเข้าฝาก", occurredAt: now - 2 * day },
  ];
  for (const tx of txs) {
    await createTransaction({
      userId,
      type: tx.type,
      amount: tx.amount,
      category: tx.category,
      note: tx.note,
      occurredAt: tx.occurredAt,
    });
  }
  await createBudget({ userId, category: "ค่าอาหาร", limitAmount: "6000.00", period: "monthly" });
  await createBudget({ userId, category: "บันเทิง", limitAmount: "2000.00", period: "monthly" });
  await createGoal({ userId, name: "เที่ยวญี่ปุ่น", targetAmount: "100000.00", savedAmount: "32000.00" });
  await createGoal({ userId, name: "สำรองฉุกเฉิน", targetAmount: "50000.00", savedAmount: "15000.00" });
}

/**
 * Registers `/api/auth/<provider>` + `/api/auth/<provider>/callback` for
 * every entry in OAUTH_PROVIDERS (see oauthProviders.ts). To add a new
 * login provider, add its config there — this file doesn't need to change.
 */
export function registerOAuthRoutes(app: Express) {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    /**
     * Step 1: Initiate OAuth flow
     * GET /api/auth/<provider>
     */
    app.get(`/api/auth/${provider.id}`, async (req: Request, res: Response) => {
      try {
        // Signed, self-contained state token — no server-side memory needed,
        // so a redeploy/restart between here and the callback (or a second
        // server instance behind a load balancer) can't invalidate it.
        const state = await signOAuthState();

        const authorizeUrl = getAuthorizeUrl(provider, state);
        res.redirect(authorizeUrl);
      } catch (error) {
        console.error(`[OAuth] Error initiating ${provider.label} login:`, error);
        res.redirect("/login?error=oauth_init");
      }
    });

    /**
     * Step 2: Handle OAuth callback
     * GET /api/auth/<provider>/callback
     */
    app.get(`/api/auth/${provider.id}/callback`, async (req: Request, res: Response) => {
      try {
        const { code, state, error } = req.query;

        // Handle user denial
        if (error) {
          return res
            .set("Cache-Control", "no-store, no-cache, must-revalidate")
            .redirect(303, "/login?error=denied");
        }

        // Validate code and state
        if (!code || !state || typeof code !== "string" || typeof state !== "string") {
          return res
            .set("Cache-Control", "no-store, no-cache, must-revalidate")
            .redirect(303, "/login?error=invalid_params");
        }

        // Verify CSRF state (signature + 10-minute expiry, no server memory involved)
        const stateValid = await verifyOAuthState(state);
        if (!stateValid) {
          return res
            .set("Cache-Control", "no-store, no-cache, must-revalidate")
            .redirect(303, "/login?error=invalid_state");
        }

        // Exchange code for access token, then fetch + normalize the profile
        const tokenResponse = await exchangeCodeForToken(provider, code);
        const oauthUser = await fetchOAuthUser(provider, tokenResponse.access_token);

        // Upsert user to database
        const openId = `${provider.id}-${oauthUser.id}`;
        await upsertUser({
          openId,
          name: oauthUser.name,
          email: oauthUser.email,
          pictureUrl: oauthUser.picture,
          passwordHash: "",
          loginMethod: provider.id,
        });

        // Fetch the created/updated user
        const user = await getUserByOpenId(openId);
        if (!user) {
          throw new Error("Failed to retrieve user after upsert");
        }

        // Issue JWT tokens
        const token = await signJwt(user.id);
        const refreshToken = await signRefreshJwt(user.id);

        // Set cookies
        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SEVEN_DAYS_MS });
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
          ...cookieOptions,
          maxAge: THIRTY_DAYS_MS,
        });

        // Redirect to home
        res
          .set("Cache-Control", "no-store, no-cache, must-revalidate")
          .redirect(303, POST_LOGIN_ROUTE);
      } catch (error) {
        console.error(`[OAuth] ${provider.label} callback error:`, error);
        res
          .set("Cache-Control", "no-store, no-cache, must-revalidate")
          .redirect(303, "/login?error=oauth_callback");
      }
    });
  }

  /**
   * Demo / Guest login — public, shared account so anyone can try the app
   * without connecting an OAuth provider. Seeds sample data on first use.
   */
  app.get("/api/auth/demo", async (req: Request, res: Response) => {
    try {
      const openId = "demo-guest";
      await upsertUser({
        openId,
        name: "Demo User",
        email: null,
        pictureUrl: null,
        passwordHash: "",
        loginMethod: "demo",
      });

      const user = await getUserByOpenId(openId);
      if (!user) throw new Error("Failed to retrieve demo user after upsert");

      // Seed sample data only the first time (idempotent — skip if not empty).
      const existing = await listTransactions(user.id, { limit: 1 });
      if (existing.length === 0) {
        await seedDemoData(user.id);
      }

      const token = await signJwt(user.id);
      const refreshToken = await signRefreshJwt(user.id);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SEVEN_DAYS_MS });
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
        ...cookieOptions,
        maxAge: THIRTY_DAYS_MS,
      });

      res
        .set("Cache-Control", "no-store, no-cache, must-revalidate")
        .redirect(303, POST_LOGIN_ROUTE);
    } catch (error) {
      console.error(`[Demo] login error:`, error);
      res
        .set("Cache-Control", "no-store, no-cache, must-revalidate")
        .redirect(303, "/login?error=oauth_callback");
    }
  });
}
