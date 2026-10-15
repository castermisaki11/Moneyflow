# Architecture — Moneyflow

ภาพรวมโครงสร้างระบบ แบ่งเป็น 3 ส่วนหลัก: **Web Client → API Server (tRPC + REST) → PostgreSQL**

```
┌──────────────────────────────┐
│       React Client          │  SPA (PWA)
│  Vite + Tailwind + shadcn   │
│  TanStack Query (persist)   │
│  Service Worker / IndexedDB │◄── offline queue
└──────────────┬───────────────┘
               │ tRPC (superjson)         SSE push
               │ /api/trpc                /api/events
┌──────────────▼───────────────────────────────┐
│              Node Server (Express)           │
│  ├─ routers.ts      tRPC routers (ทุก business│
│  │                   logic: tx, budget, goal, │
│  │                   recurring, settings, auth│
│  │                   , admin)                │
│  ├─ _core/oauth*    Google OAuth  (/api/auth) │
│  ├─ _core/cache     in-memory cache + invalidate│
│  ├─ _core/events    SSE connection manager    │
│  ├─ _core/migrate   idempotent SQL (run ก่อน start)│
│  ├─ _core/pin       PIN lock (scrypt)         │
│  └─ _core/vite       dev middleware / static   │
└──────────────┬───────────────────────────────┘
               │ Drizzle ORM (node-postgres)
┌──────────────▼──────────────┐
│        PostgreSQL           │
└─────────────────────────────┘
```

## 1. Web Client (`client/src`)

- **React 19 + Vite 7** — SPA เดียว ไม่มี SSR (`root: client/`)
- **Routing** — `wouter`: `/login`, `/` (หน้าหลัก, มี `ProtectedRoute` + PIN lock), `/404`
  - ไม่มี route ต่อแท็บ — แท็บทั้งหมดอยู่ใน `/` และสลับด้วย state (`dashboard`, `transactions`, `budgets`, `recurring`, `report`, `data`, `settings`, `account`, `metrics` [แอดมินเท่านั้น])
  - deep-link ผ่าน query `/?tab=account` (ใช้ตอน login สำเร็จ → `POST_LOGIN_ROUTE`)
- **TanStack Query v5** — data fetching + cache persist ลง localStorage (`query-sync-storage-persister`, อายุ 24 ชม.)
  - `auth.me` ถูกกันไม่ให้ persist ตั้งใจ (กันค่า "ยังไม่ login" เก่าๆ ดันหน้า login กลับมา)
- **tRPC client + superjson** — type-safe API, แชร์ types กับ server ตรง (`AppRouter`)
- **shadcn/ui (new-york) + Tailwind CSS v4** ผ่าน `@tailwindcss/vite`
  - `client/src/components/ui/index.ts` re-export พวกการ์ด + ปุ่ม (`PrimaryButton`, `OutlineButton`, `EmptyState`)
  - สไตล์แบ่งไฟล์: `index.css` (Tailwind + ธีม), `styles/ui.css` (import ใน `main.tsx`), `styles/moneyflow.css`, `styles/print.css` (ใช้ตอน export รายงาน)
- **Recharts** — `views/DashboardCharts.tsx` วาดกราฟในแดชบอร์ด (timeline / แยกตามหมวด / วงกลมสัดส่วน)
- **Framer Motion** — animation
- **Real-time** — `useLiveSync` เปิด SSE ไป `/api/events` แล้ว invalidate query ตาม entity ที่ server รายงาน (มี backoff + reconnect เมื่อ tab กลับมา)
- **Offline** — `client/public/sw.js` (v4): cache-first สำหรับหน้าแอป, และ intercept `transactions.create` ตอน offline → เก็บลง IndexedDB แล้ว flush ด้วย Background Sync

### Path aliases

- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`
- `@assets/*` → `attached_assets/`

## 2. Server

### 2.1 HTTP endpoints (Express ล้วน)

| Method/Path | หน้าที่ |
|---|---|
| `ALL /api/trpc/*` | tRPC adapter (หลักของทุกอย่าง) |
| `GET /api/events` | SSE — push `sync` event เมื่อข้อมูลผู้ใช้ถูกเปลี่ยน (ต้องมี cookie ถูกต้อง, ตัดการเชื่อมต่อถ้า cookie หมดอายุ) |
| `GET /api/auth/google` | เริ่ม OAuth → redirect ไป Google |
| `GET /api/auth/google/callback` | แลก code → upsert user → ตั้ง cookie → redirect `/?tab=account` |
| static `/assets/*`, `index.html` | production: serve จาก `dist/public` (cache แบบ immutable สำหรับ assets ที่มี hash) |
| dev middleware | development: Vite middleware + HMR ผ่าน server เดียวกัน |

**หมายเหตุ**
- มี endpoint สำหรับ OAuth provider เดียวคือ `google` (`OAUTH_PROVIDERS` มีแค่ `google` — ดูจาก `oauthProviders.ts`)
- **ไม่มี cron/scheduler ในฝั่ง server** — ไม่มี endpoint `cron` จริง และไม่มี `setInterval` ที่ทำงานตามเวลา (มีแค่ ping keep-alive ของ SSE ใน `index.ts`) → รายการประจำ/การแจ้งเตือนจะไม่ถูกประมวลผลอัตโนมัติ ต้องกด `recurring.runNow` เอง
- `storageProxy.ts` เป็น no-op (ไฟล์ R2 เสิร์ฟผ่าน public URL ตรงๆ)
- `rateLimit.ts` มี `apiLimiter` / `authLimiter` / `cronLimiter` ระบุไว้ แต่ **ยังไม่ถูก `app.use` ที่ไหน**

### 2.2 tRPC routers (`server/routers.ts` + `_core/*Router.ts`)

| Router |  Procedures | หน้าที่ |
|---|---|---|
| `auth` | `me`, `logout`, `updateName` | session, แก้ชื่อ (แก้แล้วจะไม่ถูก OAuth ทับตอน login ใหม่) |
| `transactions` | `list`, `create`, `update`, `remove` | กรองตาม type/category/ช่วงวัน, cache + SSE invalidate |
| `budgets` | `list`, `create`, `remove` | งบรายหมวด (period: daily/weekly/monthly/yearly) |
| `goals` | `list`, `create`, `addAmount`, `remove` | เป้าหมายออม |
| `recurring` | `list`, `create`, `remove`, `runNow` | รายการประจำ — `runNow` สร้างรายการแล้วดัน `nextDate` |
| `settings` | `get`, `update` | currency/theme/categories/account number (คืนค่า **ไม่มี** `pinHash`) |
| `admin` | `listUsers`, `setUserRole`, `deleteUser` | กันลบ/ลดสิทธิ์ตัวเอง, กันลดสิทธิ์แอดมินคนสุดท้าย |
| `security` | `status`, `setPin`, `disablePin`, `verifyPin` | PIN lock (มี lockout ใน memory) |
| `system` | `health`, `cacheStats`, `syncStats`, `syncTrend` | health check + สถิติ (3 ตัวหลังเป็น admin) |

Middleware ระดับ `server/_core/trpc.ts`:
- `publicProcedure` — ไม่เช็คอะไร
- `protectedProcedure` — ต้องมี user (cookie ถูกต้อง) ไม่งั้น `UNAUTHORIZED`
- `adminProcedure` — `role === 'admin'` ไม่งั้น `FORBIDDEN`

### 2.3 โมดูลสำคัญใน `server/_core/`

| ไฟล์ | หน้าที่ |
|---|---|
| `index.ts` | Entry point — CORS, cookie, SSE, tRPC mount, **`runMigrations()` ก่อน listen**, port จาก `PORT` (default 3000) |
| `oauthProviders.ts` | config ผู้ให้บริการ (ตอนนี้มี `google`) + `getAuthorizeUrl` / `exchangeCodeForToken` / `fetchOAuthUser` |
| `oauth.ts` | register route OAuth ให้ครบทุก provider ใน `OAUTH_PROVIDERS` (loop) — ปัจจุบันมีแค่ `GET /api/auth/google` + `/callback` |
| `env.ts` | `ENV` + `isAdminOpenId()` (เช็ค `OWNER_OPEN_ID` และ `ADMIN_<PROVIDER>_IDS`) |
| `jwt.ts` | sign/verify access + refresh + OAuth state (HS256 ผ่าน `jose`) |
| `cookies.ts` | ตัวเลือก cookie (HttpOnly, Secure, SameSite) |
| `migrate.ts` | SQL idempotent ทั้งหมด + drop ของที่ถูกถอด (Telegram, attachments ฯลฯ) |
| `cache/` | in-memory cache + `invalidateUser()` → ยิง SSE ด้วย |
| `events.ts` | จัดการ connection SSE ต่อ user + สถิติ |
| `syncLog.ts` | เก็บ event ลง `sync_event_log` สำหรับกราฟแนวโน้มในหน้า Metrics |
| `pin.ts` | hash/verify PIN ด้วย scrypt + lockout 5 ครั้ง/30 วิ |
| `securityRouter.ts`, `systemRouter.ts` | tRPC sub-router |
| `dbConnection.ts` | connection เดียวทั้ง process (lazy) |
| `vite.ts` | dev: Vite middleware / prod: static + cache headers |
| `bangkokTime.ts`, `pacing.ts`, `reminderParser.ts`, `format.ts` | ตัวช่วยคำนวณเวลา/รูปแบบ — **ตอนนี้ไม่มีที่ไหน import** (เหลือจากการถอด Telegram) |

## 3. Database (`drizzle/schema.ts` + PostgreSQL)

Drizzle ORM + `pg` driver

- **Auto-migration:** `server/_core/index.ts` เรียก `runMigrations()` ก่อน listen ทุกครั้ง — SQL แบบ `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `DROP ... IF EXISTS` ทำงานได้ทั้ง DB เปล่าและ DB เดิม
- ตารางที่ `SETUP_SQL` สร้าง: `app_config`, `users`, `transactions`, `budgets`, `goals`, `recurring`, `settings`, `sync_event_log`
- ตารางที่ถูก **drop** ตอน start (ของที่ถูกถอดไป): `attachments`, `category_feedback`, `reminder_log`, `bot_broadcast_log`, `wishlist`, คอลัมน์ `settings.notificationSettings`
- Index สำคัญ: `tx_user_idx`, `tx_user_occurred_idx` (query ตาม user + ช่วงวัน)

> แก้ `schema.ts` แล้วต้องเพิ่ม SQL ที่ match กันใน `SETUP_SQL` ด้วยมือ — ดู [`drizzle/README.md`](../drizzle/README.md)

## 4. Data Flow สรุป

**อ่าน**
```
Browser → tRPC query → middleware (auth/admin) → db.ts (check cache)
        → miss? → Drizzle → PostgreSQL → เก็บ cache → คืน client
```

**เขียน (เช่นเพิ่มรายการ)**
```
Client mutation → tRPC → db.ts → INSERT → invalidateUser(entity)
                   → cache ถูกล้าง → SSE push "/api/events"
                   → ทุกแท็บของผู้ใช้คนนั้น invalidate query ตาม entity → UI อัปเดต
```

**Offline**
```
transactions.create ตอน offline → SW เก็บ IndexedDB → Background Sync
→ กลับมาออนไลน์ → flush queue → server ประมวลผลปกติ (cache/SSE ตามเดิม)
```

**Login (Google)**
```
GET /api/auth/google → sign state → redirect ไป Google
→ callback → verify state → แลก token → ดึง profile
→ upsert user (openId = "google-<id>") → set cookie (access 7 วัน / refresh 30 วัน)
→ redirect /?tab=account
```

## 5. Build & Deploy

- `pnpm build` = `vite build` (client → `dist/public`) + `esbuild` bundle server → `dist/index.js`
- `pnpm start` = `NODE_ENV=production node dist/index.js`
- production: `serveStatic()` เสิร์ฟ `dist/public`
  - `/assets/*` → `max-age=1y, immutable` (มี hash ในชื่อไฟล์)
  - ไฟล์อื่น (icons, sw.js, manifest) → `1h` + `stale-while-revalidate=1d`
  - `index.html` → `no-cache` เสมอ (กัน deploy เก่าค้าง)

## 6. งานค้าง / จุดที่ควรรู้

- **rate limiter ยังไม่ได้ mount** — `apiLimiter`/`authLimiter`/`cronLimiter` มีใน `rateLimit.ts` แต่ไม่มี `app.use(...)`
- **โค้ดกำพร้าจากการถอด Telegram** — `pacing.ts`, `reminderParser.ts`, `format.ts`, `bangkokTime.ts` (ถูก import โดย 2 ไฟล์แรกเท่านั้น ซึ่งไม่มีที่ไหน import → ทั้ง chain ตาย), `NotificationBell.tsx` (ยังไม่มีที่ไหน import), และคอมเมนต์/ข้อความที่ยังอ้าง Telegram ใน `useLiveSync.ts`, `MetricsView.tsx`, `MoneyFlow.tsx` (ไอคอนสลิป), `Login.tsx` (footer)
- **ตารางที่ถูก drop เพิ่มเติม:** `wishlist` (ฟีเจอร์ถูกถอดออกแล้ว)
- **หน้า Settings: ตัวเลือกการแจ้งเตือนไม่ persist** — `notificationSettings` ถูก drop ออกจาก DB แล้ว แต่ UI ยังอยู่ และ `saveNotif()` ยิง `update.mutate({})` เปล่าๆ
- **`MoneyFlow.tsx` ยังอ้าง `/api/attachments/<id>`** แต่ route นี้ถูกลบไปแล้ว (มีแค่ตอน `attachmentId` มีค่า ซึ่งตอนนี้ไม่มีทางเกิด)
- **`rateLimit.ts` / `storageProxy.ts`** เป็นตัวอย่างโค้ดที่เตรียมไว้แต่ยังไม่ได้ใช้
- CORS ใน `index.ts` อนุญาตทุก origin (`callback(null, true)`) — ควรจำกัดก่อน deploy สาธารณะ
- ไม่มี `.env.example` ใน repo
