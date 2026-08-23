# MoneyFlow — แผนที่ไฟล์ของ Telegram Bot

โครงสร้างจริงจาก `Moneyflowv10-fixed/` แบ่งตามชั้น (layer) ที่แต่ละไฟล์ทำงานอยู่

## 1. Entry point / bootstrap

| ไฟล์ | หน้าที่ |
|---|---|
| `server/_core/index.ts` | จุดสตาร์ทเซิร์ฟเวอร์ — เรียก `startTelegramPolling()` ตอนบูต (ถ้าไม่ตั้ง `TELEGRAM_BOT_TOKEN` จะ no-op) และผูก callback `linkTelegramChat` เข้ากับตอนที่ผู้ใช้เชื่อมบัญชีสำเร็จ |
| `server/_core/env.ts` | อ่านค่า env เช่น `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` |

## 2. แกนหลักของบอท (การรับ/ส่งข้อความ + ตรรกะทุกคำสั่ง)

| ไฟล์ | หน้าที่ |
|---|---|
| `server/_core/telegram.ts` (1,448 บรรทัด — ไฟล์ใหญ่สุด) | ไฟล์เดียวที่รวมทุกอย่างของบอท: <br>• ฟังก์ชันส่งข้อความ (`sendTelegramMessage`, `sendTelegramKeyboard`, `editTelegramMessage`, `sendTelegramDocument`)<br>• `startTelegramPolling()` — long-poll รับ update จาก Telegram<br>• `handleUpdate()` — router หลัก แยก `/start /help /summary /weekly /export /budget /goals /recent /wishlist /recurring /undo /reminders /remind` และ callback query (ปุ่ม inline)<br>• ตัวแยกข้อความอิสระ (natural language): `parseQuickTransaction`, `guessCategory`, `tryQuickAddFromChat`, `tryKeywordPeriodQuery`<br>• ตัวสร้างข้อความสรุปแต่ละแบบ: `buildSummaryMessage`, `buildWeeklySummaryMessage`, `buildGoalsMessage`, `buildRecentView`, `buildWishlistView`, `buildRecurringMessage`, `buildRemindersView`<br>• ตัว handle callback ปุ่มต่างๆ: `handleDeleteRecent`, `handleWishToggle`, `handleSetReminder`, `handleDeleteReminder`, `handleReminderDone`, `handleUndoDelete/Cancel`, `handlePendingCallback` (ยืนยัน/แก้หมวดหมู่รายการที่รอบันทึก)<br>• export CSV: `buildTransactionsCsv`, `handleExportCommand`<br>• `createLinkCode()` — สร้างโค้ดผูกบัญชีเว็บ↔แชท |
| `server/_core/reminderParser.ts` | แยกวิเคราะห์ข้อความเตือนภาษาไทยแบบอิสระ (เช่น "เตือนพรุ่งนี้ 9 โมง จ่ายค่าเน็ต") → วัน/เวลา/ความถี่ ใช้เฉพาะฝั่ง `/remind` |
| `server/_core/pacing.ts` | สร้างข้อความ "งบเหลือใช้ ÷ วันที่เหลือในเดือน" ใช้ทั้งใน `/budget` ของบอท และพรีวิวในหน้าเว็บ Settings |
| `server/_core/bangkokTime.ts` | ยูทิลเวลา/โซนเวลากรุงเทพ ใช้คำนวณช่วงวัน-สัปดาห์-เดือนสำหรับสรุป และคำนวณเวลาแจ้งเตือน |
| `server/_core/format.ts` | `escapeHtml`, `formatMoney` — ยูทิลจัดรูปข้อความ ใช้ทั่วทั้งบอท |

## 3. การเชื่อมบัญชี + การตั้งค่าแจ้งเตือน

