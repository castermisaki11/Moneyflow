# Telegram Bot — Moneyflow

> เอกสารรวมฉบับเดียว: ฟีเจอร์ + คำสั่ง + แผนที่ไฟล์ทั้งหมดของ Telegram Bot (ปรับปรุง v1.0.4)

---

## 📱 การเชื่อมบัญชี (Web ↔ Telegram)

1. ไปหน้าเว็บ **Settings** → กด "เชื่อม Telegram" → ระบบสร้าง link code (`createLinkCode()`)
2. ผู้ใช้กดลิงก์ / พิมพ์โค้ดในแชท → `linkTelegramChat()` ผูก `telegramChatId` เข้ากับ account
3. ตั้งค่าการแจ้งเตือนแต่ละประเภทได้จากหน้า Settings (state เก็บใน `settings.notificationSettings` JSONB — **ไม่ต้อง migrate DB**)
4. ยกเลิกเชื่อมผ่าน `unlinkTelegramChat()`

### 🌐 Telegram Mini App

- หลังเชื่อมบัญชีสำเร็จ bot ส่งปุ่ม inline **"🌐 เปิด MoneyFlow"** + ตั้ง chat menu button ถาวรให้ทุก user
- เปิดเว็บ Moneyflow ใน Telegram แบบ **auto-login**: client ส่ง `initData` → server ตรวจ HMAC-SHA256 signature + กัน replay (เกิน 24 ชม.) → ออก session cookie
- โค้ดฝั่ง server: `server/_core/telegramWebapp.ts` · route: `POST /api/auth/telegram-webapp`
- ⚙️ ต้องตั้ง env **`PUBLIC_APP_URL`** (HTTPS ใน production) ถึงจะเห็นปุ่ม — ไม่ตั้ง = ฟีเจอร์ no-op

---

## ⌨️ คำสั่งทั้งหมด

| คำสั่ง | หน้าที่ |
|---|---|
| `/start` | เริ่มต้นใช้งาน / เชื่อมบัญชี |
| `/help` | แสดงวิธีใช้ทั้งหมด (รวมวิธีส่งสลิป) |
| `/summary` | สรุปยอดวันนี้ |
| `/weekly` | สรุปยอดสัปดาห์นี้ |
| `/export` | Export รายการเป็น CSV (`/export` เดี่ยว = เดือนนี้, ระบุช่วงได้) |
| `/budget` | ดูงบประมาณ + pacing |
| `/goals` | ดูความคืบหน้าเป้าหมายออมเงิน |
| `/recent` (`/list`) | ดูรายการล่าสุด |
| `/wishlist` | ดูลิสต์ของที่อยากซื้อ |
| `/recurring` | ดูรายการประจำ |
| `/undo` | ย้อนลบรายการล่าสุด |
| `/reminders` | ดู reminder พร้อมปุ่ม ✅ เสร็จแล้ว / ⏰ Snooze / 🗑 ลบ |
| `/remind <ข้อความ>` | ตั้งเตือนภาษาไทยแบบอิสระ เช่น "เตือนพรุ่งนี้ 9 โมง จ่ายค่าเน็ต" |
| `/interval [N]` | ปรับความถี่เตือน "ยังไม่บันทึกรายการ" (ดูด้านล่าง) |

---

## 💬 การใช้งานในแชท

### Natural Language Quick-add

พิมพ์ข้อความธรรมดาได้โดยไม่ต้องใช้คำสั่ง:

- **บันทึกรายการ** — `กาแฟ 60` → `parseQuickTransaction` + `guessCategory` แยกยอด/หมวดอัตโนมัติ ถ้าเดาไม่มั่นใจจะส่งปุ่ม callback ให้ยืนยัน/แก้หมวด
- **ถามยอดตาม keyword** — เช่น "เดือนนี้จ่ายไปเท่าไหร่", "สัปดาห์นี้" → `tryKeywordPeriodQuery`

### 📸 แนบสลิปรูปภาพ

1. บันทึกรายการตามปกติ (เช่น `กาแฟ 60`)
2. **ส่งรูปสลิปเข้าแชท** (photo หรือ image document)
3. Bot เลือกความละเอียดสูงสุด → ดาวน์โหลดผ่าน Telegram getFile (จำกัด ≤10 MB) → เก็บลง disk `data/attachments/<userId>/`
4. ผูกกับ **รายการล่าสุด** ของ user — ถ้ายังไม่มีรายการ bot จะแนะนำให้บันทึกก่อน
5. ในเว็บ รายการนั้นจะมีไอคอน **📎** กดเปิดดูรูปได้ทันที

- โค้ด: `receiptPhoto.ts` (handler), `attachmentStore.ts` (จัดเก็บ + กัน path traversal)
- Route serve รูป: `GET /api/attachments/:id` — **ต้อง login และเป็นเจ้าของสลิปเท่านั้น**
- โฟลเดอร์ `data/` ถูก gitignore

---

