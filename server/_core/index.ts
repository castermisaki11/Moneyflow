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
import { startTelegramPolling } from "./telegram";
import { linkTelegramChat } from "./notifSettings";
import { startScheduler, runNotificationChecks } from "./scheduler";
import { ENV } from "./env";
import { subscribeUser, registerConnection } from "./events";
import { verifyJwt } from "./jwt";
import { COOKIE_NAME } from "@shared/const";

async function startServer() {
  await runMigrations();

  // Telegram notification system — no-op if TELEGRAM_BOT_TOKEN isn't set.
  // Long-polling handles /start <code> account-linking messages; the
  // scheduler runs the periodic checks (daily reminder, budget, recurring,
  // goal alerts) and pushes them to each linked user's chat.
  startTelegramPolling((userId, chatId) => linkTelegramChat(userId, chatId));
  startScheduler();

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

  // External-cron wake/check endpoint. On hosts that idle the process when no traffic
  // arrives (e.g. Render free tier), the in-process setInterval scheduler pauses along
  // with everything else, so a reminder due while the server was asleep never fires.
  // Point an external cron (cron-job.org, UptimeRobot, GitHub Actions schedule, ...) at
  // this URL every 5-10 min — the inbound request wakes the dyno and this handler runs
  // the same checks the scheduler would have. Set CRON_SECRET in production so it can't
  // be triggered by anyone who finds the URL.
  app.get("/api/cron/check-notifications", async (req, res) => {
    if (ENV.cronSecret && req.query.secret !== ENV.cronSecret) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    try {
      await runNotificationChecks();
      res.json({ ok: true, checkedAt: new Date().toISOString() });
    } catch (err) {
      console.warn("[Cron] check-notifications failed:", err);
      res.status(500).json({ ok: false });
    }
  });

  // Real-time sync: web tabs (and the native app) hold this connection open and
  // get pushed an event the instant any of their data changes server-side — most
  // importantly when the Telegram bot adds/edits a transaction from outside the
  // open tab, which the client's own cache invalidation can't see on its own.
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
      "X-Accel-Buffering": "no", // เผื่อรันหลัง nginx/reverse proxy ที่ชอบบัฟเฟอร์ response
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
      // emittedAt: ใช้คำนวณ latency ฝั่ง client (หน้า admin > วัดผล)
      // ห่อ res.write ด้วย try/catch เอง (เป็นด่านที่ 2 ต่อจาก try/catch ใน
      // emitUserEvent) — ถ้า connection นี้ตายไปแล้วแต่ยังไม่ทัน cleanup ก็
      // เก็บกวาดทิ้งเลย แทนที่จะปล่อยให้ error หลุดออกไปรบกวน request อื่น
      try {
        res.write(`event: sync\ndata: ${JSON.stringify({ entity, emittedAt: Date.now() })}\n\n`);
      } catch (err) {
        console.warn("[events] SSE write failed, closing dead connection:", err);
        cleanup();
      }
    });

    // ping กันบาง proxy/เบราว์เซอร์ตัดการเชื่อมต่อตอนไม่มี traffic นานๆ
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

  // On Render (and most PaaS) the platform injects PORT and expects the app
  // to bind exactly that port. Never fall back to a different port in production.
  const port = parseInt(process.env.PORT || "3000");

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
