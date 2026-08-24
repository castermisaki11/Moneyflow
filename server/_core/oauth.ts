import type { Express, Request, Response } from "express";
import { OAUTH_PROVIDERS, getAuthorizeUrl, exchangeCodeForToken, fetchOAuthUser } from "./oauthProviders";
import { upsertUser, getUserByOpenId } from "../db";
import { signJwt, signRefreshJwt, signOAuthState, verifyOAuthState } from "./jwt";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, REFRESH_COOKIE_NAME, SEVEN_DAYS_MS, THIRTY_DAYS_MS } from "@shared/const";

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
          .redirect(303, "/");
      } catch (error) {
        console.error(`[OAuth] ${provider.label} callback error:`, error);
        res
          .set("Cache-Control", "no-store, no-cache, must-revalidate")
          .redirect(303, "/login?error=oauth_callback");
      }
    });
  }
}
