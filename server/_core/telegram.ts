import {
  createTransaction,
  deleteTransaction,
  findUserIdByTelegramChatId,
  getSettings,
  listGoals,
  listRecurring,
  listTransactions,
  listWishlist,
  logReminderDone,
  toggleWishBought,
} from "../db";
import { periodRange, toBangkokWallClock, type PeriodKind } from "./bangkokTime";
import { CACHE_TTL, getOrSet, telegramSummaryKey } from "./cache";
import { ENV } from "./env";
import { escapeHtml, formatMoney } from "./format";
import { getNotifSettings, saveNotifSettings, type CustomReminder } from "./notifSettings";
import { buildPacingMessage } from "./pacing";
import { parseReminderCommand, REMINDER_USAGE_TEXT } from "./reminderParser";
import { handleReceiptPhoto } from "./receiptPhoto";

// Re-exported so existing callers (scheduler.ts) that import these from
// "./telegram" keep working — the implementations now live in format.ts.
export { escapeHtml, formatMoney };

/**
 * Thin wrapper around the Telegram Bot API.
 *
 * This module is the single place that talks to Telegram. Everything else
 * (scheduler, tRPC routers, admin notifyOwner) goes through the functions
 * exported here so that adding new notification *types* later never needs
 * new Telegram plumbing — only a new call to `sendTelegramMessage`.
 */

const API_BASE = "https://api.telegram.org";

function apiUrl(method: string): string {
  return `${API_BASE}/bot${ENV.telegramBotToken}/${method}`;
}

export function isTelegramConfigured(): boolean {
  return Boolean(ENV.telegramBotToken);
}

/**
 * Send a message to a single Telegram chat. Returns false (never throws) on
 * any failure so callers (scheduler loops, routers) can stay simple.
 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!isTelegramConfigured() || !chatId) return false;
  try {
    const res = await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      console.warn("[Telegram] sendMessage failed:", data?.description ?? res.statusText);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[Telegram] sendMessage error:", err);
    return false;
  }
}

export type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; web_app: { url: string } };
export type InlineKeyboard = InlineKeyboardButton[][];

/** Sends a message with an inline keyboard attached. Returns the new message_id (needed to edit it later), or null on failure. */
export async function sendTelegramKeyboard(
  chatId: string,
  text: string,
  keyboard: InlineKeyboard,
): Promise<number | null> {
  if (!isTelegramConfigured() || !chatId) return null;
  try {
    const res = await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: keyboard },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      console.warn("[Telegram] sendMessage(keyboard) failed:", data?.description ?? res.statusText);
      return null;
    }
    return data.result?.message_id ?? null;
  } catch (err) {
    console.warn("[Telegram] sendMessage(keyboard) error:", err);
    return null;
  }
}

/** Edits an existing message's text and/or inline keyboard in place. Pass an empty array to remove the keyboard. */
export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<boolean> {
  if (!isTelegramConfigured() || !chatId) return false;
  try {
    const res = await fetch(apiUrl("editMessageText"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(keyboard !== undefined ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      console.warn("[Telegram] editMessageText failed:", data?.description ?? res.statusText);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[Telegram] editMessageText error:", err);
    return false;
  }
}

/** Sends a file (e.g. CSV export) as a Telegram document. `content` is the raw file text; sent as UTF-8. Returns false (never throws) on failure. */
export async function sendTelegramDocument(
  chatId: string,
  filename: string,
  content: string,
  caption?: string,
): Promise<boolean> {
  if (!isTelegramConfigured() || !chatId) return false;
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption);
    form.append("document", new Blob([content], { type: "text/csv;charset=utf-8" }), filename);
    const res = await fetch(apiUrl("sendDocument"), { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      console.warn("[Telegram] sendDocument failed:", data?.description ?? res.statusText);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[Telegram] sendDocument error:", err);
    return false;
  }
}

/** Acknowledges a button tap so Telegram stops showing the little loading spinner on it. */
async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  if (!isTelegramConfigured()) return;
  try {
    await fetch(apiUrl("answerCallbackQuery"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    });
  } catch (err) {
    console.warn("[Telegram] answerCallbackQuery error:", err);
  }
}

/** Registers the slash-command menu shown by Telegram's "/" autocomplete. Fire-and-forget; failure just means no menu, nothing breaks. */
async function setBotCommands(): Promise<void> {
  if (!isTelegramConfigured()) return;
  try {
    await fetch(apiUrl("setMyCommands"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "help", description: "วิธีใช้งานและคำสั่งทั้งหมด" },
          { command: "summary", description: "สรุปวันนี้และเดือนนี้" },
          { command: "weekly", description: "สรุปรายสัปดาห์นี้" },
          { command: "budget", description: "เงินเหลือใช้ต่อวันเทียบกับงบ" },
          { command: "goals", description: "ความคืบหน้าเป้าหมายการออม" },
          { command: "recent", description: "รายการล่าสุด (ลบได้จากปุ่ม)" },
          { command: "wishlist", description: "สิ่งที่อยากได้" },
          { command: "recurring", description: "รายการประจำ" },
          { command: "export", description: "ส่งออกรายการเป็น CSV" },
          { command: "undo", description: "ลบรายการล่าสุด" },
          { command: "reminders", description: "ดูรายการเตือนทั้งหมด" },
          { command: "remind", description: "ตั้งเตือน เช่น /remind พรุ่งนี้ 9 โมง จ่ายค่าเน็ต" },
          { command: "interval", description: "ความถี่เตือน เช่น /interval 30 หรือ /interval daily" },
        ],
      }),
    });
  } catch (err) {
    console.warn("[Telegram] setMyCommands error:", err);
  }
}

let cachedBotUsername: string | null = null;

/** Resolve the bot's @username, used to build the t.me deep link shown in Settings. */
export async function getBotUsername(): Promise<string | null> {
  if (!isTelegramConfigured()) return null;
  if (ENV.telegramBotUsername) return ENV.telegramBotUsername;
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const res = await fetch(apiUrl("getMe"));
    const data = await res.json().catch(() => null);
    if (data?.ok && data.result?.username) {
      cachedBotUsername = data.result.username as string;
      return cachedBotUsername;
    }
  } catch (err) {
    console.warn("[Telegram] getMe error:", err);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Account linking (deep-link code flow)
// ────────────────────────────────────────────────────────────────────────
// 1. User taps "เชื่อมต่อ Telegram" in the app → server makes a short-lived
//    code tied to their userId (createLinkCode).
// 2. The app opens t.me/<bot>?start=<code> in Telegram.
// 3. Telegram sends the bot a "/start <code>" message, which the long-poll
//    loop below picks up and hands to `onLinked` to persist the chat id.

type PendingLink = { userId: number; expiresAt: number };
const pendingLinks = new Map<string, PendingLink>();
const LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function createLinkCode(userId: number): string {
  const now = Date.now();
  for (const [code, v] of pendingLinks) if (v.expiresAt < now) pendingLinks.delete(code);

  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  pendingLinks.set(code, { userId, expiresAt: now + LINK_CODE_TTL_MS });
  return code;
}

function consumeLinkCode(code: string): number | null {
  const entry = pendingLinks.get(code.toUpperCase());
  if (!entry) return null;
  pendingLinks.delete(code.toUpperCase());
  if (entry.expiresAt < Date.now()) return null;
  return entry.userId;
}

let pollingStarted = false;
let pollOffset = 0;

/**
 * Starts an infinite long-polling loop against Telegram's getUpdates.
 * No public webhook URL is required, so this works the same on any host.
 * `onLinked` is called once a valid /start <code> is matched to a user.
 */
/** Inline keyboard row with a Telegram WebApp button (empty when PUBLIC_APP_URL is unset). */
function webAppKeyboardRow(): InlineKeyboardButton[] {
  if (!ENV.publicAppUrl) return [];
  return [{ text: "\u{1F310} \u0E40\u0E1B\u0E34\u0E14 MoneyFlow", web_app: { url: ENV.publicAppUrl } }];
}

/** Registers the persistent chat menu button ("\u0E40\u0E1B\u0E34\u0E14\u0E41\u0E2D\u0E1B") so every user can launch the mini app from any chat. */
function setupWebAppMenuButton(): void {
  if (!ENV.publicAppUrl) return;
  void fetch(apiUrl("setChatMenuButton"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu_button: { type: "web_app", text: "\u0E40\u0E1B\u0E34\u0E14\u0E41\u0E2D\u0E1B", web_app: { url: ENV.publicAppUrl } } }),
  }).catch(() => {});
}

export function startTelegramPolling(onLinked: (userId: number, chatId: string) => Promise<void> | void): void {
  if (pollingStarted || !isTelegramConfigured()) return;
  pollingStarted = true;
  console.log("[Telegram] Long polling started.");
  void setBotCommands();
  setupWebAppMenuButton();

  const scheduleNext = (delayMs = 0) => setTimeout(poll, delayMs);

  // "Conflict: terminated by other getUpdates request" means a second process
  // (old instance mid-deploy, an extra Render instance, a local dev run, …) is
  // also polling with the same bot token — Telegram only allows one long-poll
  // consumer at a time. Back off with growing delay instead of hammering the
  // API every 5s, since a tight retry loop just prolongs the conflict and
  // floods the logs. Resets to the normal 5s retry once a call succeeds again.
  let conflictBackoffMs = 5000;
  const CONFLICT_BACKOFF_MAX_MS = 60000;

  async function poll() {
    try {
      const res = await fetch(apiUrl("getUpdates") + `?timeout=25&offset=${pollOffset}`);
      const data = await res.json().catch(() => null);

      if (data?.ok && Array.isArray(data.result)) {
        conflictBackoffMs = 5000;
        for (const update of data.result) {
          pollOffset = Math.max(pollOffset, update.update_id + 1);
          await handleUpdate(update, onLinked);
        }
        scheduleNext();
      } else if (typeof data?.description === "string" && data.description.includes("Conflict")) {
        console.warn(`[Telegram] getUpdates conflict — another instance is polling. Retrying in ${Math.round(conflictBackoffMs / 1000)}s.`);
        scheduleNext(conflictBackoffMs);
        conflictBackoffMs = Math.min(conflictBackoffMs * 2, CONFLICT_BACKOFF_MAX_MS);
      } else {
        console.warn("[Telegram] getUpdates error:", data?.description ?? "unknown");
        scheduleNext(5000);
      }
    } catch (err) {
      console.warn("[Telegram] polling error:", err);
      scheduleNext(5000);
    }
  }

  poll();
}