| ไฟล์ | หน้าที่ |
|---|---|
| `server/_core/notifSettings.ts` | เก็บ/อ่าน state การแจ้งเตือนของแต่ละ user (เก็บเป็น JSON ใน `settings.notificationSettings`) — รวม `telegramChatId`, `telegramLinkedAt`, custom reminders, threshold ของ budget/goal alert ฯลฯ. มี `linkTelegramChat` / `unlinkTelegramChat` |
| `server/_core/telegramRouter.ts` | tRPC router ที่หน้าเว็บ (Settings) เรียกใช้: เช็คสถานะเชื่อมบัญชี, สร้างลิงก์เชื่อมบัญชีใหม่ (`createLink`), พรีวิวข้อความ pacing |
| `server/_core/scheduler.ts` | ตัวจับเวลา (ทำงานทุก 1 นาที) ที่ยิงข้อความอัตโนมัติ: เตือนรายวัน, pacing รายวัน, สรุปรายสัปดาห์, แจ้งเตือนงบ/เป้าหมาย/รายการประจำ, เช็ค custom reminder ที่ถึงเวลา — ทั้งหมดส่งผ่านฟังก์ชันใน `telegram.ts` |

## 4. Broadcast + สถิติสำหรับแอดมิน

| ไฟล์ | หน้าที่ |
|---|---|
| `server/_core/botRouter.ts` | tRPC router สำหรับหน้าแอดมิน "Bot" — `overview` (รวมสถิติ+สถานะ scheduler) และ `broadcast` (ส่งข้อความหาทุกคนที่เชื่อม Telegram) |
| `server/_core/botStats.ts` | รวบรวมข้อมูลสถิติดิบสำหรับ `botRouter.overview`: จำนวนผู้ใช้ที่เชื่อมบอท, reminder ที่จะถึง, ประวัติ broadcast |
| `server/_core/notification.ts` | ข้อความแจ้งเตือนระบบ/แอดมิน (`notifyOwner`) — ส่งเข้า `TELEGRAM_ADMIN_CHAT_ID` คนละทางกับการแจ้งเตือนรายผู้ใช้ |

## 5. ฝั่งเว็บ (UI)

| ไฟล์ | หน้าที่ |
|---|---|
| `client/src/components/views/BotView.tsx` | หน้าแอดมิน "Bot" — แสดงสถิติจาก `botRouter.overview`, ฟอร์ม broadcast, สถานะ scheduler |
| `client/src/components/views/SettingsView.tsx` | ส่วนที่ผู้ใช้ทั่วไปเชื่อม/ยกเลิกเชื่อม Telegram + ตั้งค่าการแจ้งเตือนแต่ละแบบ (เรียก `telegramRouter`) |

## 6. Database (ตารางที่บอทใช้)

| ตาราง (`drizzle/schema.ts`) | ใช้โดย |
|---|---|
| `settings.notificationSettings`, `settings.myAccountNumber` | `notifSettings.ts`, `telegram.ts` |
| `reminderLog` | บันทึกตอนกดปุ่ม "✅ เสร็จแล้ว" บน reminder — เขียนใน `handleReminderDone` (telegram.ts), อ่านใน `botStats.ts` |
| `botBroadcastLog` | ประวัติการ broadcast — เขียนใน `botRouter.ts`, แสดงใน `BotView.tsx` |
| `categoryFeedback` | log ✅/❌ ของการเดาหมวดหมู่ (`guessCategory`) — เขียนอยู่แต่ยังไม่มีที่อ่านไปใช้ต่อ |
| `attachments` | มีในสคีมา แต่ไม่มีไฟล์ไหนอ้างถึงเลย (ยังไม่ได้ต่อใช้งาน) |

---

### ไล่ตาม flow ข้อความ 1 ข้อความ (ภาพรวม)
```
Telegram → startTelegramPolling() [telegram.ts]
         → handleUpdate() [telegram.ts]
             ├─ callback_query → handle*Callback ฟังก์ชันต่างๆ [telegram.ts]
             ├─ /command → build*Message / handle*Command [telegram.ts]
             │              (ใช้ reminderParser.ts, pacing.ts, bangkokTime.ts)
             └─ ข้อความอิสระ → tryQuickAddFromChat / tryKeywordPeriodQuery [telegram.ts]
                                (ใช้ guessCategory + categoryFeedback log)

ฝั่งอัตโนมัติ: scheduler.ts (ทุก 1 นาที) → อ่าน notifSettings.ts → ยิงผ่าน telegram.ts
ฝั่งแอดมิน: BotView.tsx → botRouter.ts → botStats.ts / telegram.ts (broadcast)
ฝั่งผู้ใช้ตั้งค่า: SettingsView.tsx → telegramRouter.ts → notifSettings.ts
```
