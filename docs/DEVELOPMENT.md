# Development (v13 — local-first)

## เริ่มงาน

```bash
pnpm install
pnpm dev          # Vite dev server
pnpm typecheck    # tsc --noEmit
pnpm build        # → dist/public/
pnpm start        # serve dist/public (node serve.mjs)
```

ไม่ต้องตั้งค่า env อะไร (ดู optional ใน `.env.example`)

## จะเพิ่ม/แก้ feature จุดไหน

| งาน | แก้ที่ |
|---|---|
| เปลี่ยนข้อมูล (เพิ่ม field, กฎใหม่) | `client/src/lib/localdb.ts` (procedure) + `client/src/lib/types.ts` (type) |
| เพิ่ม API ตัวใหม่ | ประกาศใน `localdb.ts` → เพิ่มชื่อใน `trpc.tsx` (ทั้ง `trpc.*` และ `useUtils()`) |
| UI | `client/src/pages/MoneyFlow.tsx`, `client/src/components/views/*` |

## หลักการสำคัญ (อ่านก่อนเขียน)

- **localstore คือ source of truth** — อย่าเก็บ state ที่ควร persist ไว้ที่อื่น; เขียนให้ผ่าน procedure ของ `localdb` จุดเดียวเท่านั้น
- `bootLocalStore()` ทำงานตอน import → ระวัง side effect ที่อาจวนไม่จบ (recurring มี cap 40 รอบ/กฎอยู่แล้ว)
- **ล้างข้อมูลเบราว์เซอร์ = ข้อมูลหายจริง** — UI มี Export JSON ให้สำรองเสมอ (แท็บตั้งค่า → ข้อมูล)
- ห้ามเติม business logic ใน serve.mjs — มันสำหรับ static file เท่านั้น

## เผื่อนำไป data migration

ยังไม่มี engine แต่ `importStoreJson(file)` จะเล่นบท seed/restorer ได้ (ทดแทน JSON ใหม่เข้าไปแล้ว invalidate)

## อัปเดต version / release

1. bump `version` ใน `package.json`
2. เปิด status → ผ่าน → commit+push main
3. ติด tag `vX.Y.Z` → push tag: GitHub Workflow (`.github/workflows/release.yml`) จะ typecheck + build + สร้าง Release พร้อม zip อัตโนมัติ
