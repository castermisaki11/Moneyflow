import rateLimit from "express-rate-limit";

/**
 * General limiter for all /api/* traffic — a broad backstop against
 * scripted abuse / DoS. Generous enough not to bother normal usage
 * (the SPA fires several tRPC batch requests per navigation).
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
 * a login flow and hit Discord's API, so they're both the most
 * sensitive to brute-force/credential-stuffing-style abuse and the
 * most expensive to let someone hammer.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many login attempts, please try again later." },
});

/**
 * Looser but present limiter for the external cron ping endpoint.
 * It's already gated by CRON_SECRET when set, but this caps damage
 * if the secret is unset/leaked or an external cron misfires.
 */
export const cronLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests." },
});
