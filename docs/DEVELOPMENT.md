# Development Guide — Moneyflow

## ความต้องการของระบบ

- **Node.js ≥ 20**
- **pnpm ≥ 10** (กำหนดไว้ใน `packageManager` ของ package.json)
- **PostgreSQL** database

## การติดตั้ง

```bash
pnpm install
```

> บน filesystem ที่ไม่รองรับ symlink (เช่น sdcard ของ Android/Termux) `pnpm install` จะล้มเหลวด้วย `EACCES` — ให้ copy โปรเจกต์ไปติดตั้งที่ home directory จริง (เช่น `/root`) ก่อน

## Environment Variables

คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่าจริง — `cp .env.example .env` (`.env` อยู่ใน `.gitignore` แล้ว)

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string ของ PostgreSQL เช่น `postgres://user:pass@host:5432/moneyflow` |
| `JWT_SECRET` | ✅ | Secret สำหรับ sign JWT (cookie session) — **ไม่ตั้งจะ start server ไม่ได้** (`jwt.ts` throw ตอน import) |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | ✅ | Callback URL เช่น `http://localhost:3000/api/auth/google/callback` — ต้องตรงกับที่ตั้งใน Google Cloud Console |
| `PORT` | ⬜ | Port ของ server (default `3000`) |
| `NODE_ENV` | ⬜ | `development` / `production` (set ให้อัตโนมัติโดย scripts) |
| `OWNER_OPEN_ID` | ⬜ | openId ของเจ้าของ (รูป `google-<user-id>`) → ได้สิทธิ์ admin |
| `ADMIN_GOOGLE_IDS` | ⬜ | รายชื่อ Google user id ที่ได้สิทธิ์ admin คั่นด้วย `,` เช่น `109...,207...` |
| `ALLOWED_ORIGINS` | ⬜ | origin เพิ่มเติมที่อนุญาตให้ยิง cross-origin คั่นด้วย `,` (ปกติไม่ต้องตั้ง เพราะ SPA ถูกเสิร์ฟจาก server เดียวกัน) |
| `VITE_ANALYTICS_ENDPOINT` | ⬜ | ปลายทาง analytics (umami) — ต้อง uncomment `<script>` ใน `client/index.html` ด้วย |
| `VITE_ANALYTICS_WEBSITE_ID` | ⬜ | Website ID ของ analytics |

> **หมายเหตุสำคัญ:** ถ้า `GOOGLE_*` ไม่ครบ หน้า login จะกดปุ่ม Google แล้วเด้งกลับ `/login?error=oauth_init` ทันที (server ตั้ง URL authorize ไม่ได้) — ไม่มีวิธี login ทางเลือกอื่นสำรอง
>
> สิทธิ์ admin ถูกเช็คทุกครั้งที่ login (`isAdminOpenId` ใน `server/_core/env.ts`) จึงแก้ env แล้วมีผลรอบ login ถัดไป ไม่ต้องแก้ DB

## Scripts ที่ใช้บ่อย

```bash
pnpm dev          # dev server แบบ watch (tsx watch server/_core/index.ts) — Vite HMR ผ่าน port เดียวกัน
pnpm build        # vite build → dist/public + esbuild bundle server → dist/index.js
pnpm start        # NODE_ENV=production node dist/index.js
pnpm typecheck    # tsc --noEmit
pnpm check        # เหมือน typecheck
pnpm test         # vitest run (DB ถูก mock ไม่ต้องมี Postgres)
pnpm format       # prettier --write .
pnpm db:push      # (optional) drizzle-kit generate + migrate
```

Server dev รันที่ `http://localhost:3000` — ทั้ง client และ API อยู่ port เดียวกัน (Vite middleware ผ่าน Express)

## Database & Migrations

**ไม่ต้องรัน migration manual** — server เรียก `runMigrations()` (idempotent SQL) ทุกครั้งที่ start ทำงานได้ทั้ง database เปล่าและ database เดิม

### เมื่อแก้/เพิ่ม schema ใน `drizzle/schema.ts`

