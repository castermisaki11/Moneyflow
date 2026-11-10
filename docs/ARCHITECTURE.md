# Architecture (v13 — local-first)

MoneyFlow เป็น SPA ที่ **เก็บข้อมูลทั้งหมดในเบราว์เซอร์** ไม่มีฐานข้อมูลบนเซิร์ฟเวอร์และไม่มีระบบ login

## Data flow

```
UI (views)
  ⤵ useQuery / useMutation / useUtils (API รูปแบบเดิมของ tRPC)
lib/trpc.tsx — shim: กักเรียกทุก procedure
  ⤵ อ่าน/เขียนตรง
lib/localdb.ts — localStorage "moneyflow.localstore.v1" (JSON เอกสารเดียว)
```

- **TanStack Query** ยังทำหน้าที่ cache/invalidation เหมือนเดิม — state mutation ใน view ทุกตัวยังทำ optimistic update ผ่าน `setData/getData/cancel/invalidate` ได้ตามเดิม (มันเป็น react-query อยู่แล้วตอนใช้ tRPC)
- เขียนทุกครั้งจะใส่ revision อัตโนมัติ; อีกแท็บได้ยิน `storage` event → invalidate query ทั้งชุด
- Cache ของ react-query persist ลง localStorage (key `moneyflow-query-cache-v4`) เป็นแค่เทียบเท่าความเร็ว — localstore คือ source of truth

## Entities (โครงเดิมจาก Drizzle แต่ไม่มี userId เพราะมีผู้ใช้เดียว)

`transactions` · `budgets` · `goals` · `recurring` · `settings` — อ่านรายละเอียด field ได้ที่ `client/src/lib/types.ts`

## Recurring engine

`localdb.bootLocalStore()` รันตอนเปิดแอป: รายการประจำที่ `nextDate ≤ ปัจจุบัน` จะถูกสร้างเป็น transaction ย้อนหลัง (cap 40 รอบ/กฎ) แล้วดัน `nextDate` ตามความถี่ — กฎ daily/weekly/monthly/yearly ไม่มี cron

## PIN

แฮช SHA-256 (Web Crypto) ใน settings.pinHash + lockout นับใน localStorage (ผิด 5 ครั้ง = รอ 60 วิ)

## Server

`serve.mjs` = static file server ล้วน (Node built-in เท่านั้น): serve `dist/public/` พร้อม cache header (assets มี hash ในชื่อไฟล์ = immutable, index.html = no-cache) และ SPA fallback

## Auth

ไม่มี — `auth.me` คืน session ตายตัว (id 1) เสมอ; การป้องกันเหลือเพียง PIN lock ที่ gate แอปใน ProtectedRoute
