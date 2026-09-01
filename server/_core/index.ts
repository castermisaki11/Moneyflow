import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
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
  
  // อนุญาตให้แอป Native และโดเมนอื่นๆ เชื่อมต่อเข้ามาได้
  app.use(cors({
    origin: (origin, callback) => {
      // ในแอป Native (Android/iOS) origin อาจจะเป็น null หรือ capacitor://
      // เพื่อความเสถียรในช่วงแรก เราจะอนุญาตให้เชื่อมต่อได้
      if (!origin || 
          origin.startsWith('http://localhost') || 
          origin.startsWith('capacitor://') || 
          origin.startsWith('http://10.0.2.2')) {
        callback(null, true);
      } else {
        // คุณสามารถระบุโดเมนจริงของคุณที่นี่เพื่อความปลอดภัย
        callback(null, true); 
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-TRPC-Source']
  }));

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser());
  registerStorageProxy(app);
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
