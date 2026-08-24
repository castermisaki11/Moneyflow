# Moneyflow 💸

แอปจัดการการเงินส่วนบุคคล (Personal Finance Tracker) ที่มาพร้อม **Telegram Bot** สำหรับบันทึกรายรับ–รายจ่าย สรุปยอด ตั้งงบ ตั้งเป้าหมาย และแจ้งเตือนอัตโนมัติ — ใช้งานได้ทั้งผ่านหน้าเว็บและผ่านแชท

> ⚠️ **สถานะของ repository นี้:** ปัจจุบันมีเฉพาะไฟล์ config/เอกสาร (`package.json`, `components.json`, เอกสาร md) — ซอร์สโค้ดจริง (`server/`, `client/`, `drizzle/schema.ts` ฯลฯ) จากโปรเจกต์ `Moneyflowv10-fixed/` ยังไม่ถูก push เข้า repo นี้ เอกสารชุดนี้เขียนจากข้อมูลอ้างอิงใน `BOT FILES.md` และ `drizzle/README.md`

## ✨ ฟีเจอร์หลัก

- **บันทึกรายรับ–รายจ่าย** — ผ่านหน้าเว็บ หรือพิมพ์ข้อความอิสระใน Telegram (bot เดาหมวดหมู่ให้อัตโนมัติ)
- **สรุปยอด** — รายวัน `/summary`, รายสัปดาห์ `/weekly`, export เป็น CSV ได้ `/export`
- **งบประมาณ** `/budget` — พร้อม pacing "งบเหลือ ÷ วันที่เหลือในเดือน"
- **เป้าหมายออมเงิน** `/goals`, รายการอยากซื้อ `/wishlist`, รายการประจำ `/recurring`
- **การแจ้งเตือน** — reminder ภาษาไทยแบบอิสระ (เช่น "เตือนพรุ่งนี้ 9 โมง จ่ายค่าเน็ต") + scheduler รายวัน/รายสัปดาห์
- **Undo** `/undo` ลบรายการล่าสุด, `/recent` ดูรายการล่าสุด
- **หน้าแอดมิน Bot** — สถิติผู้ใช้ + broadcast ข้อความหาผู้ใช้ทุกคนที่เชื่อม Telegram

## 🧱 Tech Stack

| ชั้น | เทคโนโลยี |
|---|---|
| Frontend | React 19 + Vite 7, Tailwind CSS v4, shadcn/ui (new-york), Framer Motion, wouter |
| State/Data | TanStack Query v5 (+ persistence), tRPC v11 (superjson) |
| Backend | Node.js ≥ 20 + Express, tsx (dev) / esbuild (build) |
| Database | PostgreSQL + Drizzle ORM (auto-migrate ตอน start server) |
| Auth | JWT ผ่าน `jose` |
| Bot | Telegram Long Polling (ไม่ต้องเปิด webhook) |
| Testing | Vitest |

## 🚀 เริ่มต้นใช้งาน

```bash
# ต้องใช้ Node.js >= 20 และ pnpm >= 10
pnpm install

# ตั้งค่า environment variables (ดูรายละเอียดใน docs/DEVELOPMENT.md)
cp .env.example .env   # แล้วแก้ค่าต่างๆ

# รัน dev server (client + server ในคำสั่งเดียว)
pnpm dev

# build สำหรับ production (vite build + bundle server → dist/)
pnpm build
pnpm start
```

> Database schema ถูก migrate อัตโนมัติทุกครั้งที่ server start — ไม่ต้องรัน migration manual (อ่านเพิ่มใน [`drizzle/README.md`](drizzle/README.md))

## 📜 Scripts

| คำสั่ง | หน้าที่ |
|---|---|
| `pnpm dev` | รัน dev server แบบ watch |
| `pnpm build` | Build client (Vite) + bundle server (esbuild) ลง `dist/` |
| `pnpm start` | รัน production server จาก `dist/` |
| `pnpm typecheck` / `pnpm check` | ตรวจ TypeScript (`tsc --noEmit`) |
| `pnpm test` | รัน unit tests ด้วย Vitest |
| `pnpm format` | Format ด้วย Prettier |
| `pnpm db:push` | (optional) generate + migrate ด้วย drizzle-kit |
| `pnpm cap:sync` | Build ทั้งโปรเจกต์ (alias ของ `pnpm run build`) |

## 📁 เอกสารเพิ่มเติม

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — โครงสร้างระบบและ flow ของข้อมูล
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — Environment variables, database, workflow การพัฒนา
- [`docs/TELEGRAM_BOT.md`](docs/TELEGRAM_BOT.md) — คำสั่งและฟีเจอร์ทั้งหมดของ bot
- [`BOT FILES.md`](BOT FILES.md) — แผนที่ไฟล์ฝั่ง Telegram Bot (จาก source เดิม)

## 📄 License

MIT
