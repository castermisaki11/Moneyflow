import { ENV } from "./env";
import { escapeHtml, isTelegramConfigured, sendTelegramMessage } from "./telegram";

export type NotificationPayload = {
  title: string;
  content: string;
};

/**
 * Admin/system notification (used by system.notifyOwner). Sends to a fixed
 * admin chat id (TELEGRAM_ADMIN_CHAT_ID) via the Telegram bot. Per-user
 * notifications (budget/recurring/goal/daily-reminder) go through
 * notifSettings.ts + scheduler.ts instead, since those target each user's
 * own linked chat.
 */
export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  if (!isTelegramConfigured() || !ENV.telegramAdminChatId) {
    // Notification service not configured — no-op
    return false;
  }
  const text = `<b>${escapeHtml(payload.title)}</b>\n${escapeHtml(payload.content)}`;
  return sendTelegramMessage(ENV.telegramAdminChatId, text);
}
