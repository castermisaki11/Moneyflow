// ────────────────────────────────────────────────────────────────────────
// Asia/Bangkok time helpers (fixed UTC+7, no DST — safe to compute by hand)
//
// Pulled out of scheduler.ts so both scheduler.ts and telegram.ts can use
// the same period math without telegram.ts having to import scheduler.ts
// (which already imports telegram.ts — that would be a circular import).
// ────────────────────────────────────────────────────────────────────────

export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export type PeriodKind = "daily" | "weekly" | "monthly" | "yearly";

export function toBangkokWallClock(ts: number): Date {
  // Fields read with the UTC getters below then represent Bangkok wall-clock time.
  return new Date(ts + BANGKOK_OFFSET_MS);
}

export function fromBangkokWallClock(y: number, m: number, d: number, h = 0, mi = 0, s = 0): number {
  return Date.UTC(y, m, d, h, mi, s) - BANGKOK_OFFSET_MS;
}

export function bangkokParts(now = Date.now()): { dateStr: string; hour: number; dow: number } {
  const bk = toBangkokWallClock(now);
  const y = bk.getUTCFullYear();
  const m = bk.getUTCMonth() + 1;
  const d = bk.getUTCDate();
  const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { dateStr, hour: bk.getUTCHours(), dow: bk.getUTCDay() }; // dow: 0 = Sunday
}

export function periodRange(period: PeriodKind, now = Date.now()): { from: number; to: number } {
  const bk = toBangkokWallClock(now);
  const y = bk.getUTCFullYear();
  const m = bk.getUTCMonth();
  const d = bk.getUTCDate();

  switch (period) {
    case "daily": {
      const start = fromBangkokWallClock(y, m, d);
      return { from: start, to: start + 86400000 - 1 };
    }
    case "weekly": {
      const dow = bk.getUTCDay(); // 0 = Sun
      const diffToMonday = (dow + 6) % 7;
      const start = fromBangkokWallClock(y, m, d - diffToMonday);
      return { from: start, to: start + 7 * 86400000 - 1 };
    }
    case "monthly": {
      const start = fromBangkokWallClock(y, m, 1);
      const end = fromBangkokWallClock(y, m + 1, 1) - 1;
      return { from: start, to: end };
    }
    case "yearly": {
      const start = fromBangkokWallClock(y, 0, 1);
      const end = fromBangkokWallClock(y + 1, 0, 1) - 1;
      return { from: start, to: end };
    }
  }
}

/**
 * How many days (including today) are left in the current Bangkok-local
 * month, counting today as 1. Used for "budget left per remaining day"
 * pacing math.
 */
export function daysRemainingInMonth(now = Date.now()): number {
  const bk = toBangkokWallClock(now);
  const y = bk.getUTCFullYear();
  const m = bk.getUTCMonth();
  const d = bk.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.max(1, lastDay - d + 1);
}
