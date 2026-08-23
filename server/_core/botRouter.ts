import { z } from "zod";
import { getBotOverview, listLinkedTelegramChats } from "./botStats";
import { getSchedulerStatus } from "./scheduler";
import { getBotUsername, isTelegramConfigured, sendTelegramMessage } from "./telegram";
import { adminProcedure, router } from "./trpc";
import { insertBotBroadcastLog } from "../db";

export const botRouter = router({
  /** Everything the admin "Bot" page needs in one round trip. */
  overview: adminProcedure.query(async () => {
    const [stats, botUsername] = await Promise.all([getBotOverview(), getBotUsername()]);
    return {
      configured: isTelegramConfigured(),
      botUsername,
      scheduler: getSchedulerStatus(),
      ...stats,
    };
  }),

  /**
   * Sends one message to every user currently linked to Telegram. Sent in
   * small batches (5 at a time) so a large user base doesn't slam Telegram's
   * API all at once; failures are counted, not thrown, so one bad chat
   * (e.g. user blocked the bot) doesn't abort the rest. Every real attempt —
   * including a 0-target send if nobody's linked — is logged via
   * insertBotBroadcastLog so the admin Bot page can show a history. Not
   * logged when the bot isn't configured at all, since no send was attempted.
   */
  broadcast: adminProcedure
    .input(z.object({ text: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      if (!isTelegramConfigured()) {
        return { sent: 0, failed: 0, total: 0, configured: false as const };
      }
      const chats = await listLinkedTelegramChats();
      let sent = 0;
      let failed = 0;
      const BATCH_SIZE = 5;
      for (let i = 0; i < chats.length; i += BATCH_SIZE) {
        const batch = chats.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map((c) => sendTelegramMessage(c.chatId, input.text)));
        for (const ok of results) {
          if (ok) sent++;
          else failed++;
        }
      }
      await insertBotBroadcastLog({
        adminUserId: ctx.user.id,
        text: input.text,
        targetCount: chats.length,
        sentCount: sent,
        failedCount: failed,
      });
      return { sent, failed, total: chats.length, configured: true as const };
    }),
});
