/**
 * CacheStore — abstraction over the caching backend.
 *
 * Today this is implemented by an in-process LRU+TTL Map (see memoryStore.ts).
 * If the app later needs multi-instance sharing, swap the implementation for
 * a Redis-backed one that satisfies the same interface — no call sites need
 * to change.
 */
export interface CacheStore {
  get<T>(key: string): T | undefined;
  /**
   * `fetchStartedAt` (ms epoch, from `Date.now()` right before the DB read that
   * produced `value` began) lets the store detect and drop a "lost update":
   * a read that started before a delete/invalidate for this key (or a prefix
   * of it) but resolves and writes *after* it. Without this, that late write
   * silently resurrects stale data — see cache/index.ts for the full story.
   * Omit it only for writes that are known not to race a concurrent
   * invalidation (e.g. seeding a brand-new key).
   */
  set<T>(key: string, value: T, ttlMs: number, fetchStartedAt?: number): void;
  delete(key: string): void;
  /** Delete every key starting with `prefix` (used for namespace invalidation, e.g. per-user). */
  deletePrefix(prefix: string): void;
  clear(): void;
  /** Optional — not every backend can report this cheaply (e.g. a shared Redis store). */
  getStats?(): CacheStats;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}
