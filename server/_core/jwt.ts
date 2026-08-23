import { SignJWT, jwtVerify } from "jose";
import { TextEncoder } from "util";

// JWT_SECRET is the signing secret used by the authentication system.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined in environment variables");
}

const secret = new TextEncoder().encode(JWT_SECRET);

export async function signJwt(userId: number): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d") // Token expires in 7 days for persistent login
    .sign(secret);
}

export async function signRefreshJwt(userId: number): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d") // Refresh token expires in 30 days
    .sign(secret);
}

/**
 * Signs a short-lived, self-contained OAuth CSRF state token.
 *
 * This replaces storing the state in an in-memory Map on the server:
 * a Map doesn't survive a server restart/redeploy, and doesn't work
 * across multiple instances behind a load balancer either — if the
 * process that issued the state isn't the one that handles the
 * callback, "invalid_state" fires even though the login attempt was
 * completely legitimate. Signing the state instead means *any*
 * instance holding JWT_SECRET can verify it, and a restart mid-login
 * no longer breaks anything.
 */
export async function signOAuthState(): Promise<string> {
  return new SignJWT({ purpose: "oauth_state" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m") // must be used within 10 minutes of starting login
    .sign(secret);
}

export async function verifyOAuthState(state: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(state, secret);
    return payload.purpose === "oauth_state";
  } catch (error) {
    return false;
  }
}

export async function verifyJwt(token: string): Promise<{ userId: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as { userId: number };
  } catch (error) {
    return null;
  }
}
