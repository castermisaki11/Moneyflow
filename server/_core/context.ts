import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserById } from "../db";
import { COOKIE_NAME, REFRESH_COOKIE_NAME, SEVEN_DAYS_MS } from "@shared/const";
import { verifyJwt, signJwt } from "./jwt";
import { getSessionCookieOptions } from "./cookies";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const { req, res } = opts;
  let user: User | null = null;

  try {
    const token = req.cookies[COOKIE_NAME];
    const refreshToken = req.cookies[REFRESH_COOKIE_NAME];
    
    // ลองใช้ access token ก่อน
    if (token) {
      const payload = await verifyJwt(token);
      if (payload && payload.userId) {
        user = (await getUserById(payload.userId)) ?? null;
      }
    }
    
    // ถ้า access token หมดอายุแต่มี refresh token ให้ออกใหม่
    if (!user && refreshToken) {
      const refreshPayload = await verifyJwt(refreshToken);
      if (refreshPayload && refreshPayload.userId) {
        user = (await getUserById(refreshPayload.userId)) ?? null;
        
        // ออก access token ใหม่
        if (user) {
          const newToken = await signJwt(user.id);
          const cookieOptions = getSessionCookieOptions(req);
          res.cookie(COOKIE_NAME, newToken, { ...cookieOptions, maxAge: SEVEN_DAYS_MS });
        }
      }
    }
  } catch (err) {
    console.error("[Context] JWT verification failed:", err);
    // ถ้า JWT ไม่ถูกต้อง ก็ถือว่าไม่มี user
  }

  return { req, res, user };
}
