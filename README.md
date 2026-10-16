# Moneyflow 💸

แอปจัดการการเงินส่วนบุคคล (Personal Finance Tracker) — บันทึกรายรับ–รายจ่าย สรุปยอด ตั้งงบ ตั้งเป้าออม จัดการรายการประจำ พร้อมรายงานรายเดือน export ได้ทั้ง JSON/CSV และใช้งานเป็น PWA แบบ offline ได้

> ชื่อที่แสดงในแอป (title tag / PWA manifest) คือ **Satang** — ชื่อ repo/แพ็กเกจยังเป็น `@workspace/moneyflow`

## ✨ ฟีเจอร์หลัก

**ข้อมูล**
- **บันทึกรายรับ–รายจ่าย–ออม** พร้อมหมวดหมู่ (แก้ไข/เพิ่มหมวดเองได้, ซ่อน/กู้คืนหมวดเริ่มต้นได้)
- **แดชบอร์ด** — ยอดเดือนนี้, ภาพรวมงบประมาณ, รายการประจำที่กำลังจะถึง, เป้าหมายออม + กราฟแนวไทม์ไลน์/แยกตามหมวด/วงกลมสัดส่วน (`DashboardCharts` ด้วย Recharts)
- **ค้นหา/กรองรายการ** — ค้นข้อความ, กรองประเภท/หมวด, ช่วงวัน (วันนี้/สัปดาห์/เดือน/ทั้งหมด/กำหนดเอง), แบ่งหน้า
- **งบประมาณรายหมวด** รายวัน/สัปดาห์/เดือน/ปี พร้อมแถบความคืบหน้า (เตือนที่ 80%, แดงเมื่อเกิน)
- **เป้าหมายออมเงิน** — เพิ่มเงินเข้าเป้า, กำหนด deadline
- **รายการประจำ (recurring)** — ระบุความถี่, กด "รันเลย" เพื่อสร้างรายการเลยแล้วดันวันถัดไปให้ (ไม่มี cron อัตโนมัติ — ไม่มี scheduler ในฝั่ง server แล้ว)
- **รายงานรายเดือน** — สรุปยอด + สัดส่วนรายจ่าย/ออม + Top 5 หมวด, export เป็นไฟล์ข้อความ
- **สำรอง & กู้คืน** — Export/Import **JSON** (ทั้งหมด) และ **CSV** (รายการ, มี BOM UTF-8 เปิด Excel ได้ตรงๆ) พร้อม preview ก่อนนำเข้า

**ระบบ**
- **เข้าสู่ระบบด้วย Google OAuth** (ผู้ให้บริการเดียว — ไม่มี login แบบอื่น)
- **PIN lock** — ล็อกหน้าแอปซ้ำหลัง login (scrypt + lockout 30 วิ เมื่อกรอกผิด 5 ครั้ง)
- **Dark / Light / Auto** ธีม, เลือกสกุลเงินได้ 10 สกุล (THB, USD, EUR, GBP, JPY, CNY, KRW, SGD, MYR, VND)
- **Real-time sync ผ่าน SSE** — ทุกแท็บ/อุปกรณ์ที่ login อยู่อัปเดตทันทีที่ข้อมูลเปลี่ยน
- **Offline** — PWA + Service Worker: แคชหน้าแอป และ queue รายการที่เพิ่มตอน offline แล้ว sync อัตโนมัติ (Background Sync)
- **แอดมิน** — จัดการผู้ใช้/สิทธิ์, ดูสถิติ cache และ sync event (หน้า "วัดผล & ผู้ใช้")

## 🧱 Tech Stack

| ชั้น | เทคโนโลยี |
|---|---|
| Frontend | React 19 + Vite 7, Tailwind CSS v4, shadcn/ui (new-york), Recharts, Framer Motion, wouter |
| State/Data | TanStack Query v5 (+ persistence ลง localStorage), tRPC v11 (superjson) |
| Backend | Node.js ≥ 20 + Express, tsx (dev) / esbuild (build) |
| Database | PostgreSQL + Drizzle ORM (`pg` driver, auto-migrate ตอน start server) |
| Auth | Google OAuth2 (authorization code) + JWT ผ่าน `jose` (cookie) |
| Real-time | Server-Sent Events (`/api/events`) + in-memory cache |
| Offline | Service Worker + Background Sync + IndexedDB |
| Testing | Vitest |

