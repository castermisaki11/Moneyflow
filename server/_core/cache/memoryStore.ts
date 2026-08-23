import type { CacheStats, CacheStore } from "./types";

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-process cache: TTL-based expiry + LRU eviction once `maxEntries` is hit.
 * Good enough for a single-instance deployment (this app's current scale).
 * Not shared across processes — if you ever run >1 server instance behind a
 * load balancer, replace with a Redis-backed CacheStore instead.
 */
const FENCE_TTL_MS = 60_000; // see recordFence()/isFenced() below

export class MemoryCacheStore implements CacheStore {
  private store = new Map<string, Entry<unknown>>();
  private stats: CacheStats = { hits: 0, misses: 0, size: 0 };
  private maxEntries: number;
  // key/prefix -> when it was last invalidated. Checked by `set()` to reject
  // stale writes from reads that started before the invalidation.
  private fences = new Map<string, number>();

  constructor(maxEntries = 2000) {
    this.maxEntries = maxEntries;
  }

  private recordFence(prefixOrKey: string): void {
    // Fences remember an invalidation for FENCE_TTL_MS so a read that started
    // just before it (but resolves just after) can be detected in isFenced()
    // — comfortably longer than any realistic DB round-trip.
    const now = Date.now();
    this.fences.set(prefixOrKey, now);
    // Opportunistic cleanup so this map never grows unbounded.
    for (const [k, t] of this.fences) {
      if (now - t > FENCE_TTL_MS) this.fences.delete(k);
    }
  }

  /** True if `key` was invalidated (exactly, or via a prefix it starts with) at/after `since`. */
  private isFenced(key: string, since: number): boolean {
    for (const [prefixOrKey, invalidatedAt] of this.fences) {
      if (invalidatedAt < since) continue;
      if (key === prefixOrKey || key.startsWith(prefixOrKey)) return true;
    }
    return false;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.stats.misses++;
      return undefined;
    }
    // refresh recency for LRU: re-insert so it moves to the end of Map iteration order
    this.store.delete(key);
    this.store.set(key, entry);
    this.stats.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number, fetchStartedAt?: number): void {
    if (fetchStartedAt !== undefined && this.isFenced(key, fetchStartedAt)) {
      // A delete/invalidate for this key (or an ancestor prefix) happened
      // after this read started — the value we're about to cache is already
      // stale (e.g. a row that has since been deleted). Drop the write
      // instead of resurrecting it; the next read will miss and re-fetch
      // fresh data from the DB.
      return;
    }
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.stats.size = this.store.size;
  }

  delete(key: string): void {
    this.store.delete(key);
    this.recordFence(key);
    this.stats.size = this.store.size;
  }

  deletePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    this.recordFence(prefix);
    this.stats.size = this.store.size;
  }

  clear(): void {
    this.store.clear();
    this.stats.size = 0;
  }

  getStats(): CacheStats {
    return { ...this.stats, size: this.store.size };
  }
}
