# AGENT.md — Moneyflow (v13 local-first) · อ่านก่อนเริ่มงานทุกครั้ง

> ไฟล์ฉบับโปรเจกต์ — ทำขึ้นจาก `AGENT.md` หลักของ workspace (Termux + PRoot Ubuntu on Android 12/aarch64 · อัปเดต 2026-10-25) ตัดมาเฉพาะกฎที่ผูกกับงานนี้ กฎฝั่ง Stardew modding (smod/Harmony ฯลฯ) ไม่เกี่ยวกับโปรเจกต์นี้ — อย่าอนุมานนำมาใช้

## 0) โปรเจกต์นี้คืออะไร

แอปจัดการการเงินส่วนบุคคล **local-first เด็ดขาด (v13.0.0)**:
- ข้อมูลทุกอย่างเก็บ **ในเบราว์เซอร์ของผู้ใช้** (localStorage คีย์ `moneyflow.localstore.v1`) — server เป็นไฟล์ static ล้วน
- **ไม่มี** database, login/OAuth, admin/metrics, หรือ server-side state ใด ๆ (ถอนออกแล้วทั้งชุดใน v13 และตั้งใจให้คงอยู่แบบนี้ถาวร)
- ฐานอ้างอิงบน GitHub: `castermisaki11/Moneyflow` — release `v13.0.0` (ตัดจาก `f74b2d0`) · repo นี้ commit ทั้ง `dist/` และไฟล์ `AGENT.md` นี้ไว้ใน git

## 1) เริ่มงาน (ทำตามลำดับ)

```bash
pnpm install        # pnpm 10 — มี pnpm-lock.yaml (ห้ามสลับไป npm install โดยพลการ)
pnpm typecheck      # tsc --noEmit → ต้องได้ 0 error
pnpm dev            # dev server (Vite) — พัฒนาที่นี่
pnpm build          # → dist/public/
pnpm start          # serve dist/public ด้วย serve.mjs (Node built-in — ไม่มี dependency)
```

**เกณฑ์ที่ยอมรับว่าเสร็จ** = typecheck 0 error + build ผ่าน + เปิด `pnpm start` แล้ว curl ตอบ 200 — ทดสอบด้วยคำสั่งจริงและรายงานผลจากการวัด ไม่ใช่การถือว่าควรผ่าน

## 2) แหล่งความจริงของโค้ด — แก้ผิดที่ = งานเสีย

| สิ่ง | ไฟล์ |
|---|---|
| Store + ตรรกะข้อมูลทั้งหมด (CRUD, รายการประจำ, PIN) | `client/src/lib/localdb.ts` |
| Type ของข้อมูล | `client/src/lib/types.ts` |
| API layer (shim — hook API แบบ tRPC เดิม) | `client/src/lib/trpc.tsx` |
| QueryClient + sync ข้ามแท็บ | `client/src/lib/queryClient.ts` |
| UI หลัก + แท็บทั้งหมด | `client/src/pages/MoneyFlow.tsx` · `client/src/components/views/` |
| Server | `serve.mjs` — **static เท่านั้น ห้ามเติม logic** |
| เอกสาร | `README.md` + `docs/ARCHITECTURE.md` + `docs/DEVELOPMENT.md` |

- เวลาเพิ่มความสามารถ: เขียน procedure ใน `localdb.ts` จุดเดียว → แมปใน `trpc.tsx` → UI เรียกผ่าน `trpc.<group>.<proc>` เหมือนเดิม — **ห้ามเรียก localdb ตรง ๆ จาก component**
- แก้โค้ดคู่กับเอกสารเสมอ — ห้ามปล่อยเอกสารให้ล้าสมัย

## 3) ห้ามทำ

- ❌ ดึง database / server state / tRPC จริง / ระบบ login กลับเข้ามา (รวมฉบับ "ชั่วคราว")
- ❌ เขียน business logic ใน `serve.mjs` (เทียบเคียงไม่มี `dist/index.js` อีกแล้ว)
- ❌ เก็บ token/secret/log ส่วนตัวลงไฟล์ในโปรเจกต์ (ต้นทางสแกนด้วย tokenguard ก่อน push — ก่อนแพ็กต้องแน่ใจว่า zip ไม่มีค่า secret อยู่เด็ดขาด)
- ⚠️ ล้าง localStorage = ข้อมูลผู้ใช้หายจริง — ถ้าเปลี่ยนโครงสร้างข้อมูล ต้องมี migration หรือการ Import JSON ที่กู้คืนได้

## 4) ข้อจำกัดเมื่อทำงานบนเครื่องต้นทาง (Termux/Android)

ใช้ถ้าคุณ (agent) ลงงานบนเครื่อง Android เครื่องเดียวกัน — ถ้าทำงานบน Linux/PC ปกติ ส่วนนี้ข้ามได้:

- **ไม่มี `zip` command** — แพ็กด้วย `python3` + โมดูล `zipfile`
- รันสคริปต์บน sdcard ด้วย `bash x.sh` เท่านั้น (ไม่มี exec bit)
- `find` ทันทีหลังเขียนไฟล์อาจไม่เจอ (FUSE race) — ยืนยันด้วย `ls` ก่อนสรุปว่าเขียนไม่ติด
- sdcard รัน node/pnpm ไม่ได้ — build ทำในระบบไฟล์จริง (เช่น `/root`)
- RAM ~3.8 GB — หลีกเลี่ยง build วนซ้ำที่ไม่จำเป็น (typecheck ให้ผ่านก่อน build)
- push GitHub ที่เครื่องนี้: token อยู่ `Token/tokensgithub.md` บรรทัดที่ 3 · วิธี one-shot askpass (ห้ามพิมพ์ค่า token ออก ห้ามเขียนลงดิสก์ · ดู `GitHub.md`) — แต่รอบส่งงานนี้ **ไม่ต้อง push: แพ็ก zip ส่งกลับให้ผู้ส่งต่อเป็นผู้ push**

## 5) ส่งงานคืน (pack)

เสร็จแล้วสร้าง zip **ทั้งโปรเจกต์** กลับไป (โครงเดียวกับ zip ที่รับมา):

- ระวัง: **ตัด `node_modules` และ `.git`** — แน่ใจว่าไม่มี token/secret/log ผู้ใช้
- รายงานคืนเป็นข้อความ: แก้อะไรไฟล์ไหน · ผลตรวจผ่านอย่างไร · ข้อจำกัดที่ต้องรู้

## 6) ธรรมเนียม

- อ่านไฟล์จริงก่อนเสนอ solution เสมอ (ห้ามเดาจากชื่อไฟล์)
- เขียนจริง/พังจริงก่อนบอกผล — ห้ามอ้างว่าควรจะผ่าน
- สรุปให้ผู้ใช้เห็นจุดรับรู้ทันที: แก้อะไร · ไฟล์ไหน · วิธีทดสอบยืนยันด้วยคำสั่งสั้น ๆ

*แก้ไฟล์นี้เมื่อวิธีทำงานเปลี่ยน — จุดแรกที่ต้องสะท้อนคือหัวข้อ 2) และ 3)*