## 🔔 ระบบแจ้งเตือน & Reminder

### คำสั่ง `/interval` — ปรับความถี่เตือน

```
/interval            → ดูค่าปัจจุบัน
/interval 30         → เตือนทุก 30 นาที
/interval 45m        → ทุก 45 นาที
/interval 2h         → ทุก 2 ชั่วโมง
/interval daily      → กลับโหมดเตือนรายวัน
```

- **โหมดรายวัน:** เตือนวันละครั้งตามเวลาที่ตั้ง (default 20:00 น. เวลาไทย)
- **โหมด interval:** เตือนซ้ำทุก N นาที (5–1,440) จนกว่าวันนั้นจะมีรายการ — บันทึกแล้วเงียบทันที
- ปรับได้จากแชท **หรือ** หน้า Settings (dropdown ความถี่)
- State: `dailyReminderMode`, `dailyReminderIntervalMinutes`, `lastIntervalReminderAt`

### Snooze Reminder

- แจ้งเตือนที่ป๊อปจริงมีปุ่ม **"✅ เสร็จแล้ว"** และ **"⏰ เตือนอีกที 10 นาที"**
- `/reminders` มีปุ่ม ⏰ +10 นาที คู่กับปุ่มลบ
- รองรับ reminder ซ้ำ (เลื่อน `nextAt`) และแบบครั้งเดียวที่ถูก drop ไปแล้ว (reconstruct จาก message)
- กด snooze แล้ว edit message แสดงเวลาใหม่

---

## 🎛️ Scheduler (ฝั่ง Admin)

Scheduler เป็น heartbeat loop ที่ตั้งค่า runtime ได้จาก **หน้าเว็บ Bot** โดยไม่ต้อง restart:

| คอนโทรลในหน้า Bot | ค่า |
|---|---|
| Switch เปิด/ปิด | ปิด = หยุดเช็คอัตโนมัติทั้งหมด |
| Preset chips | 30 วิ · 1 นาที · 5 นาที · 15 นาที · 1 ชม. |
| Custom input | 10 วินาที – 24 ชั่วโมง |

- Config เก็บในตาราง `app_config` (key/value) — auto-migrate ตอน start server
- Heartbeat ทุก 5 วิ อ่าน config (cache 15 วิ) → รัน checks เมื่อครบ interval
- API: `bot.overview` ส่ง `schedulerConfig` · `bot.updateSchedulerConfig` (admin only, zod validate)

### งานที่ scheduler รัน

- เตือน "ยังไม่บันทึกรายการ" (โหมดรายวัน / interval)
- Pacing รายวัน + สรุปรายสัปดาห์
- แจ้งเตือนงบเกิน / เป้าหมายถึง milestone / รายการประจำครบกำหนด
- Custom reminders ที่ถึงเวลา (จาก `/remind`)

ทุกประเภทเช็ค on/off ต่อ user ผ่าน `notifSettings.ts`

---

## 👨‍💼 Admin

- **Broadcast:** หน้าเว็บแอดมิน **Bot** → `botRouter.broadcast()` ส่งหาทุก user ที่เชื่อม → log ลง `botBroadcastLog`
- **สถิติ:** `botRouter.overview()` จาก `botStats.ts` + `schedulerConfig` ปัจจุบัน
- **System notification:** `notifyOwner()` ส่งเข้า `TELEGRAM_ADMIN_CHAT_ID`

---

## 🗂️ แผนที่ไฟล์ (File Map)

### 1. Entry point / bootstrap

| ไฟล์ | หน้าที่ |
|---|---|
| `server/_core/index.ts` | จุดสตาร์ท server — เรียก `startTelegramPolling()` ตอนบูต (ไม่ตั้ง `TELEGRAM_BOT_TOKEN` = no-op), route serve attachment + auto-login Mini App |
| `server/_core/env.ts` | อ่าน env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `PUBLIC_APP_URL` |

### 2. แกนหลักของบอท

| ไฟล์ | หน้าที่ |
|---|---|
| `server/_core/telegram.ts` (ไฟล์ใหญ่สุด ~1,500+ บรรทัด) | รวมทุกอย่างของบอท: ส่งข้อความ (`sendTelegramMessage` ฯลฯ), long-polling (`startTelegramPolling`), router คำสั่ง (`handleUpdate`), natural language (`parseQuickTransaction`, `guessCategory`), builder ข้อความสรุปทุกแบบ, handler ปุ่ม inline ทุก callback, export CSV, `createLinkCode()` |
| `server/_core/telegramApi.ts` | wrapper เรียก Telegram HTTP API |
| `server/_core/receiptPhoto.ts` | handler รับรูปสลิป → ดาวน์โหลด → ผูกรายการล่าสุด |
| `server/_core/attachmentStore.ts` | เก็บไฟล์สลิปลง disk `data/attachments/<userId>/` + กัน path traversal |
| `server/_core/reminderParser.ts` | parse ข้อความเตือนภาษาไทย ("เตือนพรุ่งนี้ 9 โมง …") → วัน/เวลา/ความถี่ |
| `server/_core/pacing.ts` | ข้อความ "งบเหลือ ÷ วันที่เหลือ" — ใช้ทั้ง `/budget` และพรีวิวหน้าเว็บ |
| `server/_core/bangkokTime.ts` | ยูทิลเวลาไทย คำนวณช่วงวัน/สัปดาห์/เดือน |
| `server/_core/format.ts` | `escapeHtml`, `formatMoney` |

