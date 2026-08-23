export type TxType = "income" | "expense" | "saving";
export type Priority = "high" | "medium" | "low";
export type Freq = "weekly" | "monthly" | "yearly";
export type Period = "daily" | "weekly" | "monthly" | "yearly";

export const CATEGORIES: Record<TxType, string[]> = {
  income: ["💼 เงินเดือน", "💰 โบนัส", "📈 ลงทุน", "🎁 ของขวัญ", "🏠 ค่าเช่า", "🔧 งานฟรีแลนซ์", "อื่นๆ"],
  expense: [
    "🍜 อาหาร",
    "🚗 เดินทาง",
    "🛍️ ช้อปปิ้ง",
    "💊 สุขภาพ",
    "📚 การศึกษา",
    "🎬 บันเทิง",
    "🏠 ที่พัก",
    "📱 โทรศัพท์",
    "⚡ ค่าสาธารณูปโภค",
    "อื่นๆ",
  ],
  saving: ["🏦 ออมทรัพย์", "📊 กองทุน", "🪙 คริปโต", "🥇 ทอง", "อื่นๆ"],
};

export const TYPE_COLOR: Record<TxType, string> = {
  income: "#22c55e",
  expense: "#ef4444",
  saving: "#3b82f6",
};
export const TYPE_ICON: Record<TxType, string> = {
  income: "↑",
  expense: "↓",
  saving: "⧠",
};
export const TYPE_LABEL: Record<TxType, string> = {
  income: "รายรับ",
  expense: "รายจ่าย",
  saving: "ออม",
};

export const CURRENCIES = [
  { code: "THB", label: "฿ บาท" },
  { code: "USD", label: "$ ดอลลาร์" },
  { code: "EUR", label: "€ ยูโร" },
  { code: "GBP", label: "£ ปอนด์" },
  { code: "JPY", label: "¥ เยน" },
  { code: "CNY", label: "¥ หยวน" },
  { code: "KRW", label: "₩ วอน" },
  { code: "SGD", label: "S$ สิงคโปร์ดอลลาร์" },
  { code: "MYR", label: "RM ริงกิต" },
  { code: "VND", label: "₫ ด่อง" },
];

export function formatCurrency(amount: number | string | null | undefined, currency = "THB") {
  const n = typeof amount === "string" ? Number(amount) : amount ?? 0;
  try {
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(n || 0);
  } catch {
    return `${currency} ${Number(n).toLocaleString()}`;
  }
}

export function toNumber(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") return Number(x);
  return 0;
}

export function monthKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function isSameMonth(ts: number, ref = Date.now()) {
  return monthKey(ts) === monthKey(ref);
}
export function isSameDay(ts: number, ref = Date.now()) {
  return dayKey(ts) === dayKey(ref);
}

export function startOfMonthTs(ts: number) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
export function endOfMonthTs(ts: number) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
}
export function dateInputToTs(input: string) {
  // yyyy-mm-dd to local noon ts to avoid timezone drift
  const [y, m, d] = input.split("-").map((x) => Number(x));
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0).getTime();
}
export function tsToDateInput(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function weekKey(ts: number) {
  const d = new Date(ts);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return `${start.getFullYear()}-W${String(Math.ceil((start.getDate() + new Date(start.getFullYear(), start.getMonth(), 1).getDay()) / 7)).padStart(2, "0")}`;
}

export function isSameWeek(ts: number, ref = Date.now()) {
  return weekKey(ts) === weekKey(ref);
}

export function startOfWeekTs(ts: number) {
  const d = new Date(ts);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

export function endOfWeekTs(ts: number) {
  const d = new Date(ts);
  const end = new Date(d);
  end.setDate(d.getDate() - d.getDay() + 6);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

export function startOfDayTs(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDayTs(ts: number) {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function startOfYearTs(ts: number) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), 0, 1).getTime();
}

export function endOfYearTs(ts: number) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999).getTime();
}