// ────────────────────────────────────────────────────────────────────────
// Quick-add: type "กาแฟ 60" (or "+เงินเดือน 15000" for income) straight in
// the chat and the bot records it as a transaction — no need to open the app.
// Category tables below mirror CATEGORIES in client/src/lib/money.ts so a
// guessed category always matches something the app's own category picker
// already knows about.
// ────────────────────────────────────────────────────────────────────────

const EXPENSE_KEYWORDS: Record<string, string[]> = {
  "🍜 อาหาร": [
    "กาแฟ", "ข้าว", "อาหาร", "กิน", "ขนม", "เครื่องดื่ม", "ก๋วยเตี๋ยว", "ชา", "น้ำ", "บุฟเฟ่ต์", "ร้านอาหาร", "ส้มตำ", "ชานม",
    "มื้อเช้า", "มื้อเที่ยง", "มื้อเย็น", "ก๋วยจั๊บ", "หมูกระทะ", "ชาบู", "สุกี้", "เค้ก", "เบเกอรี่", "ขนมปัง",
    "แมค", "kfc", "ไก่ทอด", "พิซซ่า", "ซูชิ", "ร้านกาแฟ", "สตาร์บัคส์", "อเมริกาโน่", "ลาเต้", "คาปูชิโน่",
    "น้ำอัดลม", "เบียร์", "ไวน์", "เหล้า", "สุรา", "foodpanda", "grabfood", "lineman", "ตลาด", "เซเว่น", "7-11",
    "บิ๊กซี", "big c", "โลตัส", "lotus", "ก๋วยเตี๋ยวเรือ", "ผลไม้", "ของหวาน", "ไอศกรีม", "ชานมไข่มุก",
  ],
  "🚗 เดินทาง": [
    "แท็กซี่", "น้ำมัน", "รถ", "bts", "mrt", "arl", "วิน", "มอไซค์", "แกร็บ", "grab", "taxi", "ค่ารถ", "ทางด่วน", "จอดรถ",
    "รถไฟฟ้า", "รถเมล์", "รถทัวร์", "เครื่องบิน", "ตั๋วเครื่องบิน", "เติมน้ำมัน", "ปั๊มน้ำมัน", "ปั๊ม", "ล้างรถ",
    "ซ่อมรถ", "เปลี่ยนยาง", "bolt", "รถไฟ", "ตั๋วรถ", "ค่าทางด่วน", "วินมอไซค์",
  ],
  "🛍️ ช้อปปิ้ง": [
    "ช้อป", "เสื้อผ้า", "shopee", "lazada", "ซื้อของ", "รองเท้า", "กระเป๋า", "amazon", "aliexpress", "ห้าง",
    "เซ็นทรัล", "เดอะมอลล์", "เครื่องสำอาง", "สกินแคร์", "น้ำหอม", "เครื่องประดับ", "นาฬิกา", "แว่นตา",
  ],
  "💊 สุขภาพ": [
    "หมอ", "ยา", "โรงพยาบาล", "คลินิก", "ฟิตเนส", "ประกัน", "ทันตกรรม", "หมอฟัน", "วิตามิน", "อาหารเสริม",
    "gym", "ยิม", "นวด", "สปา", "ตรวจสุขภาพ",
  ],
  "📚 การศึกษา": ["คอร์ส", "หนังสือ", "เรียน", "ติว", "อบรม", "สัมมนา", "ค่าเทอม", "ลงทะเบียนเรียน", "อุปกรณ์การเรียน", "ปากกา"],
  "🎬 บันเทิง": [
    "หนัง", "เกม", "คอนเสิร์ต", "netflix", "spotify", "เที่ยว", "ดูหนัง", "โรงหนัง", "major", "sf cinema",
    "ทัวร์", "ท่องเที่ยว", "disney", "youtube premium", "apple music", "joox", "steam", "playstation",
  ],
  "🏠 ที่พัก": ["ค่าเช่า", "หอ", "คอนโด", "ค่าห้อง", "มัดจำ", "โรงแรม", "ที่พัก", "hotel", "airbnb"],
  "📱 โทรศัพท์": ["เติมเงิน", "มือถือ", "เน็ต", "ค่าโทร", "ค่าซิม", "dtac", "ais", "true", "แพ็กเกจเน็ต"],
  "⚡ ค่าสาธารณูปโภค": ["ค่าน้ำ", "ค่าไฟ", "ค่าเน็ตบ้าน", "ค่าส่วนกลาง", "ค่าแก๊ส", "ค่าเก็บขยะ", "ค่ารักษาความปลอดภัย"],
};
const INCOME_KEYWORDS: Record<string, string[]> = {
  "💼 เงินเดือน": ["เงินเดือน", "salary", "เงินเดือนออก"],
  "💰 โบนัส": ["โบนัส", "bonus"],
  "📈 ลงทุน": ["ปันผล", "หุ้น", "กำไร", "เงินปันผล", "ดอกเบี้ย", "กำไรหุ้น", "dividend"],
  "🎁 ของขวัญ": ["ของขวัญ", "แต๊ะเอีย", "อั่งเปา", "เงินขวัญถุง"],
  "🏠 ค่าเช่า": ["ค่าเช่า", "ปล่อยเช่า", "ผู้เช่า", "ค่าห้อง"],
  "🔧 งานฟรีแลนซ์": ["ฟรีแลนซ์", "รับงาน", "ค่าจ้าง", "ค่าคอมมิชชั่น", "commission"],
};
const SAVING_KEYWORDS: Record<string, string[]> = {
  "🏦 ออมทรัพย์": ["ออม", "ฝากออม", "เก็บเงิน", "บัญชีออมทรัพย์"],
  "📊 กองทุน": ["กองทุน", "ssf", "rmf", "dca"],
  "🪙 คริปโต": ["บิทคอยน์", "bitcoin", "btc", "eth", "อีเธอเรียม", "คริปโต", "crypto"],
  "🥇 ทอง": ["ทองคำ", "ซื้อทอง", "ทองรูปพรรณ", "ทองแท่ง"],
};

// Mirrors CATEGORIES in client/src/lib/money.ts — kept as a separate literal
// here (rather than imported) because server/ and client/ are separate
// build targets. Used to build the "เปลี่ยนหมวด" inline keyboard picker.
const CATEGORY_LIST: Record<"income" | "expense" | "saving", string[]> = {
  income: ["💼 เงินเดือน", "💰 โบนัส", "📈 ลงทุน", "🎁 ของขวัญ", "🏠 ค่าเช่า", "🔧 งานฟรีแลนซ์", "อื่นๆ"],
  expense: [
    "🍜 อาหาร", "🚗 เดินทาง", "🛍️ ช้อปปิ้ง", "💊 สุขภาพ", "📚 การศึกษา",
    "🎬 บันเทิง", "🏠 ที่พัก", "📱 โทรศัพท์", "⚡ ค่าสาธารณูปโภค", "อื่นๆ",
  ],
  saving: ["🏦 ออมทรัพย์", "📊 กองทุน", "🪙 คริปโต", "🥇 ทอง", "อื่นๆ"],
};

type CatType = "income" | "expense" | "saving";
type CategoryMap = Record<CatType, string[]>;

