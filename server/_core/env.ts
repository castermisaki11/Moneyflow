// Env var name that lists admin user IDs for a given OAuth provider, e.g.
// "discord" -> ADMIN_DISCORD_IDS, "google" -> ADMIN_GOOGLE_IDS. Add a new
// provider to oauthProviders.ts and its admin-id env var works automatically
// — no change needed here.
function adminIdsEnvVar(providerId: string): string {
  return `ADMIN_${providerId.toUpperCase()}_IDS`;
}

function parseIdList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "change-me-please",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  // Per-provider admin user IDs (the raw ID the provider shows for the
  // account, not the "<provider>-" prefixed openId) that should get role
  // "admin" on login/signup — e.g. ADMIN_DISCORD_IDS="123,456",
  // ADMIN_GOOGLE_IDS="109..." . Checked in addition to ownerOpenId above,
  // so you can add more admins just by editing the env var — no code
  // change or redeploy of logic needed.
  adminDiscordIds: parseIdList(process.env.ADMIN_DISCORD_IDS),
  // Telegram bot notification system — see TELEGRAM_SETUP.md
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME ?? "",
  // Optional: chat id that receives admin/system notifications (system.notifyOwner)
  telegramAdminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID ?? "",
  // Optional shared secret for the external cron ping endpoint (/api/cron/check-notifications).
  // On hosts that spin the process down when idle (e.g. Render free tier), the in-process
  // setInterval scheduler stops too, so scheduled reminders silently never fire until
  // something wakes the server back up. Point an external cron (cron-job.org, UptimeRobot,
  // GitHub Actions, ...) at that endpoint every 5-10 min to both wake the server and run the
  // check. If unset, the endpoint is open — set it in production to stop randoms from hitting it.
  cronSecret: process.env.CRON_SECRET ?? "",
  // Public HTTPS base URL of this deployment (e.g. https://moneyflow.onrender.com).
  // Enables the Telegram WebApp button ("🌐 เปิด MoneyFlow") in the chat.
  publicAppUrl: process.env.PUBLIC_APP_URL ?? "",
};

/**
 * Whether this user's openId should get role "admin" on login/signup.
 * Three ways in: the legacy single OWNER_OPEN_ID, a Discord user id listed
 * in ADMIN_DISCORD_IDS, or (for any other OAuth provider) an id listed in
 * ADMIN_<PROVIDER>_IDS — openId is always "<provider>-<id>", see
 * server/_core/oauth.ts and oauthProviders.ts. Re-checked on every login,
 * so adding/removing an id from the env var takes effect the next time
 * that person signs in — no manual DB edit needed.
 */
export function isAdminOpenId(openId: string): boolean {
  if (openId === ENV.ownerOpenId) return true;
  if (openId.startsWith("discord-")) {
    const discordId = openId.slice("discord-".length);
    return ENV.adminDiscordIds.includes(discordId);
  }
  const sepIndex = openId.indexOf("-");
  if (sepIndex > 0) {
    const providerId = openId.slice(0, sepIndex);
    const providerUserId = openId.slice(sepIndex + 1);
    const ids = parseIdList(process.env[adminIdsEnvVar(providerId)]);
    return ids.includes(providerUserId);
  }
  return false;
}
