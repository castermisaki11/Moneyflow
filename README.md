# Moneyflow 💸

แอปจัดการการเงินส่วนบุคคล (Personal Finance Tracker) — บันทึกรายรับ–รายจ่าย สรุปยอด ตั้งงบ ตั้งเป้าออม จัดการรายการประจำ พร้อมรายงานรายเดือน export ได้ทั้ง JSON/CSV และใช้งานเป็น PWA แบบ offline ได้

> ชื่อที่แสดงในแอป (title tag / PWA manifest) คือ **Satang** — ชื่อ repo/แพ็กเกจยังเป็น `@workspace/moneyflow`

> **v13.0.0 — local-first**: แอปเก็บข้อมูลทั้งหมดในเบราว์เซอร์ของคุณเอง (localStorage) — ไม่มีฐานข้อมูลบนเซิร์ฟเวอร์, ไม่มีระบบ login, ไม่ต้องตั้งค่าอะไร

## ✨ ฟีเจอร์หลัก

**ข้อมูล**
- **บันทึกรายรับ–รายจ่าย–ออม** พร้อมหมวดหมู่ (แก้ไข/เพิ่มหมวดเองได้, ซ่อน/กู้คืนหมวดเริ่มต้นได้)
- **แดชบอร์ด** — ยอดเดือนนี้, ภาพรวมงบประมาณ, รายการประจำที่กำลังจะถึง, เป้าหมายออม + กราฟแนวไทม์ไลน์/แยกตามหมวด/วงกลมสัดส่วน (`DashboardCharts` ด้วย Recharts)
- **ค้นหา/กรองรายการ** — ค้นข้อความ, กรองประเภท/หมวด, ช่วงวัน (วันนี้/สัปดาห์/เดือน/ทั้งหมด/กำหนดเอง), แบ่งหน้า
- **งบประมาณรายหมวด** รายวัน/สัปดาห์/เดือน/ปี พร้อมแถบความคืบหน้า (เตือนที่ 80%, แดงเมื่อเกิน)
- **เป้าหมายออมเงิน** — เพิ่มเงินเข้าเป้า, กำหนด deadline
- **รายการประจำ (recurring)** — ระบุความถี่, กด "รันเลย" เพื่อสร้างรายการเลยแล้วดันวันถัดไปให้; รายการที่ครบกำหนดค้างไว้จะถูกบันทึกอัตโนมัติเมื่อเปิดแอป
- **รายงานรายเดือน** — สรุปยอด + สัดส่วนรายจ่าย/ออม + Top 5 หมวด, export เป็นไฟล์ข้อความ
- **สำรอง & กู้คืน** — Export/Import **JSON** (ทั้งหมด) และ **CSV** (รายการ, มี BOM UTF-8 เปิด Excel ได้ตรงๆ) พร้อม preview ก่อนนำเข้า

**ระบบ**
- **ไม่มี login** — เปิดใช้ได้ทันที ไม่ต้องมีบัญชี (ข้อมูลอยู่กับเครื่องคุณ 100%)
- **PIN lock** — ล็อกหน้าแอปได้ (แฮชด้วย Web Crypto SHA-256 + ล็อก 60 วิ เมื่อกรอกผิด 5 ครั้ง)
- **Dark / Light / Auto** ธีม, เลือกสกุลเงินได้ 10 สกุล (THB, USD, EUR, GBP, JPY, CNY, KRW, SGD, MYR, VND)
- **Sync ข้ามแท็บ** — เปิดหลายแท็บในเครื่องเดียวกัน ข้อมูลอัปเดตทันที
- **Offline จริง** — PWA + Service Worker: บันทึกได้แม้ไม่มีเน็ต เพราะเขียนลงเครื่องตรง ๆ
- **ตัวรันแบบเบามาก** — เซิร์ฟเวอร์เหลือหน้าที่แค่ serve ไฟล์ static (ไม่มี state, ไม่มี DB)

## 🧱 Tech Stack

| ชั้น | เทคโนโลยี |
|---|---|
| Frontend | React 19 + Vite 7, Tailwind CSS v4, shadcn/ui (new-york), Recharts, Framer Motion, wouter |
| State/Data | TanStack Query v5 (+ persistence ลง localStorage) + local store (`client/src/lib/localdb.ts`) |
| API layer | tRPC-shaped shim (`client/src/lib/trpc.tsx`) — API เดิม ทำงานบนข้อมูล local |
| Server | ไฟล์ static เท่านั้น (`serve.mjs` หลัง build — Node ≥ 20, ไม่มี dependency) |
| Offline | Service Worker + localStorage |
| PIN | Web Crypto (SHA-256) |

## 🚀 เริ่มต้นใช้งาน

```bash
# ต้องใช้ Node.js >= 20 และ pnpm >= 10
pnpm install

# รัน dev server (Vite)
pnpm dev

# build สำหรับ production (vite build → dist/public/)
pnpm build

# รัน production server (serve dist/public — static เท่านั้น)
pnpm start
```

ไม่ต้องตั้งไฟล์ `.env` อะไรเลย — ทุกอย่างทำงานได้ทันที (ดูค่า optional ใน `.env.example`)

## 📜 Scripts

| คำสั่ง | หน้าที่ |
|---|---|
| `pnpm dev` | รัน dev server (Vite) |
| `pnpm build` | Build SPA → `dist/public/` |
| `pnpm start` | Serve `dist/public/` ด้วย static server (`serve.mjs`) |
| `pnpm typecheck` / `pnpm check` | ตรวจ TypeScript (`tsc --noEmit`) |
| `pnpm format` | Format ด้วย Prettier |
| `pnpm cap:sync` | alias ของ `pnpm build` สำหรับ Capacitor |

## 🗂 โครงสร้างโปรเจกต์

```
client/            SPA (React + Vite)
  src/pages        MoneyFlow (หน้าหลัก+แท็บ), NotFound
  src/components   views/ (Dashboard, รายการ, งบ, รายงาน, ตั้งค่า), ui/ (shadcn)
  src/lib          localdb.ts (store + procs), trpc.tsx (shim), queryClient.ts
  public/          sw.js (PWA/offline), manifest, icons
serve.mjs          static file server (zero-dependency)
docs/              ARCHITECTURE.md, DEVELOPMENT.md
```

## 🔒 ข้อมูลของคุณ

- ข้อมูลทั้งหมดอยู่ใน localStorage ของเบราว์เซอร์ (`moneyflow.localstore.v1`) — ล้างข้อมูลเว็บ = ข้อมูลหาย
- **สำรองข้อมูลเป็นประจำได้จากแท็บตั้งค่า → ข้อมูล → Export JSON**
- ลบสตอเรจทั้งหมด: แท็บตั้งค่า → ข้อมูล → Import JSON เท่านั้นที่กู้คืนได้

## 📄 License

MIT