/** Safely parses the JSON-string category override columns from `settings` ({ income, expense, saving } string arrays). */
function parseCategoryJson(raw: string | null | undefined): Partial<CategoryMap> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Strips a leading emoji/symbol (and following space) off a category label, e.g. "🍜 อาหาร" -> "อาหาร". */
function stripLeadingEmoji(label: string): string {
  return label.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

/**
 * Loads the user's effective category lists — mirrors `useMergedCategories`
 * in client/src/pages/MoneyFlow.tsx plus the delete filtering in
 * SettingsView.tsx: custom categories the user added, followed by the
 * built-in defaults minus any the user removed. This is what makes a
 * category added in the app (e.g. "ค่าน้ำมัน") show up in the bot too.
 */
async function getEffectiveCategories(userId: number): Promise<CategoryMap> {
  const row = await getSettings(userId).catch(() => undefined);
  const custom = parseCategoryJson(row?.customCategories);
  const deleted = parseCategoryJson((row as any)?.deletedDefaultCategories);
  const merge = (type: CatType): string[] => {
    const visible = CATEGORY_LIST[type].filter((c) => !(deleted[type] ?? []).includes(c));
    return [...(custom[type] ?? []), ...visible];
  };
  return { income: merge("income"), expense: merge("expense"), saving: merge("saving") };
}

function guessCategory(type: CatType, note: string, categories: CategoryMap): string | null {
  const t = note.toLowerCase();
  if (!t) return null;
  const allowed = new Set(categories[type]);
  const table = type === "income" ? INCOME_KEYWORDS : type === "saving" ? SAVING_KEYWORDS : EXPENSE_KEYWORDS;
  for (const [category, keywords] of Object.entries(table)) {
    // Skip a built-in category the user has deleted from their picker.
    if (!allowed.has(category)) continue;
    if (keywords.some((k) => t.includes(k.toLowerCase()))) return category;
  }
  // Custom categories have no keyword list to match against, so fall back
  // to matching the category's own label (minus its leading emoji) as a
  // keyword — e.g. a custom category "⛽ ค่าน้ำมัน" matches a note like
  // "เติมค่าน้ำมัน".
  for (const category of categories[type]) {
    if (table[category]) continue; // already tried above
    const label = stripLeadingEmoji(category).toLowerCase();
    if (label && t.includes(label)) return category;
  }
  return null;
}

const INCOME_HINT_RE = /^(รับ|รายรับ|เงินเข้า|ได้เงิน)\s*/;
const SAVING_HINT_RE = /^(ออม|เก็บเงิน|ฝากออม|ฝากเงิน)\s*/;

interface ParsedQuickTx {
  type: "income" | "expense" | "saving";
  amount: number;
  note: string | null;
  category: string | null;
}

/** Parses free-text like "กาแฟ 60" / "+เงินเดือน 15000" / "รับเงิน 500 ค่าขนม" / "ออม 1000 กองทุน". Returns null if no amount found. */
function parseQuickTransaction(raw: string, categories: CategoryMap): ParsedQuickTx | null {
  let text = raw.trim();
  if (!text) return null;

  let type: "income" | "expense" | "saving" = "expense";
  if (text.startsWith("+")) {
    type = "income";
    text = text.slice(1).trim();
  } else if (text.startsWith("-")) {
    type = "expense";
    text = text.slice(1).trim();
  } else if (INCOME_HINT_RE.test(text)) {
    type = "income";
    text = text.replace(INCOME_HINT_RE, "");
  } else if (SAVING_HINT_RE.test(text)) {
    type = "saving";
    text = text.replace(SAVING_HINT_RE, "");
  }

  const match = text.match(/\d+(?:[.,]\d{1,2})?/);
  if (!match || match.index === undefined) return null;

  const amount = parseFloat(match[0].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const note =
    (text.slice(0, match.index) + text.slice(match.index + match[0].length))
      .replace(/\s{2,}/g, " ")
      .trim() || null;

  return { type, amount, note, category: guessCategory(type, note ?? "", categories) };
}

// ────────────────────────────────────────────────────────────────────────
// Confirm-before-save flow: a quick-add message no longer inserts straight
// away. It's held as a "pending" entry and shown with an inline keyboard
// (ยืนยัน / เปลี่ยนหมวด / ยกเลิก). Only on "ยืนยัน" does it actually hit the
// database. If the category was auto-guessed (not picked by hand), we also
// ask a quick ✅/❌ feedback question afterwards and log it — a first step
// toward eventually tuning `guessCategory` from real usage per user.
// ────────────────────────────────────────────────────────────────────────

interface PendingTx {
  userId: number;
  chatId: string;
  messageId: number;
  type: "income" | "expense" | "saving";
  amount: number;
  note: string | null;
  category: string | null;
  guessedCategory: string | null; // the original auto-guess, kept even after a manual override
  categoryManuallySet: boolean;
  createdAt: number;
}

const pendingTx = new Map<string, PendingTx>();
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes

function newPendingId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function sweepExpiredPending(): void {
  const now = Date.now();
  for (const [id, p] of pendingTx) if (now - p.createdAt > PENDING_TTL_MS) pendingTx.delete(id);
}

function typeLabel(type: PendingTx["type"]): string {
  return type === "income" ? "รายรับ" : type === "saving" ? "เงินออม" : "รายจ่าย";
}
function typeEmoji(type: PendingTx["type"]): string {
  return type === "income" ? "💰" : type === "saving" ? "🏦" : "🧾";
}

function confirmSummaryText(p: PendingTx): string {
  const lines = [`${typeEmoji(p.type)} บันทึก${typeLabel(p.type)} ${formatMoney(p.amount)} ใช่ไหม?`];
  lines.push(`หมวด: ${p.category ? escapeHtml(p.category) : "(ไม่ระบุ)"}`);
  if (p.note) lines.push(`รายการ: ${escapeHtml(p.note)}`);
  return lines.join("\n");
}

function confirmKeyboard(id: string): InlineKeyboard {
  return [
    [
      { text: "✅ ยืนยัน", callback_data: `confirm:${id}` },
      { text: "✏️ เปลี่ยนหมวด", callback_data: `chcat:${id}` },
      { text: "🗑 ยกเลิก", callback_data: `cancel:${id}` },
    ],
  ];
}

function categoryKeyboard(id: string, cats: string[]): InlineKeyboard {
  const rows: InlineKeyboard = [];
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(
      cats.slice(i, i + 2).map((_, j) => ({ text: cats[i + j], callback_data: `setcat:${id}:${i + j}` })),
    );
  }
  rows.push([{ text: "⬅️ กลับ", callback_data: `back:${id}` }]);
  return rows;
}

const NOT_LINKED_TEXT =
  "ยังไม่ได้เชื่อมต่อบัญชี MoneyFlow กับแชทนี้ครับ 🙏\nเปิดแอป แล้วไปที่ ตั้งค่า → แจ้งเตือน Telegram เพื่อเชื่อมต่อก่อน";

/** Resolves the linked userId for a chat, sending the "not linked yet" message and returning null if there isn't one. Use at the top of any command that needs account data. */
async function requireUserId(chatId: string): Promise<number | null> {
  const userId = await findUserIdByTelegramChatId(chatId);
  if (!userId) {
    await sendTelegramMessage(chatId, NOT_LINKED_TEXT);
    return null;
  }
  return userId;
}

function progressBar(ratio: number, size = 10): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(clamped * size);
  return "▓".repeat(filled) + "░".repeat(size - filled);
}

/** "วันนี้/เดือนนี้" totals per type, /summary command (also triggered by a few common Thai phrasings). */
async function buildSummaryMessage(userId: number): Promise<string> {
  return getOrSet(telegramSummaryKey(userId, "daily-monthly"), CACHE_TTL.transactions, async () => {
    const today = periodRange("daily");
    const month = periodRange("monthly");
    const [todayTx, monthTx] = await Promise.all([
      listTransactions(userId, { from: today.from, to: today.to }),
      listTransactions(userId, { from: month.from, to: month.to }),
    ]);

    const sumOf = (txs: typeof todayTx, type: PendingTx["type"]) =>
      txs.filter((t) => t.type === type).reduce((s, t) => s + Number(t.amount), 0);

    const block = (label: string, txs: typeof todayTx) => {
      const income = sumOf(txs, "income");
      const expense = sumOf(txs, "expense");
      const saving = sumOf(txs, "saving");
      return [
        `<b>${label}</b>`,
        `💰 รายรับ: ${formatMoney(income)}`,
        `🧾 รายจ่าย: ${formatMoney(expense)}`,
        `🏦 เงินออม: ${formatMoney(saving)}`,
        `⚖️ คงเหลือสุทธิ: ${formatMoney(income - expense - saving)}`,
      ].join("\n");
    };

    return ["📊 <b>สรุปการเงิน</b>", "", block("วันนี้", todayTx), "", block("เดือนนี้", monthTx)].join("\n");
  });
}

/**
 * Free-text keyword search, e.g. "กาแฟเดือนนี้" → all transactions this
 * month whose category or note contains "กาแฟ", summed and listed.
 * Triggered by KEYWORD_PERIOD_RE below (word + วันนี้/สัปดาห์นี้/เดือนนี้).
 */
async function buildKeywordSummaryMessage(
  userId: number,
  keyword: string,
  period: PeriodKind,
  periodLabel: string,
): Promise<string> {
  const range = periodRange(period);
  const txs = await listTransactions(userId, { from: range.from, to: range.to });
  const matched = txs.filter(
    (t) => (t.category && t.category.includes(keyword)) || (t.note && t.note.includes(keyword)),
  );

  if (matched.length === 0) {
    return `🔍 ไม่พบรายการที่มีคำว่า "${escapeHtml(keyword)}" ใน${periodLabel}ครับ`;
  }

  const total = matched.reduce((s, t) => s + Number(t.amount), 0);
  const lines = [
    `🔍 <b>${escapeHtml(keyword)}</b> — ${periodLabel}`,
    "",
    `พบ ${matched.length} รายการ รวม ${formatMoney(total)}`,
    "",
  ];

  const shown = matched.slice(0, 10);
  for (const t of shown) {
    const bk = toBangkokWallClock(t.occurredAt);
    const d = `${String(bk.getUTCDate()).padStart(2, "0")}/${String(bk.getUTCMonth() + 1).padStart(2, "0")}`;
    const catPart = t.category ? ` • ${escapeHtml(t.category)}` : "";
    const notePart = t.note ? ` — ${escapeHtml(t.note)}` : "";
    lines.push(`${typeEmoji(t.type as PendingTx["type"])} ${d} ${formatMoney(Number(t.amount))}${catPart}${notePart}`);
  }
  if (matched.length > shown.length) {
    lines.push("", `…และอีก ${matched.length - shown.length} รายการ`);
  }

  return lines.join("\n");
}

/**
 * "สรุปรายสัปดาห์" — totals + top 3 expense categories for the current
 * Bangkok-local week (Mon–Sun). Used both by the scheduler's Sunday-evening
 * push and available on demand as /weekly.
 */
