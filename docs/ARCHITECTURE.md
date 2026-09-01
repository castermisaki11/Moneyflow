# Architecture — Moneyflow

ภาพรวมโครงสร้างระบบ แบ่งเป็น 3 ส่วนหลัก: **Web Client → API Server (tRPC) → PostgreSQL**

```
┌─────────────────────┐        ┌──────────────────────────────────┐
│   React Client      │  tRPC  │           Node Server            │
│  (Vite + Tailwind   │◄──────►│  Express + tRPC v11              │
│   + TanStack Query) │superjson│  ├─ routers (tRPC)              │
└─────────────────────┘        │  └─ core modules                │
                               └───────────────┬──────────────────┘
                                               ▼
                                       ┌──────────────┐
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

## 2. Server (`server/_core`)

| ไฟล์ | หน้าที่ |
|---|---|
| `index.ts` | Entry point — bind Express, run migrations อัตโนมัติ |
| `env.ts` | อ่านค่า environment variables |
| `migrate.ts` | Idempotent SQL migration (รันทุกครั้งที่ start) |
| routers (tRPC) | tRPC routers ต่างๆ |

## 3. Database (`drizzle/schema.ts` + PostgreSQL)

- Drizzle ORM + `pg` driver
- **Auto-migration:** `server/_core/index.ts` เรียก `runMigrations()` ก่อน listen ทุกครั้ง — ใช้ SQL แบบ `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
- ตารางหลัก: transactions, budgets, goals, recurring, settings

## Data Flow สรุป

```
Web user: Browser → tRPC router → Drizzle → PostgreSQL
```

## Build & Deploy

- `pnpm build` = `vite build` (client → static assets) + esbuild bundle server → `dist/index.js`
- `pnpm start` = รัน `dist/index.js` (NODE_ENV=production)
