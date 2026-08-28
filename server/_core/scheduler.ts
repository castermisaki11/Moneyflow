import { getAppConfigValue, listAllUsers, listBudgets, listGoals, listRecurring, listTransactions, setAppConfigValue } from "../db";
import { bangkokParts, periodRange, type PeriodKind } from "./bangkokTime";
import { getNotifSettings, saveNotifSettings, type CustomReminder, type NotifSettingsState } from "./notifSettings";
import { buildPacingMessage } from "./pacing";
import { advanceReminder } from "./reminderParser";
import {
  buildWeeklySummaryMessage,
  escapeHtml,
  formatMoney,
  isTelegramConfigured,
  sendTelegramKeyboard,
  sendTelegramMessage,
} from "./telegram";

const HEARTBEAT_MS = 5 * 1000; // how often the loop wakes up to consult the config
const MIN_INTERVAL_MS = 10 * 1000; // custom check frequency floor (10s)
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // ceiling: once a day
const SCHEDULER_CONFIG_KEY = "scheduler";

let schedulerStarted = false;

// ── Runtime-tunable scheduler config (admin Bot page → app_config table) ──
export interface SchedulerRuntimeConfig {
  enabled: boolean; // master switch — off = no automatic checks at all
  intervalMs: number; // how often notification checks run (custom)
}

function clampIntervalMs(ms: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(ms)));
}

// Small in-process cache so ticks don't hit the DB every heartbeat.
let cachedConfig: SchedulerRuntimeConfig = { enabled: true, intervalMs: 60 * 1000 };
let configFetchedAt = 0;

async function loadConfig(force = false): Promise<SchedulerRuntimeConfig> {
  if (!force && Date.now() - configFetchedAt < 15_000) return cachedConfig;
  try {
    const raw = await getAppConfigValue(SCHEDULER_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SchedulerRuntimeConfig>;
      cachedConfig = {
        enabled: parsed.enabled !== false,
        intervalMs: clampIntervalMs(parsed.intervalMs ?? 60 * 1000),
      };
    }
    configFetchedAt = Date.now();
  } catch {
    // keep last-known values on transient DB errors
  }
  return cachedConfig;
}

/** Current runtime settings (admin Bot page). */
export async function getSchedulerConfig(): Promise<SchedulerRuntimeConfig> {
  return loadConfig();
}

/** Update runtime settings (admin Bot page). Returns the effective values. */
export async function setSchedulerConfig(
  patch: { enabled?: boolean; intervalSeconds?: number },
): Promise<SchedulerRuntimeConfig> {
  const next: SchedulerRuntimeConfig = {
    enabled: patch.enabled ?? cachedConfig.enabled,
    intervalMs:
      patch.intervalSeconds !== undefined
        ? clampIntervalMs(patch.intervalSeconds * 1000)
        : cachedConfig.intervalMs,
  };
  await setAppConfigValue(SCHEDULER_CONFIG_KEY, JSON.stringify(next));
  cachedConfig = next;
  configFetchedAt = Date.now();
  return next;
}

// ── Status bookkeeping, read by the admin Bot page (server/_core/botRouter.ts) ──
// Tracked inside runNotificationChecks() itself (not the setInterval wrapper below)
// so it reflects BOTH trigger paths: the in-process timer AND the external-cron
// wake endpoint (/api/cron/check-notifications in index.ts), which calls the same
// function directly on hosts that idle the process when no traffic arrives.
let lastRunAt: number | null = null;
let lastRunDurationMs: number | null = null;
let lastRunError: string | null = null;
// Only meaningful for the in-process timer — the external cron path has no fixed schedule.
let nextScheduledTickAt: number | null = null;

export interface SchedulerStatus {
  configured: boolean;
  internalTimerRunning: boolean;
  intervalMs: number;
  lastRunAt: number | null;
  lastRunDurationMs: number | null;
  lastRunError: string | null;
  nextScheduledTickAt: number | null;
  /** Runtime config (admin-tunable) */
  enabled: boolean;
  checkIntervalMs: number;
}

