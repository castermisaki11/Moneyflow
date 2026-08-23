// ────────────────────────────────────────────────────────────────────────
// Parses free-form Thai reminder commands typed into the Telegram bot, e.g.
//   "เตือนพรุ่งนี้ 9 โมง จ่ายค่าเน็ต"      → one-time, tomorrow 09:00
//   "เตือนทุกวัน 8 โมงเช้า กินยา"          → daily, 08:00, "กินยา"
//   "เตือนทุกสัปดาห์วันจันทร์ 9 โมง ประชุม" → weekly, next Monday 09:00
//   "เตือนทุกเดือน 1 โมง จ่ายค่าเช่า"       → monthly
// Kept intentionally simple (digit-based times, a fixed vocabulary of day
// words) rather than a full NLU pass — good enough for the common phrasings
// people actually type, with a clear usage hint when it can't parse.
// ────────────────────────────────────────────────────────────────────────

import { fromBangkokWallClock, toBangkokWallClock } from "./bangkokTime";

export type ReminderRecurrence = "once" | "daily" | "weekly" | "monthly";

export interface ParsedReminder {
  text: string;
  firstAt: number; // epoch ms of the first/next fire
  recurrence: ReminderRecurrence;
}

const WEEKDAY_WORDS: { re: RegExp; dow: number }[] = [
  { re: /วันจันทร์/, dow: 1 },
  { re: /วันอังคาร/, dow: 2 },
  { re: /วันพุธ/, dow: 3 },
  { re: /วันพฤหัสบดี|วันพฤหัส/, dow: 4 },
  { re: /วันศุกร์/, dow: 5 },
  { re: /วันเสาร์/, dow: 6 },
  { re: /วันอาทิตย์/, dow: 0 },
];

/** Strips the first regex match from `s` and returns both the remainder and the match (if any). */
function extract(s: string, re: RegExp): { rest: string; match: RegExpMatchArray | null } {
  const match = s.match(re);
  if (!match) return { rest: s, match: null };
  return { rest: (s.slice(0, match.index) + s.slice((match.index ?? 0) + match[0].length)), match };
}

function parseRecurrence(s: string): { rest: string; recurrence: ReminderRecurrence } {
  let m = s.match(/ทุกวัน/);
  if (m) return { rest: extract(s, /ทุกวัน/).rest, recurrence: "daily" };
  m = s.match(/ทุกสัปดาห์|ทุกอาทิตย์/);
  if (m) return { rest: extract(s, /ทุกสัปดาห์|ทุกอาทิตย์/).rest, recurrence: "weekly" };
  m = s.match(/ทุกเดือน/);
  if (m) return { rest: extract(s, /ทุกเดือน/).rest, recurrence: "monthly" };
  return { rest: s, recurrence: "once" };
}

/** Returns a day offset from today (0 = today, 1 = tomorrow, ...), or a specific weekday, if found. */
function parseDay(
  s: string,
  nowDow: number,
): { rest: string; dayOffset: number | null; weekday: number | null } {
  for (const w of WEEKDAY_WORDS) {
    const { rest, match } = extract(s, w.re);
    if (match) return { rest, dayOffset: null, weekday: w.dow };
  }
  {
    const { rest, match } = extract(s, /มะรืนนี้/);
    if (match) return { rest, dayOffset: 2, weekday: null };
  }
  {
    const { rest, match } = extract(s, /พรุ่งนี้/);
    if (match) return { rest, dayOffset: 1, weekday: null };
  }
  {
    const { rest, match } = extract(s, /วันนี้/);
    if (match) return { rest, dayOffset: 0, weekday: null };
  }
  return { rest: s, dayOffset: null, weekday: null };
}

