// Env var name that lists admin user IDs for a given OAuth provider, e.g.
// "google" -> ADMIN_GOOGLE_IDS. Add a new provider to oauthProviders.ts and
// its admin-id env var works automatically — no change needed here.
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
  // "admin" on login/signup — e.g. ADMIN_GOOGLE_IDS="109..." . Checked in
  // addition to ownerOpenId above, so you can add more admins just by
  // editing the env var — no code change or redeploy of logic needed.
  adminGoogleIds: parseIdList(process.env.ADMIN_GOOGLE_IDS),
};

/**
 * Whether this user's openId should get role "admin" on login/signup.
 * Two ways in: the legacy single OWNER_OPEN_ID, or a user id listed in
 * ADMIN_<PROVIDER>_IDS — openId is always "<provider>-<id>", see
 * server/_core/oauth.ts and oauthProviders.ts. Re-checked on every login,
 * so adding/removing an id from the env var takes effect the next time
 * that person signs in — no manual DB edit needed.
 */
export function isAdminOpenId(openId: string): boolean {
  if (openId === ENV.ownerOpenId) return true;
  const sepIndex = openId.indexOf("-");
  if (sepIndex > 0) {
    const providerId = openId.slice(0, sepIndex);
    const providerUserId = openId.slice(sepIndex + 1);
    const ids = parseIdList(process.env[adminIdsEnvVar(providerId)]);
    return ids.includes(providerUserId);
  }
  return false;
}