### 3. เชื่อมบัญชี + ตั้งค่าแจ้งเตือน

| ไฟล์ | หน้าที่ |
|---|---|
| `server/_core/notifSettings.ts` | state การแจ้งเตือนต่อ user (JSONB) — รวมโหมดรายวัน/interval, link/unlink |
| `server/_core/telegramRouter.ts` | tRPC router ที่ Settings เรียก: สถานะเชื่อม, createLink, พรีวิว pacing, mutation reminder mode/interval |
| `server/_core/scheduler.ts` | heartbeat loop (dynamic config ผ่าน `app_config`) — ยิง notification อัตโนมัติทุกประเภท |
| `server/_core/telegramWebapp.ts` | validate Telegram initData (HMAC + anti-replay) สำหรับ Mini App auto-login |

### 4. Admin

| ไฟล์ | หน้าที่ |
|---|---|
| `server/_core/botRouter.ts` | tRPC router หน้าแอดมิน "Bot" — `overview` (สถิติ + schedulerConfig), `broadcast`, `updateSchedulerConfig` |
| `server/_core/botStats.ts` | ข้อมูลสถิติดิบ: users เชื่อม, reminder จะถึง, ประวัติ broadcast |
| `server/_core/notification.ts` | `notifyOwner()` — system alert เข้า admin chat |

### 5. ฝั่งเว็บ (UI)

| ไฟล์ | หน้าที่ |
|---|---|
| `client/src/components/views/BotView.tsx` | หน้าแอดมิน "Bot" — สถิติ, broadcast, การ์ดตั้งค่า Scheduler (switch + presets + custom seconds) |
| `client/src/components/views/SettingsView.tsx` | เชื่อม/ยกเลิก Telegram + ตั้งค่าแจ้งเตือนแต่ละแบบ + dropdown ความถี่ |

### 6. Database (ตารางที่ bot ใช้ — `drizzle/schema.ts`)

| ตาราง | ใช้โดย |
|---|---|
| `settings.notificationSettings` | `notifSettings.ts`, `telegram.ts` |
| `app_config` | runtime scheduler config (enabled + checkIntervalMs) |
| `reminderLog` | log ตอนกด "✅ เสร็จแล้ว" — เขียนใน `telegram.ts`, อ่านใน `botStats.ts` |
| `botBroadcastLog` | ประวัติ broadcast |
| `categoryFeedback` | log ✅/❌ การเดาหมวดหมู่ (เขียนอยู่, ยังไม่มีตัวอ่านไปใช้ tune) |
| `attachments` | metadata สลิป — เขียนใน `receiptPhoto.ts`, อ่านใน route serve + client 📎 |

---

## 🔄 Flow ภาพรวม

```
Telegram
  └─ startTelegramPolling() [telegram.ts] → handleUpdate()
       ├─ photo / image document → handleReceiptPhoto()
       │     └─ download → attachmentStore → ผูกรายการล่าสุด
       ├─ callback_query → undo / wishlist / done / snooze / pending-category …
       ├─ /command       → handler แต่ละคำสั่ง
       │     (reminderParser, pacing, bangkokTime, intervalParser)
       └─ ข้อความอิสระ    → quick-add / keyword period query
                             (guessCategory + categoryFeedback log)

ฝั่งอัตโนมัติ: scheduler.ts (heartbeat dynamic) → notifSettings.ts → telegram.ts
ฝั่งแอดมิน:   BotView.tsx → botRouter.ts → botStats.ts / telegram.ts
ฝั่งผู้ใช้:    SettingsView.tsx → telegramRouter.ts → notifSettings.ts
Mini App:     Telegram initData → telegramWebapp.ts → POST /api/auth/telegram-webapp
```

## 🔑 Environment Variables ที่เกี่ยวข้อง

| Variable | ใช้ทำอะไร |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token ของ bot (required — ไม่ตั้ง = bot no-op แต่เว็บรันได้) |
| `TELEGRAM_ADMIN_CHAT_ID` | chat สำหรับ system notification |
| `PUBLIC_APP_URL` | URL HTTPS ของเว็บ — เปิด Mini App + ปุ่ม "เปิดแอป" |
| `DATABASE_URL` | PostgreSQL connection |

Setup ทั้งหมดอยู่ใน [`DEVELOPMENT.md`](DEVELOPMENT.md) · โครงสร้างระบบรวมอยู่ใน [`ARCHITECTURE.md`](ARCHITECTURE.md)
