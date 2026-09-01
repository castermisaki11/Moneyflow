import { MemoryCacheStore } from "./memoryStore";
import { userPrefix } from "./keys";
import type { CacheStore } from "./types";
import { emitUserEvent } from "../events";

export { userKey, userParamsKey, userPrefix, userSessionKey } from "./keys";
export type { CacheStore, CacheStats } from "./types";

// Single process-wide cache instance. Swap `MemoryCacheStore` for a
// Redis-backed CacheStore here if this ever runs multi-instance.
export const cache: CacheStore = new MemoryCacheStore();

/** Per-entity TTLs — tune independently. Longer for rarely-changing data. */
export const CACHE_TTL = {
  settings: 5 * 60_000, // 5 min
  budgets: 60_000, // 1 min
  goals: 60_000,
  recurring: 2 * 60_000,
  transactions: 30_000, // 30s — changes most often
  userSession: 45_000, // hit on every authenticated request; short so role/name edits show up fast
} as const;

/**
 * Cache-aside helper: return cached value if present, otherwise run `fetcher`,
 * store the result, and return it.
 */
export async function getOrSet<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached !== undefined) return cached;
  const fetchStartedAt = Date.now();
  const value = await fetcher();
  cache.set(key, value, ttlMs, fetchStartedAt);
  return value;
}

/**
 * Invalidate every cached entry for one entity + user (call after create/update/delete),
 * and push a real-time "sync" signal to any other live connections for that user.
 */
export function invalidateUser(entity: string, userId: number): void {
  cache.deletePrefix(userPrefix(entity, userId));
  emitUserEvent(userId, entity);
}

/** Current hit/miss/size stats, if the active backend supports reporting them. */
export function getCacheStats() {
  return cache.getStats?.() ?? null;
}
