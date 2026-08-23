import { z } from "zod";
import { getNotifSettings, saveNotifSettings, unlinkTelegramChat, type NotifSettingsState } from "./notifSettings";
import { buildPacingMessage } from "./pacing";
import { createLinkCode, getBotUsername, isTelegramConfigured, sendTelegramMessage } from "./telegram";
import { protectedProcedure, router } from "./trpc";

export const telegramRouter = router({
  /** Is Telegram sending configured on this server at all (bot token set)? */
  configured: protectedProcedure.query(() => ({ configured: isTelegramConfigured() })),

  /** Current user's link status, shown in Settings. */
  status: protectedProcedure.query(async ({ ctx }) => {
    const notif = await getNotifSettings(ctx.user.id);
    return {
      linked: Boolean(notif.telegramChatId),
      linkedAt: notif.telegramLinkedAt ?? null,
      dailyReminderEnabled: notif.dailyReminderEnabled !== false,
      dailyReminderHour: notif.dailyReminderHour ?? 20,
      dailyPacingEnabled: notif.dailyPacingEnabled === true,
      dailyPacingHour: notif.dailyPacingHour ?? 9,
      weeklySummaryEnabled: notif.weeklySummaryEnabled !== false,
      weeklySummaryHour: notif.weeklySummaryHour ?? 19,
    };
  }),

  /** Same "budget left ÷ days left" text the bot sends, shown in-app too (e.g. Settings preview). */
  pacingPreview: protectedProcedure.query(async ({ ctx }) => ({ text: await buildPacingMessage(ctx.user.id) })),

  /** Generates a short-lived code + deep link the user opens in Telegram to link their chat. */
  createLink: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isTelegramConfigured()) {
      return { configured: false as const, code: null, deepLink: null };
    }
    const code = createLinkCode(ctx.user.id);
    const botUsername = await getBotUsername();
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=${code}` : null;
    return { configured: true as const, code, deepLink };
  }),

  unlink: protectedProcedure.mutation(async ({ ctx }) => {
    await unlinkTelegramChat(ctx.user.id);
    return { success: true };
  }),

  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    const notif = await getNotifSettings(ctx.user.id);
    if (!notif.telegramChatId) return { success: false };
    const delivered = await sendTelegramMessage(
      notif.telegramChatId,
      "🔔 นี่คือข้อความทดสอบจาก MoneyFlow — เชื่อมต่อเรียบร้อยดี!",
    );
    return { success: delivered };
  }),

  updateDailyReminder: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        hour: z.number().min(0).max(23).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Partial<NotifSettingsState> = {};
      if (input.enabled !== undefined) patch.dailyReminderEnabled = input.enabled;
      if (input.hour !== undefined) patch.dailyReminderHour = input.hour;
      const merged = await saveNotifSettings(ctx.user.id, patch);
      return {
        dailyReminderEnabled: merged.dailyReminderEnabled !== false,
        dailyReminderHour: merged.dailyReminderHour ?? 20,
      };
    }),

  updateDailyPacing: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        hour: z.number().min(0).max(23).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Partial<NotifSettingsState> = {};
      if (input.enabled !== undefined) patch.dailyPacingEnabled = input.enabled;
      if (input.hour !== undefined) patch.dailyPacingHour = input.hour;
      const merged = await saveNotifSettings(ctx.user.id, patch);
      return {
        dailyPacingEnabled: merged.dailyPacingEnabled === true,
        dailyPacingHour: merged.dailyPacingHour ?? 9,
      };
    }),

  updateWeeklySummary: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        hour: z.number().min(0).max(23).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Partial<NotifSettingsState> = {};
      if (input.enabled !== undefined) patch.weeklySummaryEnabled = input.enabled;
      if (input.hour !== undefined) patch.weeklySummaryHour = input.hour;
      const merged = await saveNotifSettings(ctx.user.id, patch);
      return {
        weeklySummaryEnabled: merged.weeklySummaryEnabled !== false,
        weeklySummaryHour: merged.weeklySummaryHour ?? 19,
      };
    }),
});
