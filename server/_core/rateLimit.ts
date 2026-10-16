import rateLimit from "express-rate-limit";

/**
 * Backstop against scripted abuse / DoS on the tRPC API. Generous enough not
 * to bother normal usage (the SPA fires several batch requests per navigation,
 * and a bad connection reconnecting to SSE is excluded by the mount point).
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300,
  standardHeaders: true, // RateLimit-* response headers
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests, please try again later." },
});

/**
 * Stricter limiter for the OAuth login/callback endpoints. These start
 * a login flow and hit Google's API, so they're both the most sensitive to
 * brute-force/credential-stuffing-style abuse and the most expensive to let
 * someone hammer.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many login attempts, please try again later." },
});
