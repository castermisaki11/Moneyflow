# Development Guide — Moneyflow

## ความต้องการของระบบ

- **Node.js ≥ 20**
- **pnpm ≥ 10** (กำหนดไว้ใน `packageManager` ของ package.json)
- **PostgreSQL** database

## การติดตั้ง

```bash
pnpm install
```

## Environment Variables

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string ของ PostgreSQL เช่น `postgres://user:pass@host:5432/moneyflow` |
| `JWT_SECRET` | ✅ | Secret สำหรับ sign JWT (auth ของเว็บ) |
| `PORT` | ⬜ | Port ของ server (default ตาม host) |
| `NODE_ENV` | ⬜ | `development` / `production` (set ให้อัตโนมัติโดย scripts) |

## Scripts ที่ใช้บ่อย

```bash
pnpm dev          # dev server แบบ watch (tsx watch server/_core/index.ts)
pnpm build        # vite build + esbuild bundle server → dist/
pnpm start        # รัน production จาก dist/index.js
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm format       # prettier --write .
```

## Database & Migrations

**ไม่ต้องรัน migration manual** — server เรียก `runMigrations()` (idempotent SQL) ทุกครั้งที่ start ทำงานได้ทั้ง database เปล่าและ database เดิม

### เมื่อแก้/เพิ่ม schema ใน `drizzle/schema.ts`

1. แก้ไฟล์ `drizzle/schema.ts`
2. **เพิ่ม SQL ที่ match กันลงใน `SETUP_SQL` ใน `server/_core/migrate.ts` ด้วยมือ:**
   - ตารางใหม่ → `CREATE TABLE IF NOT EXISTS ...`
   - column ใหม่ → `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
   - enum value ใหม่ → `ALTER TYPE ... ADD VALUE IF NOT EXISTS ...`
3. Commit — deploy ถัดไปจะ apply ให้อัตโนมัติ

รายละเอียดเพิ่มเติมใน [`../drizzle/README.md`](../drizzle/README.md)

## Workflow การพัฒนา

1. แก้ client (`client/src`) และ/หรือ server (`server/`)
2. แชร์ logic/type ผ่าน tRPC — router ฝั่ง server define แล้ว client เรียกผ่าน `@trpc/react-query` ได้ทันทีแบบ type-safe
3. ก่อน commit: `pnpm typecheck && pnpm test`
4. Format code: `pnpm format`

## โครงสร้าง path aliases (shadcn/ui)

จาก `components.json`:

- `@/components` → components
- `@/components/ui` → shadcn ui components
- `@/lib/utils` → utilities (`clsx` + `tailwind-merge`)
- `@/hooks` → custom hooks

## ข้อควรรู้

- Tailwind CSS ใช้ **v4** (ผ่าน `@tailwindcss/vite` plugin) + `tw-animate-css`
- React Query cache persist ลง localStorage ผ่าน `query-sync-storage-persister`
- เวลาทั้งระบบคำนวณบน timezone **Asia/Bangkok**
