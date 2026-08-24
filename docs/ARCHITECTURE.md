# Architecture — Moneyflow

ภาพรวมโครงสร้างระบบ แบ่งเป็น 4 ส่วนหลัก: **Web Client → API Server (tRPC) → PostgreSQL** และ **Telegram Bot** ที่ทำงานใน process เดียวกับ server

```
┌─────────────────────┐        ┌──────────────────────────────────┐
│   React Client      │  tRPC  │           Node Server            │
│  (Vite + Tailwind   │◄──────►│  Express + tRPC v11              │
│   + TanStack Query) │superjson│  ├─ routers (tRPC)              │
└─────────────────────┘        │  ├─ telegram.ts (bot core)       │
                               │  └─ scheduler.ts (ทุก 1 นาที)    │
┌─────────────┐                └───────────────┬──────────────────┘
│  Telegram    │◄──── long polling / send ─────┤
│  Cloud API   │                               ▼
└─────────────┘                        ┌──────────────┐
                                       │  PostgreSQL  │
                                       │  (Drizzle)   │
                                       └──────────────┘
```

## 1. Web Client (`client/src`)

- **React 19 + Vite 7** — SPA เดียว ไม่มี SSR
- **wouter** — routing น้ำหนักเบา
- **TanStack Query v5** — data fetching + cache persistence ลง localStorage (`query-sync-storage-persister`)
- **tRPC client + superjson** — type-safe API calls แชร์ types กับ server โดยตรง
- **shadcn/ui (new-york) + Tailwind CSS v4** — component system ดู `components.json`
- **Framer Motion** — animation
- View หลักที่เกี่ยวกับ bot: `views/BotView.tsx` (admin), `views/SettingsView.tsx` (เชื่อม Telegram)

## 2. Server (`server/_core`)

| ไฟล์ | หน้าที่ |
|---|---|
| `index.ts` | Entry point — bind Express, run migrations อัตโนมัติ, start Telegram polling |
| `env.ts` | อ่านค่า environment variables |
| `migrate.ts` | Idempotent SQL migration (รันทุกครั้งที่ start) |
| routers (tRPC) | tRPC routers ต่างๆ เช่น `telegramRouter.ts`, `botRouter.ts` |

## 3. Database (`drizzle/schema.ts` + PostgreSQL)

- Drizzle ORM + `pg` driver
- **Auto-migration:** `server/_core/index.ts` เรียก `runMigrations()` ก่อน listen ทุกครั้ง — ใช้ SQL แบบ `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` (รายละเอียดใน [`../drizzle/README.md`](../drizzle/README.md))
- ตารางหลัก: transactions, budgets, goals, wishlist, recurring, reminders, settings (+ `notificationSettings` JSON), `reminderLog`, `botBroadcastLog`, `categoryFeedback`

## 4. Telegram Bot

Bot ฝังอยู่ใน process ของ server เดียวกัน (long polling ไม่ต้องเปิด port/webhook):

- **Polling loop:** `startTelegramPolling()` — ถ้าไม่ตั้ง `TELEGRAM_BOT_TOKEN` จะข้ามไปเฉยๆ (no-op)
- **Router:** `handleUpdate()` แยก callback query / `/command` / ข้อความอิสระ
- **Natural language:** `parseQuickTransaction` + `guessCategory` เดาหมวดหมู่, `reminderParser.ts` แปลงข้อความเตือนภาษาไทยเป็นวัน-เวลา
- **Timezone:** คำนวณทุกอย่างบนเวลากรุงเทพผ่าน `bangkokTime.ts`
- **Scheduler:** `scheduler.ts` ทำงานทุก 1 นาที ยิงการแจ้งเตือนอัตโนมัติ (รายวัน/รายสัปดาห์/งบ/เป้าหมาย/custom reminder)

Flow ละเอียดทั้งหมดอยู่ใน [`BOT.md`](BOT.md)

## Data Flow สรุป

```
Web user      : Browser → tRPC router → Drizzle → PostgreSQL
Telegram user : Chat → polling → handleUpdate() → logic → DB + reply message
Automation    : scheduler.ts → notifSettings.ts → telegram.ts → Telegram Cloud
Admin         : BotView.tsx → botRouter.ts → botStats.ts / broadcast
```

## Build & Deploy

- `pnpm build` = `vite build` (client → static assets) + esbuild bundle server → `dist/index.js`
- `pnpm start` = รัน `dist/index.js` (NODE_ENV=production)
- Deploy target หลักคือ host แบบ Node long-running (เช่น Render) เพราะ bot ใช้ long polling และ scheduler ใน process เดียว