/** Returns {hour, minute} in 24h format if a time expression is found, plus the string with it removed. */
function parseTime(s: string): { rest: string; hour: number; minute: number } | null {
  const half = (rest: string, hadHalf: boolean, hour: number) => ({
    rest,
    hour,
    minute: hadHalf ? 30 : 0,
  });

  // เที่ยงคืน / เที่ยง(วัน) — check before the general "N โมง" patterns.
  {
    const { rest, match } = extract(s, /เที่ยงคืน/);
    if (match) return half(rest, false, 0);
  }
  {
    const { rest, match } = extract(s, /เที่ยง(วัน)?/);
    if (match) return half(rest, false, 12);
  }
  // Direct clock format: 9:30, 21.00, 9 น.
  {
    const { rest, match } = extract(s, /(\d{1,2})[:.](\d{2})/);
    if (match) {
      const h = Number(match[1]);
      const mi = Number(match[2]);
      if (h <= 23 && mi <= 59) return { rest, hour: h, minute: mi };
    }
  }
  // ตี1 - ตี5 (1am - 5am)
  {
    const { rest, match } = extract(s, /ตี\s*(\d{1,2})(ครึ่ง)?/);
    if (match) {
      const h = Number(match[1]);
      if (h >= 1 && h <= 5) return half(rest, Boolean(match[2]), h);
    }
  }
  // บ่าย N โมง (ครึ่ง) → 12+N (1pm-6pm)
  {
    const { rest, match } = extract(s, /บ่าย\s*(\d{1,2})\s*โมง(ครึ่ง)?/);
    if (match) {
      const h = Number(match[1]);
      if (h >= 1 && h <= 6) return half(rest, Boolean(match[2]), 12 + h);
    }
  }
  // N โมงเช้า (ครึ่ง) → N am
  {
    const { rest, match } = extract(s, /(\d{1,2})\s*โมง\s*เช้า(ครึ่ง)?/);
    if (match) {
      const h = Number(match[1]) % 12;
      return half(rest, Boolean(match[2]), h);
    }
  }
  // N โมงเย็น (ครึ่ง) → afternoon/evening
  {
    const { rest, match } = extract(s, /(\d{1,2})\s*โมง\s*เย็น(ครึ่ง)?/);
    if (match) {
      const n = Number(match[1]);
      const h = n <= 11 ? 12 + n : n;
      return half(rest, Boolean(match[2]), h % 24);
    }
  }
  // N ทุ่ม (ครึ่ง) → 19:00 - 23:00ish (1 ทุ่ม = 19:00)
  {
    const { rest, match } = extract(s, /(\d{1,2})\s*ทุ่ม(ครึ่ง)?/);
    if (match) {
      const h = (18 + Number(match[1])) % 24;
      return half(rest, Boolean(match[2]), h);
    }
  }
  // N นาฬิกา → 24h format directly
  {
    const { rest, match } = extract(s, /(\d{1,2})\s*นาฬิกา(ครึ่ง)?/);
    if (match) {
      const h = Number(match[1]);
      if (h <= 23) return half(rest, Boolean(match[2]), h);
    }
  }
  // Plain "N โมง" (ครึ่ง) with no meridiem — treat as morning/midday (common colloquial default).
  {
    const { rest, match } = extract(s, /(\d{1,2})\s*โมง(ครึ่ง)?/);
    if (match) {
      const n = Number(match[1]);
      const h = n === 12 ? 12 : n % 12;
      return half(rest, Boolean(match[2]), h);
    }
  }
  return null;
}

/**
 * Parses a reminder command with the trigger word ("เตือน"/"/remind") already
 * stripped off. Returns null if no time expression could be found.
 */
export function parseReminderCommand(rawAfterTrigger: string, now = Date.now()): ParsedReminder | null {
  let s = rawAfterTrigger;

  const { rest: afterRecurrence, recurrence } = parseRecurrence(s);
  s = afterRecurrence;

  const nowBk = toBangkokWallClock(now);
  const nowDow = nowBk.getUTCDay();
  const { rest: afterDay, dayOffset, weekday } = parseDay(s, nowDow);
  s = afterDay;

  const timeResult = parseTime(s);
  if (!timeResult) return null;
  s = timeResult.rest;

  const y = nowBk.getUTCFullYear();
  const m = nowBk.getUTCMonth();
  const d = nowBk.getUTCDate();

  let targetDay = d;
  if (dayOffset !== null) {
    targetDay = d + dayOffset;
  } else if (weekday !== null) {
    let diff = (weekday - nowDow + 7) % 7;
    const candidateToday = fromBangkokWallClock(y, m, d, timeResult.hour, timeResult.minute);
    if (diff === 0 && candidateToday <= now) diff = 7;
    targetDay = d + diff;
  }

  let firstAt = fromBangkokWallClock(y, m, targetDay, timeResult.hour, timeResult.minute);

  // No explicit day given and the time already passed today → assume they mean the next
  // time it comes around (tomorrow), regardless of recurrence type.
  if (dayOffset === null && weekday === null && firstAt <= now) {
    firstAt = fromBangkokWallClock(y, m, d + 1, timeResult.hour, timeResult.minute);
  }

  // Clean up leftover punctuation/whitespace from the stripped-out tokens to get the message text.
  const text = s
    .replace(/[,，]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { text: text || "🔔 ถึงเวลาแล้ว!", firstAt, recurrence };
}

/** Advances a fired reminder's timestamp to its next occurrence, in Bangkok wall-clock terms. */
export function advanceReminder(firedAt: number, recurrence: ReminderRecurrence): number {
  const bk = toBangkokWallClock(firedAt);
  const y = bk.getUTCFullYear();
  const m = bk.getUTCMonth();
  const d = bk.getUTCDate();
  const h = bk.getUTCHours();
  const mi = bk.getUTCMinutes();
  switch (recurrence) {
    case "daily":
      return fromBangkokWallClock(y, m, d + 1, h, mi);
    case "weekly":
      return fromBangkokWallClock(y, m, d + 7, h, mi);
    case "monthly":
      return fromBangkokWallClock(y, m + 1, d, h, mi);
    default:
      return firedAt;
  }
}

export const REMINDER_USAGE_TEXT = [
  "รูปแบบ: <code>เตือน [ทุกวัน/ทุกสัปดาห์/ทุกเดือน] [วันนี้/พรุ่งนี้/วันจันทร์...] เวลา ข้อความ</code>",
  "ตัวอย่าง:",
  "• <code>เตือนพรุ่งนี้ 9 โมง จ่ายค่าเน็ต</code>",
  "• <code>เตือนทุกวัน 8 โมงเช้า กินยา</code>",
  "• <code>เตือนทุกสัปดาห์วันจันทร์ 9 โมง ประชุมทีม</code>",
  "• <code>เตือนทุกเดือน 1 โมง จ่ายค่าเช่า</code>",
].join("\n");