1. แก้ไฟล์ `drizzle/schema.ts`
2. **เพิ่ม SQL ที่ match กันลงใน `SETUP_SQL` ใน `server/_core/migrate.ts` ด้วยมือ:**
   - ตารางใหม่ → `CREATE TABLE IF NOT EXISTS ...`
   - column ใหม่ → `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
   - enum value ใหม่ → `ALTER TYPE ... ADD VALUE IF NOT EXISTS ...`
   - ลบของ → `DROP TABLE/COLUMN IF EXISTS ...`
3. Commit — deploy ถัดไปจะ apply ให้อัตโนมัติ

รายละเอียดเพิ่มเติมใน [`../drizzle/README.md`](../drizzle/README.md)

## Workflow การพัฒนา

1. แก้ client (`client/src`) และ/หรือ server (`server/`)
2. แชร์ logic/type ผ่าน tRPC — router ฝั่ง server define แล้ว client เรียกผ่าน `@trpc/react-query` ได้ทันทีแบบ type-safe
   - เพิ่ม field ใน response → แก้ router อย่างเดียว types ฝั่ง client ตามเอง
   - เพิ่ม input ใหม่ → ใช้ `zod` schema ใน router เดียวกัน
3. **ถ้าเพิ่ม/แก้ตาราง** → อย่าลืมขั้นตอน migration ด้านบน
4. ก่อน commit: `pnpm typecheck && pnpm test`
5. Format code: `pnpm format`

## Testing

- Vitest environment `node`, ครอบคลุม `server/**/*.test.ts`
- `server/moneyflow.test.ts` (7 tests) **mock `server/db` ทั้งหมด** — จึงรันได้โดยไม่ต้องมี Postgres
- ครอบคลุม: สร้าง/ลบ transaction, validation, การแยกข้อมูลรายคน (isolation), goal + เพิ่มเงิน, recurring `runNow`, settings

## โครงสร้าง path aliases (shadcn/ui + tsconfig)

จาก `tsconfig.json` / `components.json`:

- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`
- `@assets/*` → `attached_assets/*` (เหลือแค่ใน `vite.config.ts` — ไม่มีโค้ดที่ไหน import และโฟลเดอร์ไม่มีอยู่จริง)
- `@/components/ui` → shadcn ui components
- `@/lib/utils` → utilities (`clsx` + `tailwind-merge`)

## ข้อควรรู้

- **Tailwind CSS ใช้ v4** (ผ่าน `@tailwindcss/vite` plugin) + `tw-animate-css`
- **React Query cache persist ลง localStorage** ผ่าน `query-sync-storage-persister` (อายุ 24 ชม., ตัด session query ออกตอน dehydrate)
- **Timezone** — ไม่มีการบังคับ timezone ฝั่ง server: เก็บ `occurredAt`/`nextDate` เป็น epoch ms และทุกอย่างคิดตาม timezone ของเครื่อง client (`dateInputToTs` ใช้ local noon กันเพี้ยน) — ไม่มี module ช่วยแปลง timezone ฝั่ง server (`bangkokTime.ts` ถูกลบไปแล้วพร้อมโค้ดกำพร้าที่ import มัน)
- **เรื่องที่ควรรู้ขณะพัฒนา** (ดูรายละเอียดใน [`ARCHITECTURE.md` §6](ARCHITECTURE.md)):
  - **Rate limiting mount แล้ว** — `authLimiter` ที่ `/api/auth` (20/15 นาที), `apiLimiter` ที่ `/api/trpc` (300/15 นาที) และ `/api/events` (SSE) ตั้งใจไม่จำกัด
  - **CORS เป็น allowlist** — origin ที่ host ตรงกับ server + `capacitor://` + localhost/Android emulator + รายการใน `ALLOWED_ORIGINS` เท่านั้น
  - alias `@assets/*` ยังประกาศใน `vite.config.ts` ชี้ไป `attached_assets/` ที่ไม่มีอยู่จริง และไม่มีโค้ดที่ไหน import
  - ไม่มี automated test ฝั่ง client (มีแค่ `server/moneyflow.test.ts`)
