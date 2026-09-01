# Moneyflow 💸

แอปจัดการการเงินส่วนบุคคล (Personal Finance Tracker) ที่มาพร้อมระบบจัดการรายรับ–รายจ่าย สรุปยอด ตั้งงบ ตั้งเป้าหมาย และการแจ้งเตือนอัตโนมัติ

## ✨ ฟีเจอร์หลัก

- **บันทึกรายรับ–รายจ่าย** — ผ่านหน้าเว็บ พร้อมระบบหมวดหมู่อัตโนมัติ
- **สรุปยอด** — รายวัน รายสัปดาห์ export เป็น CSV ได้
- **งบประมาณ** — พร้อม pacing "งบเหลือ ÷ วันที่เหลือในเดือน"
- **เป้าหมายออมเงิน**, รายการประจำ (recurring)
- **การแจ้งเตือน** — แจ้งเตือนงบประมาณ รายการประจำใกล้ถึงกำหนด เป้าหมายสำเร็จ
- **Undo** ลบรายการล่าสุด, ดูรายการล่าสุด
- **ล็อกด้วย PIN** — ป้องกันการเข้าถึงข้อมูลการเงิน

## 🧱 Tech Stack

| ชั้น | เทคโนโลยี |
|---|---|
| Frontend | React 19 + Vite 7, Tailwind CSS v4, shadcn/ui (new-york), Framer Motion, wouter |
| State/Data | TanStack Query v5 (+ persistence), tRPC v11 (superjson) |
| Backend | Node.js ≥ 20 + Express, tsx (dev) / esbuild (build) |
| Database | PostgreSQL + Drizzle ORM (auto-migrate ตอน start server) |
| Auth | JWT ผ่าน `jose` |
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

> Database schema ถูก migrate อัตโนมัติทุกครั้งที่ server start — ไม่ต้องรัน migration manual

## 📜 Scripts

| คำสั่ง | หน้าที่ |
|---|---|
| `pnpm dev` | รัน dev server แบบ watch |
| `pnpm build` | Build client (Vite) + bundle server (esbuild) ลง `dist/` |
| `pnpm start` | รัน production server จาก `dist/` |
| `pnpm typecheck` / `pnpm check` | ตรวจ TypeScript (`tsc --noEmit`) |
| `pnpm test` | รัน unit tests ด้วย Vitest |
| `pnpm format` | Format ด้วย Prettier |

## 📁 เอกสารเพิ่มเติม

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — โครงสร้างระบบและ flow ของข้อมูล
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — Environment variables, database, workflow การพัฒนา

## 📄 License

MIT