## 🚀 เริ่มต้นใช้งาน

```bash
# ต้องใช้ Node.js >= 20 และ pnpm >= 10
pnpm install

# สร้างไฟล์ .env (มี `.env.example` ให้ copy / รายละเอียดตัวแปรทั้งหมดอยู่ใน docs/DEVELOPMENT.md)
cat > .env <<'EOF'
DATABASE_URL=postgres://user:pass@localhost:5432/moneyflow
JWT_SECRET=เปลี่ยนเป็นสุ่มยาวๆ
PORT=3000

# Google OAuth (จำเป็น ถ้าไม่ตั้ง จะ login ไม่ได้)
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# สิทธิ์แอดมิน (optional)
OWNER_OPEN_ID=google-<user-id>
ADMIN_GOOGLE_IDS=<id1>,<id2>
EOF

# รัน dev server (client + server ในคำสั่งเดียว)
pnpm dev

# build สำหรับ production (vite build + bundle server → dist/)
pnpm build
pnpm start
```

> Database schema ถูก migrate อัตโนมัติทุกครั้งที่ server start — ไม่ต้องรัน migration manual
>
> มีไฟล์ `.env.example` ใน repo — `cp .env.example .env` แล้วกรอกค่าจริง (บล็อกด้านบนคือตัวอย่าง)

## 📜 Scripts

| คำสั่ง | หน้าที่ |
|---|---|
| `pnpm dev` | รัน dev server แบบ watch (`tsx watch server/_core/index.ts`) |
| `pnpm build` | Build client (Vite → `dist/public`) + bundle server (esbuild → `dist/index.js`) |
| `pnpm start` | รัน production server จาก `dist/` |
| `pnpm typecheck` / `pnpm check` | ตรวจ TypeScript (`tsc --noEmit`) |
| `pnpm test` | รัน unit tests ด้วย Vitest (DB ถูก mock — ไม่ต้องมี Postgres) |
| `pnpm format` | Format ด้วย Prettier |
| `pnpm db:push` | (optional, local) ให้ drizzle-kit generate + migrate |
| `pnpm cap:sync` | alias ของ `pnpm build` สำหรับ Capacitor |

## 🗂 โครงสร้างโปรเจกต์

```
client/            SPA (React + Vite)
  src/pages        MoneyFlow (หน้าหลัก+แท็บ), Login, NotFound
  src/components   views/ (Dashboard, รายการ, งบ, รายงาน, Backup, ตั้งค่า, บัญชี, วัดผล), ui/ (shadcn)
  public/          sw.js (PWA/offline), manifest, icons
server/
  _core/           index (entry), oauth, jwt, migrate, cache, events (SSE), pin, ...
  routers.ts       tRPC router หลักทั้งหมด
  db.ts            query ทั้งหมด + cache layer
shared/            const + types ที่แชร์ client/server
drizzle/           schema.ts (source of truth), relations.ts, migrations/
docs/              ARCHITECTURE.md, DEVELOPMENT.md
```

## 📁 เอกสารเพิ่มเติม

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — โครงสร้างระบบ, flow ของข้อมูล, endpoint ทั้งหมด
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — Environment variables, database, workflow, งานที่ยังค้าง
- [`drizzle/README.md`](drizzle/README.md) — วิธีเพิ่ม/แก้ schema

## 🧪 Testing

```bash
pnpm test        # 7 tests — transactions, goals, recurring, settings, การแยกข้อมูลรายคน
pnpm typecheck
```

DB ถูก mock ใน `server/moneyflow.test.ts` จึงรันได้โดยไม่ต้องมี database

## 📄 License

MIT
