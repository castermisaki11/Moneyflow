# Telegram Bot — Moneyflow

เอกสารสรุปคำสั่งและฟีเจอร์ทั้งหมดของ Telegram Bot (แผนที่ไฟล์ละเอียดอยู่ใน [`../BOT FILES.md`](../BOT%20FILES.md))

## การเชื่อมบัญชี (Web ↔ Telegram)

1. ไปหน้าเว็บ **Settings** → กด "เชื่อม Telegram" → ระบบสร้าง link code (`createLinkCode()` ใน `telegram.ts`)
2. ผู้ใช้กดลิงก์/พิมพ์โค้ดในแชท → `linkTelegramChat()` ผูก `telegramChatId` เข้ากับ account
3. ตั้งค่าการแจ้งเตือนแต่ละประเภทได้จาก Settings (state เก็บใน `settings.notificationSettings`)
4. ยกเลิกเชื่อมได้ผ่าน `unlinkTelegramChat()`

## คำสั่งทั้งหมด

| คำสั่ง | หน้าที่ |
|---|---|
| `/start` | เริ่มต้นใช้งาน / เชื่อมบัญชี |
| `/help` | แสดงวิธีใช้ทั้งหมด |
| `/summary` | สรุปยอดวันนี้ |
| `/weekly` | สรุปยอดสัปดาห์นี้ |
| `/export` | Export รายการเป็นไฟล์ CSV (`buildTransactionsCsv`) |
| `/budget` | ดูงบประมาณ + pacing (งบเหลือ ÷ วันที่เหลือ) |
| `/goals` | ดูความคืบหน้าเป้าหมายออมเงิน |
| `/recent` | ดูรายการล่าสุด |
| `/wishlist` | ดูลิสต์ของที่อยากซื้อ |
| `/recurring` | ดูรายการประจำ |
| `/undo` | ย้อนลบรายการล่าสุด |
| `/reminders` | ดู reminder ที่ตั้งไว้ |
| `/remind` | ตั้งเตือนด้วยภาษาไทยแบบอิสระ เช่น "เตือนพรุ่งนี้ 9 โมง จ่ายค่าเน็ต" |

## ข้อความอิสระ (Natural Language)

พิมพ์ข้อความธรรมดาได้โดยไม่ต้องใช้คำสั่ง:

- **บันทึกรายการเร็ว** — `parseQuickTransaction` + `guessCategory` แยกยอดเงิน/หมวดหมู่อัตโนมัติ → ถ้าเดาไม่มั่นใจจะส่ง callback ให้ยืนยัน/แก้หมวด (`handlePendingCallback`)
- **ค้นหาตามคำ** — `tryKeywordPeriodQuery` ตอบสรุปตาม keyword ช่วงเวลา

## ปุ่ม Inline (Callback Query)

| Callback | หน้าที่ |
|---|---|
| `handleDeleteRecent` | ลบรายการล่าสุดจากหน้า `/recent` |
| `handleUndoDelete` / Cancel | ยืนยัน/ยกเลิก undo |
| `handleWishToggle` | ทำเครื่องหมาย wishlist ว่าซื้อแล้ว |
| `handleSetReminder` / `handleDeleteReminder` | จัดการ reminder |
| `handleReminderDone` | กด "✅ เสร็จแล้ว" → เขียน log ลง `reminderLog` |
| `handlePendingCallback` | ยืนยัน/แก้หมวดหมู่รายการที่รอบันทึก |

## การแจ้งเตือนอัตโนมัติ (scheduler.ts — ทุก 1 นาที)

- เตือนรายวัน + pacing รายวัน
- สรุปรายสัปดาห์
- แจ้งเตือนงบเกิน / เป้าหมายถึง milestone / รายการประจำครบกำหนด
- Custom reminders ที่ถึงเวลา (จาก `/remind`)

ทั้งหมดเช็ค on/off ต่อ user ผ่าน `notifSettings.ts`

## Admin

- **Broadcast:** หน้าเว็บแอดมิน **Bot** → `botRouter.broadcast()` ส่งหาทุก user ที่เชื่อม Telegram → เก็บ history ใน `botBroadcastLog`
- **สถิติ:** `botRouter.overview()` จาก `botStats.ts` — จำนวนผู้ใช้ที่เชื่อม, reminder ที่จะถึง, ประวัติ broadcast
- **System notification:** `notifyOwner()` ส่งเข้า `TELEGRAM_ADMIN_CHAT_ID` (แยกจาก notification รายผู้ใช้)

## Flow ภาพรวม

```
Telegram → startTelegramPolling() → handleUpdate()
  ├─ callback_query → handle*Callback
  ├─ /command       → build*Message / handle*Command
  │                   (reminderParser, pacing, bangkokTime)
  └─ ข้อความอิสระ    → tryQuickAddFromChat / tryKeywordPeriodQuery
                       (guessCategory + categoryFeedback log)
```
