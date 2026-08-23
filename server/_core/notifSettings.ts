import { getSettings, upsertSettings } from "../db";
import type { ReminderRecurrence } from "./reminderParser";

/** A user-created custom reminder set via the Telegram bot (e.g. "เตือนพรุ่งนี้ 9 โมง จ่ายค่าเน็ต"). */
export interface CustomReminder {
  id: string;
  text: string;
  nextAt: number; // epoch ms of next fire
  recurrence: ReminderRecurrence;
  createdAt: number;
}

/**
 * Full shape of the `settings.notificationSettings` JSON text column.
 * The client (SettingsView.tsx) only knows about/edits the first six
 * "preference" fields — everything else here (telegram*, dailyReminder*,
 * _state) is written by the server and must survive client updates.
 * See `mergeNotifJsonStrings` in routers.ts for how that's guaranteed.
 */
export interface NotifSettingsState {
  budgetAlertEnabled?: boolean;
  budgetAlertThreshold?: number; // 0-100
  recurringReminderEnabled?: boolean;
  recurringReminderDays?: number;
  goalAlertEnabled?: boolean;
  goalAlertThreshold?: number; // 0-100

  // Telegram channel
  telegramChatId?: string;
  telegramLinkedAt?: number;
  dailyReminderEnabled?: boolean; // default true once linked
  dailyReminderHour?: number; // 0-23, Asia/Bangkok local hour, default 20

  // Opt-in daily "budget left ÷ days left in month" push. Off by default —
  // unlike the other three alert types this one is purely informational,
  // not a "something needs attention" alert, so it doesn't turn on by
  // default just because Telegram got linked.
  dailyPacingEnabled?: boolean; // default false
  dailyPacingHour?: number; // 0-23, Asia/Bangkok local hour, default 9

  // Weekly recap sent every Sunday — on by default once linked, same as
  // the daily reminder (it's a recap, not an alert someone opted into).
  weeklySummaryEnabled?: boolean; // default true
  weeklySummaryHour?: number; // 0-23, Asia/Bangkok local hour, default 19

  // User-created custom reminders (set via the bot with "เตือน ..."), each
  // fired by the scheduler and either dropped (recurrence "once") or
  // rescheduled to its next occurrence.
  customReminders?: CustomReminder[];

  // Internal dedupe bookkeeping so the scheduler doesn't spam the same
  // alert every tick. Not surfaced in the Settings UI.
  _state?: {
    lastDailyReminderDate?: string; // YYYY-MM-DD (Asia/Bangkok)
    lastPacingDate?: string; // YYYY-MM-DD (Asia/Bangkok)
    lastWeeklySummaryWeek?: string; // YYYY-MM-DD (Asia/Bangkok) of that week's Monday
    notifiedBudgets?: Record<string, { date: string; over: boolean }>; // budgetId -> last notified tier (date + whether it was the "over 100%" alert)
    notifiedRecurring?: Record<string, string>; // recurringId -> date last notified
    notifiedGoals?: Record<string, boolean>; // goalId -> already notified at current threshold
  };
}

export function parseNotifSettings(json: string | null | undefined): NotifSettingsState {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Shallow-merges `incoming` on top of `existing` (both as JSON strings). */
export function mergeNotifJsonStrings(
  existingJson: string | null | undefined,
  incomingJson: string | null | undefined,
): string {
  const merged: NotifSettingsState = {
    ...parseNotifSettings(existingJson),
    ...parseNotifSettings(incomingJson),
  };
  return JSON.stringify(merged);
}

export async function getNotifSettings(userId: number): Promise<NotifSettingsState> {
  const current = await getSettings(userId);
  return parseNotifSettings(current?.notificationSettings as any);
}

/** Merge-and-save a partial patch into the user's notificationSettings JSON. */
export async function saveNotifSettings(
  userId: number,
  patch: Partial<NotifSettingsState>,
): Promise<NotifSettingsState> {
  const current = await getSettings(userId);
  const merged: NotifSettingsState = {
    ...parseNotifSettings(current?.notificationSettings as any),
    ...patch,
  };
  await upsertSettings({
    userId,
    currency: current?.currency ?? "THB",
    theme: (current?.theme as any) ?? "dark",
    myAccountNumber: (current as any)?.myAccountNumber ?? null,
    customCategories: current?.customCategories ?? null,
    deletedDefaultCategories: (current as any)?.deletedDefaultCategories ?? null,
    notificationSettings: JSON.stringify(merged),
    pinHash: (current as any)?.pinHash ?? null,
  } as any);
  return merged;
}

export async function linkTelegramChat(userId: number, chatId: string): Promise<void> {
  await saveNotifSettings(userId, {
    telegramChatId: chatId,
    telegramLinkedAt: Date.now(),
    dailyReminderEnabled: true,
  });
}

export async function unlinkTelegramChat(userId: number): Promise<void> {
  await saveNotifSettings(userId, { telegramChatId: undefined, telegramLinkedAt: undefined });
}
