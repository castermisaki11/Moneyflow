/**
 * Cache key builders.
 *
 * Convention: `<entity>:<userId>[:<paramsHash>]`
 * The per-user prefix (`<entity>:<userId>`) is also what invalidation targets,
 * so every read key for a user must start with its own `userPrefix(entity, userId)`.
 */

export function userPrefix(entity: string, userId: number): string {
  return `${entity}:${userId}`;
}

/** Stable key for params-less reads (settings, budgets, goals, wishlist, recurring). */
export function userKey(entity: string, userId: number): string {
  return userPrefix(entity, userId);
}

/** Key for reads with filter params (e.g. listTransactions(from/to/type/category/limit)). */
export function userParamsKey(entity: string, userId: number, params: unknown): string {
  const stable = params ? stableStringify(params) : "";
  return `${userPrefix(entity, userId)}:${stable}`;
}

/** Key for the per-request "who is this JWT's user" lookup (see server/db.ts getUserById). */
export function userSessionKey(userId: number): string {
  return `userSession:${userId}`;
}

/** Key for the Telegram chatId → userId reverse lookup. */
export function telegramChatKey(chatId: string): string {
  return `telegramChat:${chatId}`;
}

/** Prefix for cached, pre-formatted Telegram summary messages for one user (all periods). */
export function telegramSummaryPrefix(userId: number): string {
  return `telegramSummary:${userId}`;
}

/** Key for one cached Telegram summary message (e.g. "daily", "weekly"). */
export function telegramSummaryKey(userId: number, kind: string): string {
  return `${telegramSummaryPrefix(userId)}:${kind}`;
}

/** Deterministic stringify so {a:1,b:2} and {b:2,a:1} produce the same key. */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const k of sortedKeys) sortedObj[k] = (obj as Record<string, unknown>)[k];
  return JSON.stringify(sortedObj);
}
