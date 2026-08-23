import { listAllReminderLogs, listAllSettingsForBot, listAllUsers, listBotBroadcastLogs } from "../db";
import { parseNotifSettings } from "./notifSettings";

export interface BotUpcomingReminder {
  userId: number;
  userName: string | null;
  text: string;
  nextAt: number; // epoch ms
  recurrence: string;
}

export interface BotRecentCompletion {
  userName: string | null;
  text: string;
  firedAt: number; // epoch ms
  completedAt: number; // epoch ms
}

export interface BotBroadcastEntry {
  adminName: string | null;
  text: string;
  targetCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: number; // epoch ms
}

export interface BotOverview {
  totalUsers: number;
  linkedUsers: number;
  dailyReminderOn: number;
  weeklySummaryOn: number;
  dailyPacingOn: number;
  activeCustomReminders: number;
  /** Soonest-firing reminders across every user, nearest first — powers the countdown widget. */
  upcomingReminders: BotUpcomingReminder[];
  reminderCompletions: {
    total: number;
    last7Days: number;
    recent: BotRecentCompletion[];
  };
  /** Most recent admin broadcasts, newest first. */
  broadcastHistory: BotBroadcastEntry[];
}

export interface BotLinkedChat {
  userId: number;
  userName: string | null;
  chatId: string;
}

/** Every user currently linked to Telegram, for the admin broadcast tool. */
export async function listLinkedTelegramChats(): Promise<BotLinkedChat[]> {
  const [allUsers, allSettings] = await Promise.all([listAllUsers(), listAllSettingsForBot()]);
  const nameById = new Map(allUsers.map((u) => [u.id, u.name] as const));
  const out: BotLinkedChat[] = [];
  for (const row of allSettings) {
    const notif = parseNotifSettings(row.notificationSettings as any);
    if (notif.telegramChatId) {
      out.push({ userId: row.userId, userName: nameById.get(row.userId) ?? null, chatId: notif.telegramChatId });
    }
  }
  return out;
}

/**
 * One-shot aggregation across every user's settings + the reminder-log
 * table. Nothing here is cached — this is an admin-only, low-traffic page,
 * and the underlying tables are hobby-scale (see comment on
 * listAllReminderLogs), so a fresh full scan on every load is simpler than
 * keeping it warm.
 */
export async function getBotOverview(): Promise<BotOverview> {
  const [allUsers, allSettings, logRows, broadcastRows] = await Promise.all([
    listAllUsers(),
    listAllSettingsForBot(),
    listAllReminderLogs(),
    listBotBroadcastLogs(10),
  ]);

  const nameById = new Map(allUsers.map((u) => [u.id, u.name] as const));

  let linkedUsers = 0;
  let dailyReminderOn = 0;
  let weeklySummaryOn = 0;
  let dailyPacingOn = 0;
  let activeCustomReminders = 0;
  const upcoming: BotUpcomingReminder[] = [];

  for (const row of allSettings) {
    const notif = parseNotifSettings(row.notificationSettings as any);
    if (!notif.telegramChatId) continue;
    linkedUsers++;
    if (notif.dailyReminderEnabled !== false) dailyReminderOn++;
    if (notif.weeklySummaryEnabled !== false) weeklySummaryOn++;
    if (notif.dailyPacingEnabled === true) dailyPacingOn++;
    for (const r of notif.customReminders ?? []) {
      activeCustomReminders++;
      upcoming.push({
        userId: row.userId,
        userName: nameById.get(row.userId) ?? null,
        text: r.text,
        nextAt: r.nextAt,
        recurrence: r.recurrence,
      });
    }
  }
  upcoming.sort((a, b) => a.nextAt - b.nextAt);

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const last7Days = logRows.filter((r) => new Date(r.completedAt).getTime() >= sevenDaysAgo).length;
  const recent: BotRecentCompletion[] = logRows.slice(0, 10).map((r) => ({
    userName: nameById.get(r.userId) ?? null,
    text: r.reminderText,
    firedAt: r.firedAt,
    completedAt: new Date(r.completedAt).getTime(),
  }));

  const broadcastHistory: BotBroadcastEntry[] = broadcastRows.map((b) => ({
    adminName: nameById.get(b.adminUserId) ?? null,
    text: b.text,
    targetCount: b.targetCount,
    sentCount: b.sentCount,
    failedCount: b.failedCount,
    createdAt: new Date(b.createdAt).getTime(),
  }));

  return {
    totalUsers: allUsers.length,
    linkedUsers,
    dailyReminderOn,
    weeklySummaryOn,
    dailyPacingOn,
    activeCustomReminders,
    upcomingReminders: upcoming.slice(0, 12),
    reminderCompletions: { total: logRows.length, last7Days, recent },
    broadcastHistory,
  };
}