export async function buildWeeklySummaryMessage(userId: number): Promise<string> {
  return getOrSet(telegramSummaryKey(userId, "weekly"), CACHE_TTL.transactions, async () => {
    const week = periodRange("weekly");
    const txs = await listTransactions(userId, { from: week.from, to: week.to });

    const sumOf = (type: PendingTx["type"]) =>
      txs.filter((t) => t.type === type).reduce((s, t) => s + Number(t.amount), 0);
    const income = sumOf("income");
    const expense = sumOf("expense");
    const saving = sumOf("saving");

    const byCategory = new Map<string, number>();
    for (const t of txs) {
      if (t.type !== "expense") continue;
      const cat = t.category || "ไม่ระบุหมวด";
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + Number(t.amount));
    }
    const topCats = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    const lines = [
      "🗓 <b>สรุปรายสัปดาห์นี้</b>",
      "",
      `💰 รายรับ: ${formatMoney(income)}`,
      `🧾 รายจ่าย: ${formatMoney(expense)}`,
      `🏦 เงินออม: ${formatMoney(saving)}`,
      `⚖️ คงเหลือสุทธิ: ${formatMoney(income - expense - saving)}`,
    ];

    if (topCats.length > 0) {
      lines.push("", "🏆 <b>ใช้จ่ายเยอะสุด</b>");
      for (const [cat, amount] of topCats) lines.push(`• ${escapeHtml(cat)}: ${formatMoney(amount)}`);
    }

    return lines.join("\n");
  });
}

/** Escapes a single CSV field: wraps in quotes (and doubles internal quotes) whenever it contains a comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Builds a CSV export of transactions for the given period. Returns the raw
 * text (UTF-8 with a BOM so Excel/Thai locales open it without mangling
 * Thai text) plus a suggested filename. Used by /export.
 */
async function buildTransactionsCsv(
  userId: number,
  period: PeriodKind,
): Promise<{ filename: string; content: string; count: number }> {
  const range = periodRange(period);
  const txs = await listTransactions(userId, { from: range.from, to: range.to });
  // listTransactions orders newest-first; CSV reads better chronologically.
  const rows = [...txs].sort((a, b) => a.occurredAt - b.occurredAt);

  const header = ["วันที่", "เวลา", "ประเภท", "จำนวนเงิน", "หมวด", "รายการ"];
  const lines = [header.map(csvField).join(",")];
  for (const t of rows) {
    const bk = toBangkokWallClock(t.occurredAt);
    const dateStr = `${bk.getUTCFullYear()}-${String(bk.getUTCMonth() + 1).padStart(2, "0")}-${String(bk.getUTCDate()).padStart(2, "0")}`;
    const timeStr = `${String(bk.getUTCHours()).padStart(2, "0")}:${String(bk.getUTCMinutes()).padStart(2, "0")}`;
    lines.push(
      [
        dateStr,
        timeStr,
        typeLabel(t.type as PendingTx["type"]),
        String(Number(t.amount)),
        t.category ?? "",
        t.note ?? "",
      ]
        .map((v) => csvField(String(v)))
        .join(","),
    );
  }

  const bk = toBangkokWallClock(range.from);
  const stamp = `${bk.getUTCFullYear()}-${String(bk.getUTCMonth() + 1).padStart(2, "0")}${period === "daily" ? `-${String(bk.getUTCDate()).padStart(2, "0")}` : ""}`;
  const filename = `moneyflow-${period}-${stamp}.csv`;
  return { filename, content: "\uFEFF" + lines.join("\n"), count: rows.length };
}

const EXPORT_PERIOD_MAP: Record<string, { kind: PeriodKind; label: string }> = {
  "": { kind: "monthly", label: "เดือนนี้" }, // bare "/export" defaults to this month
  today: { kind: "daily", label: "วันนี้" },
  วันนี้: { kind: "daily", label: "วันนี้" },
  week: { kind: "weekly", label: "สัปดาห์นี้" },
  สัปดาห์นี้: { kind: "weekly", label: "สัปดาห์นี้" },
  month: { kind: "monthly", label: "เดือนนี้" },
  เดือนนี้: { kind: "monthly", label: "เดือนนี้" },
  year: { kind: "yearly", label: "ปีนี้" },
  ปีนี้: { kind: "yearly", label: "ปีนี้" },
};