/** Snapshot for the admin Bot page — is the scheduler alive, when did it last run, when's it next due. */
export function getSchedulerStatus(): SchedulerStatus {
  return {
    configured: isTelegramConfigured(),
    internalTimerRunning: schedulerStarted,
    intervalMs: cachedConfig.intervalMs,
    lastRunAt,
    lastRunDurationMs,    lastRunError,
    nextScheduledTickAt,
    enabled: cachedConfig.enabled,
    checkIntervalMs: cachedConfig.intervalMs,
  };
}

export function startScheduler(): void {
  if (schedulerStarted) return;
  if (!isTelegramConfigured()) {
    console.warn("[Scheduler] TELEGRAM_BOT_TOKEN not set — Telegram notifications disabled.");
    return;
  }
  schedulerStarted = true;
  console.log("[Scheduler] Heartbeat loop started (config-driven check frequency).");

  const tick = () => runNotificationChecks().catch((err) => console.warn("[Scheduler] run failed:", err));

  // Run once immediately so reminders that are already due get flushed, then a
  // lightweight heartbeat wakes up every 5s, consults the runtime config
  // (enabled + custom interval from the admin Bot page), and only fires a full
  // notification check when the configured interval has elapsed. This lets the
  // admin change the frequency at runtime without restarting timers.
  void loadConfig(true);
  tick();
  setInterval(async () => {
    const cfg = await loadConfig();
    const dueAt = (lastRunAt ?? 0) + cfg.intervalMs;
    nextScheduledTickAt = cfg.enabled ? Math.max(dueAt, Date.now()) : null;
    if (!cfg.enabled || Date.now() < dueAt) return;
    tick();
  }, HEARTBEAT_MS);
}

export async function runNotificationChecks(): Promise<void> {
  if (!isTelegramConfigured()) return;
  // Master switch (admin Bot page) — honored for both the internal heartbeat
  // and external cron pings so disabling really stops everything.
  if (!(await loadConfig()).enabled) return;
  const startedAt = Date.now();
  try {
    const users = await listAllUsers();
    const { dateStr, hour, dow } = bangkokParts();

    for (const u of users) {
      try {
        await checkUser(u.id, dateStr, hour, dow);
      } catch (err) {
        console.warn(`[Scheduler] check failed for user ${u.id}:`, err);
      }
    }
    lastRunError = null;
  } catch (err) {
    lastRunError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    lastRunAt = startedAt;
    lastRunDurationMs = Date.now() - startedAt;
  }
}

