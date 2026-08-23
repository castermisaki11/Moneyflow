import { MemoryCacheStore } from "./memoryStore";
import { telegramSummaryPrefix, userPrefix } from "./keys";
import type { CacheStore } from "./types";
import { emitUserEvent } from "../events";

export { userKey, userParamsKey, userPrefix, userSessionKey, telegramChatKey, telegramSummaryPrefix, telegramSummaryKey } from "./keys";
export type { CacheStore, CacheStats } from "./types";

// Single process-wide cache instance. Swap `MemoryCacheStore` for a
// Redis-backed CacheStore here if this ever runs multi-instance.
export const cache: CacheStore = new MemoryCacheStore();

/** Per-entity TTLs — tune independently. Longer for rarely-changing data. */
export const CACHE_TTL = {
  settings: 5 * 60_000, // 5 min
  budgets: 60_000, // 1 min
  goals: 60_000,
  wishlist: 60_000,
  recurring: 2 * 60_000,
  transactions: 30_000, // 30s — changes most often
  userSession: 45_000, // hit on every authenticated request; short so role/name edits show up fast
  telegramChat: 15 * 60_000, // chat-to-user link almost never changes once set
} as const;

/**
 * Cache-aside helper: return cached value if present, otherwise run `fetcher`,
 * store the result, and return it.
 */
export async function getOrSet<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached !== undefined) return cached;
  // Recorded *before* the DB read so a concurrent delete/invalidate that
  // lands while `fetcher()` is still in flight can be detected below — see
  // the big comment on invalidateUser() for why this matters.
  const fetchStartedAt = Date.now();
  const value = await fetcher();
  cache.set(key, value, ttlMs, fetchStartedAt);
  return value;
}

/**
 * Invalidate every cached entry for one entity + user (call after create/update/delete),
 * and push a real-time "sync" signal to any other live connections for that user (web
 * tabs, native app) so they refetch immediately instead of waiting on staleTime/focus —
 * this is what keeps the Telegram bot and the web UI in sync without a manual refresh.
 *
 * Race this guards against: a read for the same key starts (cache miss, DB
 * query in flight) *just before* a delete commits and calls this. The delete
 * clears the cache, but the still-in-flight read then resolves with the
 * now-stale pre-delete row and used to write it straight back into the
 * cache — "resurrecting" a row the DB no longer has. Any subsequent
 * freshness check (e.g. the client's post-delete verification read) would
 * then see the row, conclude the delete failed, and show a false
 * "delete unsuccessful" toast — even though the DB delete had actually
 * succeeded. `getOrSet`/`MemoryCacheStore.set` now fence against this by
 * timestamping every invalidation and refusing to cache a value whose fetch
 * started before it.
 */
export function invalidateUser(entity: string, userId: number): void {
  cache.deletePrefix(userPrefix(entity, userId));
  emitUserEvent(userId, entity);
}

/** Drop cached pre-formatted Telegram summaries for a user — call whenever their transactions change. */
export function invalidateTelegramSummary(userId: number): void {
  cache.deletePrefix(telegramSummaryPrefix(userId));
}

/** Current hit/miss/size stats, if the active backend supports reporting them. */
export function getCacheStats() {
  return cache.getStats?.() ?? null;
}
