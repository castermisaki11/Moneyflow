import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { apiLimiter, authLimiter } from "./rateLimit";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { runMigrations } from "./migrate";
import { subscribeUser, registerConnection } from "./events";
import { signJwt, signRefreshJwt, verifyJwt } from "./jwt";
import { COOKIE_NAME, REFRESH_COOKIE_NAME, SEVEN_DAYS_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";

async function startServer() {
  await runMigrations();

  const app = express();
  const server = createServer(app);

  // Behind a reverse proxy (Render/nginx) `req.ip` is the proxy itself unless
  // we declare how many hops to trust. Without this the rate limiter would
  // count every visitor as one single client and lock the whole app out.
  // Only enabled outside dev so a direct client can't spoof X-Forwarded-For.
  if (process.env.NODE_ENV !== "development") app.set("trust proxy", 1);

  // CORS — the SPA is served by this very same server, so real traffic is
  // same-origin and needs no CORS headers at all. What is allowed to send
  // cross-origin requests:
  //   * no Origin header          (curl, SSE, the native shell)
  //   * this server's own host    (browsers send Origin on same-origin POST)
  //   * capacitor://              (native shell)
  //   * localhost / 10.0.2.2      (local dev, Android emulator)
  //   * ALLOWED_ORIGINS           (comma separated exact matches)
  // Everything else is refused: the requests below carry `credentials`, so
  // an allow-all policy would let any website act on a logged-in session.
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      let ok = allowedOrigins.has(origin);
      if (!ok) {
        try {
          const url = new URL(origin);
          ok =
            url.host === req.headers.host ||
            url.protocol === "capacitor:" ||
            url.hostname === "localhost" ||
            url.hostname === "127.0.0.1" ||
            url.hostname === "10.0.2.2";
        } catch {
          ok = false;
        }
      }
      if (ok) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
      }
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, X-TRPC-Source"
      );
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser());

  // Rate limiting: tight on login (it starts an OAuth flow and hits Google),
  // generous on the tRPC API. `/api/events` (SSE) is deliberately left out —
  // reconnects on a flaky connection would otherwise burn its budget fast.
  app.use("/api/auth", authLimiter);
  registerOAuthRoutes(app);

  // Real-time sync: web tabs (and the native app) hold this connection open and
  // get pushed an event the instant any of their data changes server-side.
  // See server/_core/events.ts + cache/index.ts (invalidateUser).
  app.get("/api/events", async (req, res) => {
    let userId: number | undefined;
    try {
      const token = req.cookies[COOKIE_NAME];
      const payload = token ? await verifyJwt(token) : null;
      userId = payload?.userId as number | undefined;
    } catch {
      // treat as unauthenticated below
    }

    if (!userId) {
      res.status(401).end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");

    const releaseConnection = registerConnection();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(ping);
      unsubscribe();
      releaseConnection();
    };

    const unsubscribe = subscribeUser(userId, (entity) => {
      try {
        res.write(`event: sync\ndata: ${JSON.stringify({ entity, emittedAt: Date.now() })}\n\n`);
      } catch (err) {
        console.warn("[events] SSE write failed, closing dead connection:", err);
        cleanup();
      }
    });

    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch (err) {
        console.warn("[events] SSE ping failed, closing dead connection:", err);
        cleanup();
      }
    }, 20_000);

    req.on("close", cleanup);
  });

  app.use("/api/trpc", apiLimiter);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "3000");

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