/** /export [today|week|month|year] — builds and sends a CSV of transactions for that period as a Telegram document. */
async function handleExportCommand(chatId: string, userId: number, text: string): Promise<void> {
  const arg = text.trim().split(/\s+/).slice(1).join(" ").trim();
  const periodInfo = EXPORT_PERIOD_MAP[arg] ?? EXPORT_PERIOD_MAP[""];
  const { filename, content, count } = await buildTransactionsCsv(userId, periodInfo.kind);
  if (count === 0) {
    await sendTelegramMessage(chatId, `📄 ไม่มีรายการใน${periodInfo.label}ให้ส่งออกครับ`);
    return;
  }
  const sent = await sendTelegramDocument(chatId, filename, content, `📄 รายการ${periodInfo.label} (${count} รายการ)`);
  if (!sent) await sendTelegramMessage(chatId, "⚠️ ส่งออกไฟล์ไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
}

/** Savings-goal progress bars, /goals command. */
async function buildGoalsMessage(userId: number): Promise<string> {
  const list = await listGoals(userId);
  if (list.length === 0) {
    return "ยังไม่มีเป้าหมายการออมเลยครับ ตั้งได้ที่ ตั้งค่า → เป้าหมาย ในแอปนะ 🎯";
  }
  const lines = ["🎯 <b>เป้าหมายการออม</b>", ""];
  for (const g of list) {
    const target = Number(g.targetAmount);
    const saved = Number(g.savedAmount);
    const pct = target > 0 ? Math.round((saved / target) * 100) : 0;
    lines.push(`${g.emoji ?? "🎯"} <b>${escapeHtml(g.name)}</b>`);
    lines.push(`${progressBar(target > 0 ? saved / target : 0)} ${pct}%`);
    lines.push(`${formatMoney(saved)} / ${formatMoney(target)}`);
    if (g.deadline) {
      const daysLeft = Math.ceil((g.deadline - Date.now()) / 86400000);
      lines.push(daysLeft >= 0 ? `⏳ เหลืออีก ${daysLeft} วัน` : "⚠️ เลยกำหนดแล้ว");
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** Last few transactions with an inline "🗑" button per row so any of them can be deleted in place, not just the latest. /recent (or /list) command. Newest first. */
async function buildRecentView(userId: number): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const txs = await listTransactions(userId, { limit: 8 });
  if (txs.length === 0) {
    return {
      text: "ยังไม่มีรายการบันทึกไว้เลยครับ ลองพิมพ์ เช่น <code>กาแฟ 60</code> ดูได้เลย",
      keyboard: [],
    };
  }
  const lines = ["🧾 <b>รายการล่าสุด</b>", "", "แตะปุ่มด้านล่างเพื่อลบรายการนั้น"];
  const keyboard: InlineKeyboard = [];
  for (const t of txs) {
    const bk = toBangkokWallClock(t.occurredAt);
    const d = `${String(bk.getUTCDate()).padStart(2, "0")}/${String(bk.getUTCMonth() + 1).padStart(2, "0")}`;
    const catPart = t.category ? ` • ${escapeHtml(t.category)}` : "";
    const notePart = t.note ? ` — ${escapeHtml(t.note)}` : "";
    lines.push(`${typeEmoji(t.type as PendingTx["type"])} ${d} ${formatMoney(Number(t.amount))}${catPart}${notePart}`);
    const label = `🗑 ${d} ${formatMoney(Number(t.amount))}${t.category ? ` ${t.category}` : ""}`.slice(0, 60);
    keyboard.push([{ text: label, callback_data: `delrecent:${t.id}` }]);
  }
  return { text: lines.join("\n"), keyboard };
}

async function handleDeleteRecent(cq: any): Promise<void> {
  const chatId: string | undefined = cq.message?.chat?.id?.toString();
  const messageId: number | undefined = cq.message?.message_id;
  const txId = Number(cq.data.split(":")[1]);
  if (!chatId || messageId === undefined || !Number.isFinite(txId)) return;
  const userId = await findUserIdByTelegramChatId(chatId);
  if (!userId) {
    await answerCallbackQuery(cq.id, "ยังไม่ได้เชื่อมต่อบัญชี");
    return;
  }
  await deleteTransaction(userId, txId);
  const view = await buildRecentView(userId);
  await editTelegramMessage(chatId, messageId, view.text, view.keyboard);
  await answerCallbackQuery(cq.id, "ลบแล้ว");
}

function priorityEmoji(p: string | null): string {
  return p === "high" ? "🔴" : p === "low" ? "🟢" : "🟡";
}
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Wishlist with a toggle button per item ("✅ ซื้อแล้ว" / "↩️ ยังไม่ซื้อ") so status can flip right from the chat. /wishlist command. */
async function buildWishlistView(userId: number): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const items = await listWishlist(userId);
  if (items.length === 0) {
    return {
      text: "ยังไม่มีของที่อยากได้ในลิสต์เลยครับ เพิ่มได้ที่ ตั้งค่า → สิ่งที่อยากได้ ในแอปนะ 🛍️",
      keyboard: [],
    };
  }
  const sorted = [...items].sort((a, b) => {
    const ab = (a as any).bought ? 1 : 0;
    const bb = (b as any).bought ? 1 : 0;
    if (ab !== bb) return ab - bb;
    return (PRIORITY_RANK[a.priority ?? "medium"] ?? 1) - (PRIORITY_RANK[b.priority ?? "medium"] ?? 1);
  });
  const unbought = sorted.filter((w) => !(w as any).bought);
  const unboughtTotal = unbought.reduce((s, w) => s + Number(w.price), 0);

  const lines = [
    "🛍️ <b>สิ่งที่อยากได้</b>",
    "",
    `ยังไม่ซื้อ ${unbought.length} รายการ • รวม ${formatMoney(unboughtTotal)}`,
    "",
  ];
  const keyboard: InlineKeyboard = [];
  for (const w of sorted) {
    const bought = !!(w as any).bought;
    const nameHtml = escapeHtml(w.name);
    lines.push(
      `${bought ? "✅" : priorityEmoji(w.priority)} ${bought ? `<s>${nameHtml}</s>` : nameHtml} — ${formatMoney(Number(w.price))}`,
    );
    const label = `${bought ? "↩️ ยังไม่ซื้อ" : "✅ ซื้อแล้ว"}: ${w.name}`.slice(0, 60);
    keyboard.push([{ text: label, callback_data: `wishtoggle:${w.id}` }]);
  }
  return { text: lines.join("\n"), keyboard };
}

async function handleWishToggle(cq: any): Promise<void> {
  const chatId: string | undefined = cq.message?.chat?.id?.toString();
  const messageId: number | undefined = cq.message?.message_id;
  const wishId = Number(cq.data.split(":")[1]);
  if (!chatId || messageId === undefined || !Number.isFinite(wishId)) return;
  const userId = await findUserIdByTelegramChatId(chatId);
  if (!userId) {
    await answerCallbackQuery(cq.id, "ยังไม่ได้เชื่อมต่อบัญชี");
    return;
  }
  await toggleWishBought(userId, wishId);
  const view = await buildWishlistView(userId);
  await editTelegramMessage(chatId, messageId, view.text, view.keyboard);
  await answerCallbackQuery(cq.id, "อัปเดตแล้ว");
}

function freqLabel(f: string): string {
  return f === "daily" ? "รายวัน" : f === "weekly" ? "รายสัปดาห์" : f === "yearly" ? "รายปี" : "รายเดือน";
}

/** Upcoming recurring items sorted by next due date. /recurring command. */
async function buildRecurringMessage(userId: number): Promise<string> {
  const list = await listRecurring(userId);
  if (list.length === 0) {
    return "ยังไม่มีรายการประจำเลยครับ ตั้งได้ที่ ตั้งค่า → รายการประจำ ในแอปนะ 🔁";
  }
  const sorted = [...list].sort((a, b) => a.nextDate - b.nextDate);
  const lines = ["🔁 <b>รายการประจำ</b>", ""];
  for (const r of sorted) {
    const bk = toBangkokWallClock(r.nextDate);
    const d = `${String(bk.getUTCDate()).padStart(2, "0")}/${String(bk.getUTCMonth() + 1).padStart(2, "0")}`;
    const daysLeft = Math.ceil((r.nextDate - Date.now()) / 86400000);
    const dueLabel = daysLeft < 0 ? "เลยกำหนดแล้ว ⚠️" : daysLeft === 0 ? "วันนี้" : `อีก ${daysLeft} วัน`;
    const catPart = r.category ? ` • ${escapeHtml(r.category)}` : "";
    const notePart = r.note ? ` — ${escapeHtml(r.note)}` : "";
    lines.push(`${typeEmoji(r.type as PendingTx["type"])} ${formatMoney(Number(r.amount))}${catPart}${notePart}`);
    lines.push(`　${freqLabel(r.freq)} • ครบกำหนดถัดไป ${d} (${dueLabel})`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function recurrenceLabel(r: CustomReminder["recurrence"]): string {
  return r === "daily" ? "ทุกวัน" : r === "weekly" ? "ทุกสัปดาห์" : r === "monthly" ? "ทุกเดือน" : "ครั้งเดียว";
}

function newReminderId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** เตือน .../ /remind — parses the command and saves a new custom reminder for this user. */
async function handleSetReminder(chatId: string, userId: number, afterTrigger: string): Promise<void> {
  const parsed = parseReminderCommand(afterTrigger);
  if (!parsed) {
    await sendTelegramMessage(chatId, `❓ ไม่เข้าใจเวลาที่ตั้งนะครับ\n\n${REMINDER_USAGE_TEXT}`);
    return;
  }
  const notif = await getNotifSettings(userId);
  const reminder: CustomReminder = {
    id: newReminderId(),
    text: parsed.text,
    nextAt: parsed.firstAt,
    recurrence: parsed.recurrence,
    createdAt: Date.now(),
  };
  const list = [...(notif.customReminders ?? []), reminder];
  await saveNotifSettings(userId, { customReminders: list });

  const bk = toBangkokWallClock(parsed.firstAt);
  const dateStr = `${String(bk.getUTCDate()).padStart(2, "0")}/${String(bk.getUTCMonth() + 1).padStart(2, "0")}`;
  const timeStr = `${String(bk.getUTCHours()).padStart(2, "0")}:${String(bk.getUTCMinutes()).padStart(2, "0")}`;
  const recurPart = parsed.recurrence === "once" ? "" : ` (${recurrenceLabel(parsed.recurrence)})`;
  await sendTelegramMessage(
    chatId,
    `✅ ตั้งเตือนแล้ว${recurPart}\n📅 ${dateStr} ${timeStr} น.\n📝 ${escapeHtml(parsed.text)}\n\nดูรายการเตือนทั้งหมดพิมพ์ /reminders`,
  );
}

/** /reminders — lists active custom reminders sorted by next fire time, each with a 🗑 delete button. */
/** /interval — view or change how often the reminder fires. */
async function handleIntervalCommand(chatId: string, userId: number, arg: string): Promise<void> {
  const notif = await getNotifSettings(userId);
  const mode = notif.dailyReminderMode ?? "daily";
  const minutes = notif.dailyReminderIntervalMinutes ?? 60;

  const raw = arg.trim().toLowerCase();
  if (!raw) {
    const current = mode === "interval"
      ? `ทุก <b>${minutes}</b> นาที`
      : `วันละครั้ง ตอน ${String(notif.dailyReminderHour ?? 20).padStart(2, "0")}:00 น.`;
    await sendTelegramMessage(
      chatId,
      `⏰ <b>ความถี่เตือนตอนนี้:</b> ${current}\n\nเปลี่ยนได้ เช่น <code>/interval 30</code>, <code>/interval 2h</code>, <code>/interval daily</code>`,
    );
    return;
  }

  if (/^(daily|day|รายวัน|วันละครั้ง)$/.test(raw)) {
    await saveNotifSettings(userId, { dailyReminderMode: "daily" });
    await sendTelegramMessage(chatId, "✅ เปลี่ยนเป็นเตือน<b>วันละครั้ง</b>แล้ว (ดู/แก้เวลาได้ในแอป → ตั้งค่า)");
    return;
  }

  let minutesToSet: number | null = null;
  const mMin = raw.match(/^(\d{1,4})\s*(m|min|นาที)?$/);
  const mHour = raw.match(/^(\d{1,2})\s*(h|hr|ชม|ชั่วโมง)$/);
  if (mHour) minutesToSet = Number(mHour[1]) * 60;
  else if (mMin && Number(mMin[1]) > 0) minutesToSet = Number(mMin[1]);

  if (!minutesToSet || minutesToSet < 5 || minutesToSet > 1440) {
    await sendTelegramMessage(
      chatId,
      "❌ รูปแบบไม่ถูกต้อง — ลอง <code>/interval 30</code>, <code>/interval 2h</code> หรือ <code>/interval daily</code>\n(ขั้นต่ำ 5 นาที, สูงสุด 24 ชั่วโมง)",
    );
    return;
  }

  await saveNotifSettings(userId, {
    dailyReminderMode: "interval",
    dailyReminderIntervalMinutes: minutesToSet,
  });
  const label = minutesToSet >= 60 && minutesToSet % 60 === 0 ? `${minutesToSet / 60} ชั่วโมง` : `${minutesToSet} นาที`;
  await sendTelegramMessage(chatId, "\u2705 \u0E15\u0E31\u0E49\u0E07\u0E40\u0E15\u0E37\u0E2D\u0E19\u0E17\u0E38\u0E01 <b>" + label + "</b> \u0E41\u0E25\u0E49\u0E27 (\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23)\n\u0E01\u0E25\u0E31\u0E1A\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E15\u0E37\u0E2D\u0E19\u0E23\u0E32\u0E22\u0E27\u0E31\u0E19: <code>/interval daily</code>",);
}

async function buildRemindersView(userId: number): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const notif = await getNotifSettings(userId);
  const list = [...(notif.customReminders ?? [])].sort((a, b) => a.nextAt - b.nextAt);
  if (list.length === 0) {
    return {
      text: `ยังไม่มีรายการเตือนเลยครับ ⏰\n\n${REMINDER_USAGE_TEXT}`,
      keyboard: [],
    };
  }
  const lines = ["⏰ <b>รายการเตือน</b>", ""];
  const keyboard: InlineKeyboard = [];
  for (const r of list) {
    const bk = toBangkokWallClock(r.nextAt);
    const dateStr = `${String(bk.getUTCDate()).padStart(2, "0")}/${String(bk.getUTCMonth() + 1).padStart(2, "0")}`;
    const timeStr = `${String(bk.getUTCHours()).padStart(2, "0")}:${String(bk.getUTCMinutes()).padStart(2, "0")}`;
    lines.push(`• <b>${escapeHtml(r.text)}</b>`);
    lines.push(`　${dateStr} ${timeStr} น. • ${recurrenceLabel(r.recurrence)}`);
    keyboard.push([
      { text: "⏰ +10 นาที", callback_data: `snooze:${r.id}` },
      { text: `🗑 ลบ: ${r.text}`.slice(0, 44), callback_data: `delreminder:${r.id}` },
    ]);
  }
  return { text: lines.join("\n"), keyboard };
}

async function handleDeleteReminder(cq: any): Promise<void> {
  const chatId: string | undefined = cq.message?.chat?.id?.toString();
  const messageId: number | undefined = cq.message?.message_id;
  const reminderId = cq.data.split(":")[1];
  if (!chatId || messageId === undefined || !reminderId) return;
  const userId = await findUserIdByTelegramChatId(chatId);
  if (!userId) {
    await answerCallbackQuery(cq.id, "ยังไม่ได้เชื่อมต่อบัญชี");
    return;
  }
  const notif = await getNotifSettings(userId);
  const list = (notif.customReminders ?? []).filter((r) => r.id !== reminderId);
  await saveNotifSettings(userId, { customReminders: list });
  const view = await buildRemindersView(userId);
  if (view.keyboard.length > 0) await editTelegramMessage(chatId, messageId, view.text, view.keyboard);
  else await editTelegramMessage(chatId, messageId, view.text, []);
  await answerCallbackQuery(cq.id, "ลบแล้ว");
}


/** Snooze a custom reminder by 10 minutes (\u23F0 button in /reminders). */
async function handleSnoozeReminder(cq: any): Promise<void> {
  const chatId: string | undefined = cq.message?.chat?.id?.toString();
  const messageId: number | undefined = cq.message?.message_id;
  const reminderId = cq.data.split(":")[1];
  if (!chatId || messageId === undefined || !reminderId) return;
  const userId = await findUserIdByTelegramChatId(chatId);
  if (!userId) {
    await answerCallbackQuery(cq.id, "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E1A\u0E31\u0E0D\u0E0A\u0E35");
    return;
  }
  const notif = await getNotifSettings(userId);
  const existing = (notif.customReminders ?? []).find((r) => r.id === reminderId);
  let list;
  if (existing) {
    // Regular case: push next fire time back by 10 minutes.
    list = (notif.customReminders ?? []).map((r) =>
      r.id === reminderId ? { ...r, nextAt: Date.now() + 10 * 60 * 1000 } : r,
    );
  } else {
    // "Once" reminders are dropped from the list the moment they fire.
    // Recover the text from the reminder message itself so snooze still works.
    const rawText: string = cq.message?.text ?? "";
    const text = rawText.split("\n").slice(1).join(" ").trim() || "แจ้งเตือน";
    list = [
      ...(notif.customReminders ?? []),
      { id: reminderId, text, nextAt: Date.now() + 10 * 60 * 1000, recurrence: "once" as const, createdAt: Date.now() },
    ];
  }
  await saveNotifSettings(userId, { customReminders: list });
  const view = await buildRemindersView(userId);
  await editTelegramMessage(chatId, messageId, view.text, view.keyboard);
  await answerCallbackQuery(cq.id, "\u0E40\u0E25\u0E37\u0E48\u0E2D\u0E19\u0E44\u0E1B\u0E2D\u0E35\u0E01 10 \u0E19\u0E32\u0E17\u0E35 \u23F0");
}

/**
 * "✅ เสร็จแล้ว" on a fired custom reminder (scheduler.ts). Logs the tap to
 * reminder_log and edits the message in place so it can't be tapped twice.
 * The reminder itself may already be gone from customReminders by now (a
 * "once" reminder is dropped the moment it fires) — the text and fired-at
 * time we need are carried on the message/callback_data instead, not
 * looked up from the reminder list.
 */
async function handleReminderDone(cq: any): Promise<void> {
  const chatId: string | undefined = cq.message?.chat?.id?.toString();
  const messageId: number | undefined = cq.message?.message_id;
  const parts = typeof cq.data === "string" ? cq.data.split(":") : [];
  const reminderId = parts[1];
  const firedAt = Number(parts[2]);
  if (!chatId || messageId === undefined || !reminderId || !Number.isFinite(firedAt)) return;
  const userId = await findUserIdByTelegramChatId(chatId);
  if (!userId) {
    await answerCallbackQuery(cq.id, "ยังไม่ได้เชื่อมต่อบัญชี");
    return;
  }
  // The fired message is "🔔 เตือนความจำ\n<reminder text>" — second line
  // (and beyond, for multi-line reminders) is the original text. Telegram
  // returns message.text as plain UTF-8 (HTML entities already resolved),
  // so no unescaping is needed here.
  const messageText: string = typeof cq.message?.text === "string" ? cq.message.text : "";
  const reminderText = messageText.split("\n").slice(1).join("\n").trim() || "เตือนความจำ";

  await logReminderDone({ userId, reminderText, firedAt });
  await editTelegramMessage(chatId, messageId, `✅ ${escapeHtml(reminderText)} — เสร็จแล้ว`, []);
  await answerCallbackQuery(cq.id, "บันทึกแล้ว");
}

/** /undo — shows the most recent transaction with a confirm/cancel keyboard before deleting it. */
async function handleUndoCommand(chatId: string, userId: number): Promise<void> {
  const [last] = await listTransactions(userId, { limit: 1 });
  if (!last) {
    await sendTelegramMessage(chatId, "ยังไม่มีรายการให้ลบครับ");
    return;
  }
  const text = [
    "ลบรายการนี้ใช่ไหม?",
    `${typeEmoji(last.type as PendingTx["type"])} ${typeLabel(last.type as PendingTx["type"])} ${formatMoney(Number(last.amount))}`,
    last.category ? `หมวด: ${escapeHtml(last.category)}` : null,
    last.note ? `รายการ: ${escapeHtml(last.note)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  await sendTelegramKeyboard(chatId, text, [
    [
      { text: "🗑 ยืนยันลบ", callback_data: `undodel:${last.id}` },
      { text: "ยกเลิก", callback_data: `undocancel:0` },
    ],
  ]);
}

async function handleUndoDelete(cq: any): Promise<void> {
  const chatId: string | undefined = cq.message?.chat?.id?.toString();
  const messageId: number | undefined = cq.message?.message_id;
  const txId = Number(cq.data.split(":")[1]);
  if (!chatId || messageId === undefined || !Number.isFinite(txId)) return;
  const userId = await findUserIdByTelegramChatId(chatId);
  if (!userId) {
    await answerCallbackQuery(cq.id, "ยังไม่ได้เชื่อมต่อบัญชี");
    return;
  }
  await deleteTransaction(userId, txId);
  await editTelegramMessage(chatId, messageId, "🗑 ลบรายการแล้ว", []);
  await answerCallbackQuery(cq.id, "ลบแล้ว");
}

async function handleUndoCancel(cq: any): Promise<void> {
  const chatId: string | undefined = cq.message?.chat?.id?.toString();
  const messageId: number | undefined = cq.message?.message_id;
  if (!chatId || messageId === undefined) return;
  await editTelegramMessage(chatId, messageId, "ไม่ได้ลบรายการครับ", []);
  await answerCallbackQuery(cq.id);
}

async function tryQuickAddFromChat(chatId: string, text: string): Promise<void> {
  const userId = await requireUserId(chatId);
  if (!userId) return;

  const categories = await getEffectiveCategories(userId);
  const parsed = parseQuickTransaction(text, categories);
  if (!parsed) {
    await sendTelegramMessage(
      chatId,
      "พิมพ์ไม่ถูกรูปแบบ 🤔\nลองแบบนี้ดูครับ:\n• <code>กาแฟ 60</code> (บันทึกรายจ่าย)\n• <code>+เงินเดือน 15000</code> หรือ <code>รับเงิน 500 ค่าขนม</code> (บันทึกรายรับ)\n• <code>ออม 1000 กองทุน</code> (บันทึกเงินออม)",
    );
    return;
  }

  sweepExpiredPending();
  const id = newPendingId();
  const pending: PendingTx = {
    userId,
    chatId,
    messageId: 0,
    type: parsed.type,
    amount: parsed.amount,
    note: parsed.note,
    category: parsed.category,
    guessedCategory: parsed.category,
    categoryManuallySet: false,
    createdAt: Date.now(),
  };
  const messageId = await sendTelegramKeyboard(chatId, confirmSummaryText(pending), confirmKeyboard(id));
  if (messageId === null) return;
  pending.messageId = messageId;
  pendingTx.set(id, pending);
}

async function handlePendingCallback(cq: any): Promise<void> {
  const data: string | undefined = cq.data;
  const chatId: string | undefined = cq.message?.chat?.id?.toString();
  const messageId: number | undefined = cq.message?.message_id;
  if (!data || !chatId || messageId === undefined) return;

  const [action, id, extra] = data.split(":");
  const pending = pendingTx.get(id);

  if (!pending) {
    await answerCallbackQuery(cq.id, "รายการนี้หมดอายุแล้ว ลองพิมพ์ใหม่ได้เลยครับ");
    return;
  }

  if (action === "confirm") {
    await createTransaction({
      userId: pending.userId,
      type: pending.type,
      amount: String(pending.amount) as any,
      category: pending.category,
      note: pending.note,
      occurredAt: Date.now(),
    });
    const savedText = `${typeEmoji(pending.type)} บันทึก${typeLabel(pending.type)} ${formatMoney(pending.amount)} แล้ว ✅\nหมวด: ${pending.category ? escapeHtml(pending.category) : "(ไม่ระบุ)"}${pending.note ? `\nรายการ: ${escapeHtml(pending.note)}` : ""}`;
    await editTelegramMessage(chatId, messageId, savedText, []);
    await answerCallbackQuery(cq.id, "บันทึกแล้ว ✅");
    pendingTx.delete(id);
    return;
  }

  if (action === "cancel") {
    await editTelegramMessage(chatId, messageId, "🗑 ยกเลิกแล้ว ไม่ได้บันทึกรายการนี้", []);
    await answerCallbackQuery(cq.id, "ยกเลิกแล้ว");
    pendingTx.delete(id);
    return;
  }

  if (action === "chcat") {
    const categories = await getEffectiveCategories(pending.userId);
    await editTelegramMessage(chatId, messageId, "เลือกหมวดที่ถูกต้อง:", categoryKeyboard(id, categories[pending.type]));
    await answerCallbackQuery(cq.id);
    return;
  }

  if (action === "back") {
    await editTelegramMessage(chatId, messageId, confirmSummaryText(pending), confirmKeyboard(id));
    await answerCallbackQuery(cq.id);
    return;
  }

  if (action === "setcat") {
    const idx = Number(extra);
    const categories = await getEffectiveCategories(pending.userId);
    const cats = categories[pending.type];
    const chosen = cats[idx];
    if (chosen) {
      pending.category = chosen;
      pending.categoryManuallySet = true;
    }
    await editTelegramMessage(chatId, messageId, confirmSummaryText(pending), confirmKeyboard(id));
    await answerCallbackQuery(cq.id, chosen ? `เลือกหมวด ${chosen}` : undefined);
    return;
  }
}

const PACING_QUERY_RE = /(วันนี้ใช้ได้|เงินเหลือใช้|งบวันนี้|เหลือใช้เท่าไหร่|งบเหลือ)/;
const SUMMARY_QUERY_RE = /(สรุปเดือนนี้|สรุปวันนี้|สรุปรายเดือน|ใช้ไปเท่าไหร่)/;
const WEEKLY_QUERY_RE = /(สรุปสัปดาห์นี้|สรุปรายสัปดาห์|สรุปอาทิตย์นี้)/;
const RECENT_QUERY_RE = /(รายการล่าสุด|ประวัติล่าสุด)/;
const GOALS_QUERY_RE = /(เป้าหมายการออม|เป้าหมายไปถึงไหน)/;

// Free-text "<keyword><period>" queries, e.g. "กาแฟเดือนนี้", "แท็กซี่วันนี้",
// "หนังสือสัปดาห์นี้" — checked only after the fixed-phrase regexes above,
// so "สรุปเดือนนี้" etc. keep hitting SUMMARY_QUERY_RE first and never land
// here. Kept lazy + capped at 30 chars so it can't accidentally swallow an
// unrelated long sentence that merely ends in one of these words.
const KEYWORD_PERIOD_RE = /^(.{1,30}?)(วันนี้|สัปดาห์นี้|เดือนนี้)$/;
const PERIOD_WORD_MAP: Record<string, { kind: PeriodKind; label: string }> = {
  วันนี้: { kind: "daily", label: "วันนี้" },
  สัปดาห์นี้: { kind: "weekly", label: "สัปดาห์นี้" },
  เดือนนี้: { kind: "monthly", label: "เดือนนี้" },
};

/** Returns true (and replies) if `text` is a "<keyword><period>" query; false if not, so the caller can fall through to quick-add. */
async function tryKeywordPeriodQuery(chatId: string, text: string): Promise<boolean> {
  const match = text.trim().match(KEYWORD_PERIOD_RE);
  if (!match) return false;
  const keyword = match[1].trim();
  const periodInfo = PERIOD_WORD_MAP[match[2]];
  if (!keyword || !periodInfo) return false;

  const userId = await requireUserId(chatId);
  if (!userId) return true; // requireUserId already sent the "not linked" message

  await sendTelegramMessage(chatId, await buildKeywordSummaryMessage(userId, keyword, periodInfo.kind, periodInfo.label));
  return true;
}

/**
 * Per-command help text, shown for e.g. "/export help" instead of running
 * the command — handy when you've forgotten a command's exact syntax
 * without having to scroll back through the full /help list. Checked once,
 * generically, at the top of handleUpdate (see HELP_TRIGGER_RE below) so
 * adding a new command's help here is enough — no per-branch wiring needed.
 * Keyed by command name without the leading slash; "list" is an alias of
 * "recent" since both trigger the same handler.
 */
const COMMAND_HELP: Record<string, string> = {
  start: [
    "<b>/start</b>",
    "เชื่อมต่อบัญชี MoneyFlow กับแชทนี้",
    "",
    "ต้องมีรหัสเชื่อมต่อจากในแอปก่อน: เปิดแอป → ตั้งค่า → แจ้งเตือน Telegram → กดขอรหัส แล้วพิมพ์",
    "<code>/start &lt;รหัส&gt;</code>",
    "",
    "ถ้ายังไม่เคยขอรหัส พิมพ์ /start เฉยๆ จะมีลิงก์บอกวิธีให้",
  ].join("\n"),
  summary: [
    "<b>/summary</b>",
    "สรุปรายรับ-รายจ่าย-เงินออม ของวันนี้และเดือนนี้",
    "",
    "เรียกด้วยคำพูดก็ได้ เช่น <code>สรุปวันนี้</code>, <code>สรุปเดือนนี้</code>, <code>ใช้ไปเท่าไหร่</code>",
  ].join("\n"),
  weekly: [
    "<b>/weekly</b>",
    "สรุปยอดของสัปดาห์นี้ พร้อมหมวดที่ใช้จ่ายเยอะที่สุด",
    "",
    "เรียกด้วยคำพูดก็ได้ เช่น <code>สรุปสัปดาห์นี้</code>, <code>สรุปอาทิตย์นี้</code>",
  ].join("\n"),
  budget: [
    "<b>/budget</b>",
    "เงินเหลือใช้ต่อวัน เทียบกับงบรายเดือนที่ตั้งไว้แต่ละหมวด",
    "",
    "ยังไม่มีงบให้ตั้งได้ในแอป → งบประมาณ",
    "เรียกด้วยคำพูดก็ได้ เช่น <code>วันนี้ใช้ได้เท่าไหร่</code>, <code>งบเหลือ</code>",
  ].join("\n"),
  goals: [
    "<b>/goals</b>",
    "ความคืบหน้าของเป้าหมายการออมแต่ละก้อน (เปอร์เซ็นต์ + จำนวนเงิน)",
    "",
    "สร้าง/แก้เป้าหมายได้ในแอป → เป้าหมาย",
    "เรียกด้วยคำพูดก็ได้ เช่น <code>เป้าหมายการออม</code>, <code>เป้าหมายไปถึงไหน</code>",
  ].join("\n"),
  interval: [
    "<b>/interval</b>",
    "ตั้งความถี่ของการเตือน \"ยังไม่ได้บันทึกรายการ\"",
    "",
    "• <code>/interval 30</code> — เตือนทุก 30 นาที",
    "• <code>/interval 2h</code> — เตือนทุก 2 ชั่วโมง",
    "• <code>/interval daily</code> — กลับเป็นเตือนวันละครั้ง",
    "• <code>/interval</code> — ดูค่าที่ตั้งไว้ตอนนี้",
    "",
    "เตือนเฉพาะเมื่อวันนี้ยังไม่มีรายการบันทึกเลย (ขั้นต่\u0E4Dา 5 นาที)",
  ].join("\n"),
  recent: [
    "<b>/recent</b> (หรือ <b>/list</b>)",
    "รายการล่าสุด 8 รายการ",
    "",
    "แต่ละแถวมีปุ่ม 🗑 ลบรายการนั้นได้ทันทีจากในแชท ไม่ต้องเปิดแอป",
    "เรียกด้วยคำพูดก็ได้ เช่น <code>รายการล่าสุด</code>",
  ].join("\n"),
  list: [
    "<b>/list</b> (เหมือน <b>/recent</b>)",
    "รายการล่าสุด 8 รายการ — มีปุ่ม 🗑 ลบทีละรายการได้เลย",
  ].join("\n"),
  wishlist: [
    "<b>/wishlist</b>",
    "รายการสิ่งที่อยากได้",
    "",
    "แตะปุ่มที่แนบมาเพื่อติ๊กว่า \"ซื้อแล้ว\" หรือย้อนกลับเป็น \"ยังไม่ซื้อ\" ได้เลย ไม่ต้องเปิดแอป",
  ].join("\n"),
  recurring: [
    "<b>/recurring</b>",
    "รายการประจำทั้งหมด เรียงตามวันครบกำหนดชำระถัดไป",
    "",
    "ตั้ง/แก้รายการประจำได้ในแอป → รายการประจำ",
  ].join("\n"),
  export: [
    "<b>/export [today|week|month|year]</b>",
    "ส่งออกรายการเป็นไฟล์ CSV ให้เป็นไฟล์แนบในแชท",
    "",
    "ไม่ระบุช่วงเวลา = เดือนนี้ (ค่าเริ่มต้น) ตัวอย่าง:",
    "• <code>/export</code> — เดือนนี้",
    "• <code>/export today</code> — วันนี้",
    "• <code>/export week</code> — สัปดาห์นี้",
    "• <code>/export year</code> — ปีนี้",
  ].join("\n"),
  undo: [
    "<b>/undo</b>",
    "ลบรายการที่บันทึกล่าสุด",
    "",
    "จะถามยืนยันก่อนลบจริงเสมอ กดยกเลิกได้ถ้ากดผิด",
  ].join("\n"),
  reminders: [
    "<b>/reminders</b>",
    "ดูรายการเตือนทั้งหมดที่ตั้งไว้ (ทั้งครั้งเดียวและซ้ำ)",
    "",
    "แต่ละแถวมีปุ่ม 🗑 ลบทีละรายการได้เลย ตั้งเตือนใหม่ด้วย /remind",
  ].join("\n"),
  remind: [
    "<b>/remind &lt;ข้อความ&gt;</b>",
    "ตั้งเตือนเอง จะเตือนครั้งเดียวหรือซ้ำก็ได้ ตัวอย่าง:",
    "• <code>/remind พรุ่งนี้ 9 โมง จ่ายค่าเน็ต</code> — เตือนครั้งเดียว",
    "• <code>/remind ทุกวัน 8 โมงเช้า กินยา</code> — เตือนซ้ำทุกวัน",
    "• <code>/remind ทุกสัปดาห์ วันจันทร์ 8 โมง ประชุมทีม</code> — เตือนซ้ำทุกสัปดาห์",
    "",
    "พิมพ์ <code>เตือน...</code> เฉยๆ (ไม่ต้องมี /remind) ก็ตั้งได้เหมือนกัน",
    "ดูที่ตั้งไว้ทั้งหมดด้วย /reminders",
  ].join("\n"),
};

/** Matches "/<command> help" (optionally "/<command>@BotUsername help", for group chats). */
const HELP_TRIGGER_RE = /^\/([a-zA-Z]+)(?:@\w+)?\s+help$/i;

async function handleUpdate(
  update: any,
  onLinked: (userId: number, chatId: string) => Promise<void> | void,
): Promise<void> {
  if (update.callback_query) {
    const cq = update.callback_query;
    const action = typeof cq.data === "string" ? cq.data.split(":")[0] : "";
    if (action === "undodel") return handleUndoDelete(cq);
    if (action === "undocancel") return handleUndoCancel(cq);
    if (action === "delrecent") return handleDeleteRecent(cq);
    if (action === "wishtoggle") return handleWishToggle(cq);
    if (action === "delreminder") return handleDeleteReminder(cq);
    if (action === "snooze") return handleSnoozeReminder(cq);
    if (action === "remdone") return handleReminderDone(cq);
    return handlePendingCallback(cq);
  }

  const msg = update.message;
  const text: string | undefined = msg?.text;
  const chatId: string | undefined = msg?.chat?.id?.toString();
  if (!chatId) return;

  // Receipt photos (compressed "photo" or an image document) get attached
  // to the user's most recent transaction.
  const photoSizes = Array.isArray(msg?.photo) ? msg.photo : null;
  const docMime: string | undefined = msg?.document?.mime_type;
  if ((photoSizes && photoSizes.length > 0) || (docMime && docMime.startsWith("image/"))) {
    return handleReceiptPhoto(chatId, photoSizes, msg?.document);
  }
  if (!text) return;

  // "/<command> help" — e.g. "/export help" — short-circuits straight to
  // that command's own help text, before any login check or the command's
  // normal logic runs. Falls through to the normal command handling below
  // if the command has no dedicated help entry.
  const helpMatch = text.trim().match(HELP_TRIGGER_RE);
  if (helpMatch) {
    const helpText = COMMAND_HELP[helpMatch[1].toLowerCase()];
    if (helpText) {
      await sendTelegramMessage(chatId, helpText);
      return;
    }
  }

  if (text.startsWith("/start")) {
    const code = text.trim().split(/\s+/)[1];
    if (code) {
      const userId = consumeLinkCode(code);
      if (userId) {
        await onLinked(userId, chatId);
        const waRow = webAppKeyboardRow();
        const linkedText = "✅ เชื่อมต่อ MoneyFlow สำเร็จแล้ว!\nตั้งแต่นี้ไปจะแจ้งเตือนงบประมาณ รายการประจำ เป้าหมายการออม และเตือนบันทึกรายการประจำวันให้ที่นี่ 🙌";
        if (waRow.length) await sendTelegramKeyboard(chatId, linkedText, [waRow]);
        else await sendTelegramMessage(chatId, linkedText);
      } else {
        await sendTelegramMessage(
          chatId,
          "⚠️ รหัสเชื่อมต่อไม่ถูกต้องหรือหมดอายุแล้ว กรุณากลับไปกดเชื่อมต่อใหม่จากหน้าตั้งค่าในแอป",
        );
      }
    } else {
      await sendTelegramMessage(
        chatId,
        "สวัสดี 👋 เปิดแอป MoneyFlow แล้วไปที่ ตั้งค่า → แจ้งเตือน Telegram เพื่อเชื่อมต่อบัญชีของคุณกับแชทนี้",
      );
    }
  } else if (text.startsWith("/help")) {
    await sendTelegramMessage(
      chatId,
      [
        "MoneyFlow Bot 🤖",
        "",
        "<b>📝 บันทึกรายการ</b> — พิมพ์ตรงนี้ได้เลย ไม่ต้องใส่คำสั่ง:",
        "• <code>กาแฟ 60</code> → รายจ่าย (มีถามยืนยัน/เปลี่ยนหมวดก่อนบันทึกจริง)",
        "• <code>+เงินเดือน 15000</code> หรือ <code>รับเงิน 500 ค่าขนม</code> → รายรับ",
        "• <code>ออม 1000 กองทุน</code> → เงินออม",
        "• หลังบันทึกเสร็จ พิมพ์ /undo เพื่อลบรายการล่าสุดได้",
        "• 📷 ส่งรูปสลิปเข้าแชท = แนบกับรายการล่าสุด (ดูในเว็บช่อง 📎)",
        "",
        "<b>📊 ดูข้อมูล</b>",
        "• /summary — สรุปรายรับ-รายจ่าย-เงินออม วันนี้และเดือนนี้",
        "• /weekly — สรุปรายสัปดาห์นี้ พร้อมหมวดที่ใช้จ่ายเยอะสุด",
        "• /budget — เงินเหลือใช้ต่อวัน เทียบกับงบรายเดือนแต่ละหมวด",
        "• /goals — ความคืบหน้าเป้าหมายการออมแต่ละก้อน",
        "• /recent — รายการล่าสุด 8 รายการ (มีปุ่ม 🗑 ลบทีละรายการได้เลย)",
        "• /wishlist — สิ่งที่อยากได้ (แตะปุ่มเพื่อติ๊กว่าซื้อแล้ว)",
        "• /recurring — รายการประจำและวันครบกำหนดถัดไป",
        "• /export [today|week|month|year] — ส่งออกรายการเป็นไฟล์ CSV (ไม่ระบุ = เดือนนี้)",
        "• /undo — ลบรายการที่บันทึกล่าสุด (มีถามยืนยันก่อน)",
        "",
        "<b>⏰ ตั้งเตือนเอง</b>",
        "• <code>เตือนพรุ่งนี้ 9 โมง จ่ายค่าเน็ต</code> — เตือนครั้งเดียว",
        "• <code>เตือนทุกวัน 8 โมงเช้า กินยา</code> — เตือนซ้ำทุกวัน (ทุกวัน/ทุกสัปดาห์/ทุกเดือน ก็ได้)",
        "• /reminders — ดูรายการเตือนทั้งหมด (มีปุ่ม 🗑 ลบทีละรายการ)",
        "• พิมพ์ <code>&lt;คำ&gt;วันนี้</code> / <code>&lt;คำ&gt;สัปดาห์นี้</code> / <code>&lt;คำ&gt;เดือนนี้</code> เช่น <code>กาแฟเดือนนี้</code> — สรุปยอดตามคำค้นหาในหมวด/รายการ",
        "",
        "<i>ถามด้วยคำพูดก็ได้ เช่น \"วันนี้ใช้ได้เท่าไหร่\", \"สรุปเดือนนี้\", \"สรุปสัปดาห์นี้\", \"รายการล่าสุด\", \"กาแฟเดือนนี้\"</i>",
        "",
        "<b>🔔 แจ้งเตือนอัตโนมัติ</b> (เชื่อมต่อบัญชีผ่าน ตั้งค่า → แจ้งเตือน Telegram ในแอปก่อน):",
        "• งบประมาณใกล้/เกินกำหนด",
        "• รายการประจำใกล้ถึงกำหนดชำระ",
        "• เป้าหมายการออมถึงเป้า",
        "• เตือนหากยังไม่ได้บันทึกรายการวันนี้",
        "• สรุปรายสัปดาห์ ทุกวันอาทิตย์ตอนเย็น",
        "• เตือนที่ตั้งเองผ่าน /remind (ครั้งเดียวหรือซ้ำก็ได้)",
        "",
        "พิมพ์ /help ได้ทุกเมื่อถ้าลืมคำสั่ง 🙂",
        "อยากรู้วิธีใช้คำสั่งไหนแบบละเอียด พิมพ์ <code>&lt;คำสั่ง&gt; help</code> เช่น <code>/export help</code>",
      ].join("\n"),
    );
  } else if (text.startsWith("/summary") || SUMMARY_QUERY_RE.test(text)) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    await sendTelegramMessage(chatId, await buildSummaryMessage(userId));
  } else if (text.startsWith("/weekly") || WEEKLY_QUERY_RE.test(text)) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    await sendTelegramMessage(chatId, await buildWeeklySummaryMessage(userId));
  } else if (text.startsWith("/export")) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    await handleExportCommand(chatId, userId, text);
  } else if (text.startsWith("/budget") || PACING_QUERY_RE.test(text)) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    await sendTelegramMessage(chatId, await buildPacingMessage(userId));
  } else if (text.startsWith("/goals") || GOALS_QUERY_RE.test(text)) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    await sendTelegramMessage(chatId, await buildGoalsMessage(userId));
  } else if (text.startsWith("/recent") || text.startsWith("/list") || RECENT_QUERY_RE.test(text)) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    const view = await buildRecentView(userId);
    if (view.keyboard.length > 0) await sendTelegramKeyboard(chatId, view.text, view.keyboard);
    else await sendTelegramMessage(chatId, view.text);
  } else if (text.startsWith("/wishlist")) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    const view = await buildWishlistView(userId);
    if (view.keyboard.length > 0) await sendTelegramKeyboard(chatId, view.text, view.keyboard);
    else await sendTelegramMessage(chatId, view.text);
  } else if (text.startsWith("/recurring")) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    await sendTelegramMessage(chatId, await buildRecurringMessage(userId));
  } else if (text.startsWith("/undo")) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    await handleUndoCommand(chatId, userId);
  } else if (text.startsWith("/interval")) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    await handleIntervalCommand(chatId, userId, text.slice("/interval".length));
  } else if (text.startsWith("/reminders") || /^(รายการเตือน|เตือนอะไรบ้าง)$/.test(text.trim())) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    const view = await buildRemindersView(userId);
    if (view.keyboard.length > 0) await sendTelegramKeyboard(chatId, view.text, view.keyboard);
    else await sendTelegramMessage(chatId, view.text);
  } else if (text.startsWith("/remind") || /^เตือน/.test(text.trim())) {
    const userId = await requireUserId(chatId);
    if (!userId) return;
    const afterTrigger = text.trim().replace(/^\/remind\b/i, "").replace(/^เตือน/, "");
    await handleSetReminder(chatId, userId, afterTrigger);
  } else if (!text.startsWith("/")) {
    if (await tryKeywordPeriodQuery(chatId, text)) return;
    await tryQuickAddFromChat(chatId, text);
  }
}
