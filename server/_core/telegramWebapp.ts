/**
 * Telegram WebApp login: validates initData sent by the Telegram client
 * per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * then maps the Telegram user to a linked MoneyFlow account.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { findUserIdByTelegramChatId } from "../db";
import { ENV } from "./env";

export interface ValidatedTelegramUser {
  telegramUserId: string;
  moneyflowUserId: number;
}

export function validateTelegramInitData(initData: string): { userId: string } | null {
  if (!ENV.telegramBotToken || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(ENV.telegramBotToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  try {
    if (!timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"))) return null;
  } catch {
    return null;
  }

  // Optional freshness check — reject data older than 24h (replay guard).
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 24 * 3600) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "{}") as { id?: number };
    if (!user.id) return null;
    return { userId: String(user.id) };
  } catch {
    return null;
  }
}

/**
 * Validate initData and resolve it to a linked MoneyFlow account.
 * Returns null when the signature is bad or no account is linked to that
 * Telegram user yet (they should use OAuth login instead).
 */
export async function loginFromTelegramInitData(
  initData: string,
): Promise<ValidatedTelegramUser | null> {
  const validated = validateTelegramInitData(initData);
  if (!validated) return null;
  const moneyflowUserId = await findUserIdByTelegramChatId(validated.userId);
  if (!moneyflowUserId) return null;
  return { telegramUserId: validated.userId, moneyflowUserId };
}