async function checkUser(userId: number, dateStr: string, hour: number, dow: number): Promise<void> {
  const notif = await getNotifSettings(userId);
  const chatId = notif.telegramChatId;
  if (!chatId) return; // Telegram not linked for this user — nothing to send

  const state = { ...(notif._state ?? {}) };
  let dirty = false;

  // ── 1) "Did you record anything today?" reminder ────────────────────
  // Two modes: classic once-per-day at a fixed hour, or every N minutes
  // while today still has zero transactions (user-configurable).
  const reminderEnabled = notif.dailyReminderEnabled !== false;
  if (reminderEnabled && notif.dailyReminderMode === "interval") {
    const minutes = Math.max(5, notif.dailyReminderIntervalMinutes ?? 60);
    const intervalMs = minutes * 60 * 1000;
    // Reminders align to REAL clock boundaries (epoch-multiples of the
    // interval), not "N minutes since the previous one": e.g. armed at
    // 16:37 with interval=1h fires at 17:00:00, then 18:00, 19:00…
    let lastAt = state.lastIntervalReminderAt ?? 0;
    // (Re)anchor to a true clock boundary so reminders fire at aligned slots
    // (e.g. every 1h → :00 exactly), never offset from when the user armed
    // it or from a stale baseline left behind by a different interval. A valid
    // baseline is always a whole multiple of intervalMs (epoch origin = boundary).
    if (!lastAt || lastAt % intervalMs !== 0) {
      // First arm, or the stored baseline drifted off the boundary: snap to
      // the current slot instead of firing immediately, so the first nudge
      // lands exactly on the next boundary (04:00, not 03:55).
      lastAt = Math.floor(Date.now() / intervalMs) * intervalMs;
      state.lastIntervalReminderAt = lastAt;
      dirty = true;
    }
    const nextSlotAt = lastAt + intervalMs;
    if (Date.now() >= nextSlotAt) {
      const { from, to } = periodRange("daily");
      const todaysTx = await listTransactions(userId, { from, to, limit: 1 });
      if (todaysTx.length === 0) {
        const hhmm = new Date(nextSlotAt).toLocaleTimeString("th-TH", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        await sendTelegramMessage(
          chatId,
          `⏰ <b>ยังไม่ได้บันทึกรายการวันนี้เลยนะ</b> (${hhmm} น. · เตือนทุก ${minutes} นาที)\nพิมพ์ /interval daily เพื่อเปลี่ยนกลับเป็นเตือนรายวัน`,
        );
      }
      // Snap to the most recent completed slot (skips missed ones during
      // downtime) so alignment stays on absolute clock boundaries.
      state.lastIntervalReminderAt = Math.floor(Date.now() / intervalMs) * intervalMs;
      dirty = true;
    }
  } else if (reminderEnabled) {
    const reminderHour = notif.dailyReminderHour ?? 20;
    if (hour >= reminderHour && state.lastDailyReminderDate !== dateStr) {
      const { from, to } = periodRange("daily");
      const todaysTx = await listTransactions(userId, { from, to, limit: 1 });
      if (todaysTx.length === 0) {
        await sendTelegramMessage(
          chatId,
          "🌙 <b>วันนี้ยังไม่ได้บันทึกรายการเลยนะ</b>\nอย่าลืมบันทึกรายรับ-รายจ่ายก่อนนอน จะได้ไม่ลืมย้อนหลัง 💸",
        );
      }
      state.lastDailyReminderDate = dateStr;
      dirty = true;
    }
  }

  // ── 2) Budget usage alert ─────────────────────────────────────────
  if (notif.budgetAlertEnabled !== false) {
    const threshold = notif.budgetAlertThreshold ?? 80;
    const list = await listBudgets(userId);
    for (const b of list) {
      const key = String(b.id);
      const prevTier = state.notifiedBudgets?.[key];
      // Already sent the "over budget" alert today — nothing higher to escalate to.
      if (prevTier && prevTier.date === dateStr && prevTier.over) continue;

      const { from, to } = periodRange(b.period as PeriodKind);
      const txs = await listTransactions(userId, { from, to, type: "expense", category: b.category ?? undefined });
      const spent = txs.reduce((sum, t) => sum + Number(t.amount), 0);
      const limit = Number(b.limitAmount);
      const pct = limit > 0 ? (spent / limit) * 100 : 0;

      if (pct >= threshold) {
        const over = pct >= 100;
        // Skip only if we already sent this exact tier (warning or over) today.
        if (prevTier && prevTier.date === dateStr && prevTier.over === over) continue;
        await sendTelegramMessage(
          chatId,
          `${over ? "🔴" : "🟠"} <b>งบ "${escapeHtml(b.category ?? "")}"</b> ใช้ไปแล้ว ${pct.toFixed(0)}%\n${formatMoney(spent)} / ${formatMoney(limit)}`,
        );
        state.notifiedBudgets = { ...(state.notifiedBudgets ?? {}), [key]: { date: dateStr, over } };
        dirty = true;
      }
    }
  }

  // ── 3) Recurring item due soon ────────────────────────────────────
  if (notif.recurringReminderEnabled !== false) {
    const days = notif.recurringReminderDays ?? 3;
    const windowMs = days * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const list = await listRecurring(userId);
    for (const r of list) {
      const key = String(r.id);
      if (state.notifiedRecurring?.[key] === dateStr) continue; // once per day per item
      const diff = Number(r.nextDate) - now;
      if (diff <= windowMs) {
        const label = r.note || r.category || "รายการประจำ";
        const dueText = diff <= 0 ? "ครบกำหนดแล้ว" : `อีก ${Math.ceil(diff / 86400000)} วัน`;
        await sendTelegramMessage(
          chatId,
          `⏰ <b>รายการประจำ "${escapeHtml(label)}"</b> ${dueText}\nจำนวน ${formatMoney(Number(r.amount))}`,
        );
        state.notifiedRecurring = { ...(state.notifiedRecurring ?? {}), [key]: dateStr };
        dirty = true;
      }
    }
  }

  // ── 4) Goal reached threshold ─────────────────────────────────────
  if (notif.goalAlertEnabled !== false) {
    const threshold = notif.goalAlertThreshold ?? 100;
    const list = await listGoals(userId);
    for (const g of list) {
      const key = String(g.id);
      const target = Number(g.targetAmount);
      const saved = Number(g.savedAmount);
      const pct = target > 0 ? (saved / target) * 100 : 0;
      const already = state.notifiedGoals?.[key];

      if (pct >= threshold && !already) {
        await sendTelegramMessage(
          chatId,
          `🎯 <b>เป้าหมาย "${escapeHtml(g.name)}"</b> สะสมได้ ${pct.toFixed(0)}% แล้ว!\n${formatMoney(saved)} / ${formatMoney(target)}`,
        );
        state.notifiedGoals = { ...(state.notifiedGoals ?? {}), [key]: true };
        dirty = true;
      } else if (pct < threshold && already) {
        // Allow re-notifying if it dips below and crosses the threshold again later
        const rest = { ...(state.notifiedGoals ?? {}) };
        delete rest[key];
        state.notifiedGoals = rest;
        dirty = true;
      }
    }
  }

  // ── 5) Daily budget-pacing summary (opt-in, off by default) ────────
  if (notif.dailyPacingEnabled === true) {
    const pacingHour = notif.dailyPacingHour ?? 9;
    if (hour >= pacingHour && state.lastPacingDate !== dateStr) {
      const text = await buildPacingMessage(userId);
      if (text) await sendTelegramMessage(chatId, text);
      state.lastPacingDate = dateStr;
      dirty = true;
    }
  }

  // ── 6) Weekly recap, every Sunday evening (on by default once linked) ──
  if (notif.weeklySummaryEnabled !== false) {
    const summaryHour = notif.weeklySummaryHour ?? 19;
    // dow: 0 = Sunday (Asia/Bangkok). `dateStr` doubles as the once-per-week
    // dedupe key since it only lands on a Sunday when it fires.
    if (dow === 0 && hour >= summaryHour && state.lastWeeklySummaryWeek !== dateStr) {
      await sendTelegramMessage(chatId, await buildWeeklySummaryMessage(userId));
      state.lastWeeklySummaryWeek = dateStr;
      dirty = true;
    }
  }

  // ── 7) User-created custom reminders ("เตือนพรุ่งนี้ 9 โมง ...") ──────
  let reminders: CustomReminder[] | null = null;
  if (notif.customReminders && notif.customReminders.length > 0) {
    const now = Date.now();
    const kept: CustomReminder[] = [];
    let remindersChanged = false;
    for (const r of notif.customReminders) {
      if (r.nextAt > now) {
        kept.push(r);
        continue;
      }
      // firedAt goes on the callback_data so handleReminderDone (telegram.ts)
      // can log the exact moment this reminder actually fired, even though
      // "once" reminders are dropped from customReminders right below.
      const firedAt = Date.now();
      await sendTelegramKeyboard(chatId, `🔔 <b>เตือนความจำ</b>\n${escapeHtml(r.text)}`, [
        [{ text: "✅ เสร็จแล้ว", callback_data: `remdone:${r.id}:${firedAt}` }],
        [{ text: "⏰ เตือนอีกที 10 นาที", callback_data: `snooze:${r.id}` }],
      ]);
      remindersChanged = true;
      if (r.recurrence === "once") continue; // fired once — drop it
      kept.push({ ...r, nextAt: advanceReminder(r.nextAt, r.recurrence) });
    }
    if (remindersChanged) reminders = kept;
  }

  if (dirty || reminders !== null) {
    const patch: Partial<NotifSettingsState> = {};
    if (dirty) patch._state = state;
    if (reminders !== null) patch.customReminders = reminders;
    await saveNotifSettings(userId, patch);
  }
}
