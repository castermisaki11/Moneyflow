/**
 * Generic OAuth2 "authorization code" provider config.
 *
 * Adding a new provider (Google, GitHub, LINE, ...) means adding one entry
 * to OAUTH_PROVIDERS below — no new routes or duplicated fetch/exchange
 * logic needed. server/_core/oauth.ts loops over this map and registers
 * `/api/auth/<id>` + `/api/auth/<id>/callback` for every entry.
 *
 * `id` is also what ends up in the DB: openId is `${id}-${providerUserId}`
 * and loginMethod is `id`. Keep ids stable once a provider is live — they're
 * part of every existing OAuth user's openId.
 */

export interface NormalizedOAuthUser {
  id: string; // provider's own user id (stable, never the email)
  name: string | null;
  email: string | null;
}

export interface OAuthProviderConfig {
  id: string;
  label: string; // human-readable, used only in error messages
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
  extraAuthorizeParams?: Record<string, string>;
  clientIdEnv: string;
  clientSecretEnv: string;
  redirectUriEnv: string;
  /** Some providers (Google) want the token request as JSON-able form body
   *  with client_secret included, same shape as Discord — so no variant
   *  needed today, but kept as a hook in case a future provider wants
   *  HTTP Basic auth instead. */
  tokenAuthStyle?: "body" | "basic";
  parseUser: (raw: any) => NormalizedOAuthUser;
}

function requiredEnv(name: string, providerLabel: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `ต้องตั้งค่า environment variable ${name} ก่อนใช้งาน ${providerLabel} login`
    );
  }
  return val;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  discord: {
    id: "discord",
    label: "Discord",
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userUrl: "https://discord.com/api/users/@me",
    scope: "identify",
    extraAuthorizeParams: { prompt: "consent" },
    clientIdEnv: "DISCORD_CLIENT_ID",
    clientSecretEnv: "DISCORD_CLIENT_SECRET",
    redirectUriEnv: "DISCORD_REDIRECT_URI",
    parseUser: (raw) => ({
      id: raw.id,
      name: raw.global_name || raw.username,
      email: null,
    }),
  },
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    scope: "openid email profile",
    // select_account (not Discord's "consent") so people with multiple
    // Google accounts logged into the browser get the picker every time,
    // instead of silently reusing whichever one Google picks by default.
    extraAuthorizeParams: { prompt: "select_account" },
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    redirectUriEnv: "GOOGLE_REDIRECT_URI",
    parseUser: (raw) => ({
      id: raw.id,
      name: raw.name || raw.email || null,
      email: raw.email ?? null,
    }),
  },
};

export function getAuthorizeUrl(provider: OAuthProviderConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: requiredEnv(provider.clientIdEnv, provider.label),
    redirect_uri: requiredEnv(provider.redirectUriEnv, provider.label),
    response_type: "code",
    scope: provider.scope,
    state,
    ...(provider.extraAuthorizeParams ?? {}),
  });
  return `${provider.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  provider: OAuthProviderConfig,
  code: string
): Promise<{ access_token: string }> {
  const body = new URLSearchParams({
    client_id: requiredEnv(provider.clientIdEnv, provider.label),
    client_secret: requiredEnv(provider.clientSecretEnv, provider.label),
    grant_type: "authorization_code",
    code,
    redirect_uri: requiredEnv(provider.redirectUriEnv, provider.label),
  });

  const res = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `แลก authorization code เป็น token ไม่สำเร็จ (${provider.label}, ${res.status}): ${text}`
    );
  }

  return res.json();
}

export async function fetchOAuthUser(
  provider: OAuthProviderConfig,
  accessToken: string
): Promise<NormalizedOAuthUser> {
  const res = await fetch(provider.userUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `ดึงข้อมูลผู้ใช้ ${provider.label} ไม่สำเร็จ (${res.status}): ${text}`
    );
  }

  const raw = await res.json();
  return provider.parseUser(raw);
}
