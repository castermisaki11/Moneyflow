import { EventEmitter } from "events";
import { logSyncEvent } from "./syncLog";

/**
 * In-process pub/sub used to push "your data changed" signals to every
 * connected client (web tab / native app) for a given user, in real time.
 *
 * Why this exists: the web client caches reads (react-query staleTime) and
 * only re-validates on its own mutations, window focus, or TTL expiry. That
 * assumption breaks the moment data changes from *outside* the open tab —
 * e.g. the Telegram bot quick-adding a transaction — so the open web page
 * could sit on stale data for up to a minute. `emitUserEvent` is called
 * right alongside cache invalidation (see cache/index.ts) so any writer,
 * web or bot, notifies all of that user's live connections immediately.
 *
 * Single-process only, same caveat as the in-memory cache store: swap for a
 * Redis pub/sub channel if this ever runs multi-instance.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

// ── Stats for the admin metrics page (server/_core/systemRouter.ts) ────────
let activeConnections = 0;
let totalEventsEmitted = 0;
const emittedByEntity: Record<string, number> = {};

/** Call when an SSE connection opens; call the returned fn when it closes. */
export function registerConnection(): () => void {
  activeConnections++;
  return () => {
    activeConnections = Math.max(0, activeConnections - 1);
  };
}

export function getEventStats() {
  return {
    activeConnections,
    totalEventsEmitted,
    emittedByEntity: { ...emittedByEntity },
  };
}

function channel(userId: number): string {
  return `user:${userId}`;
}

/**
 * Notify every live connection for `userId` that `entity` changed server-side.
 *
 * Deliberately swallows any listener error instead of letting it propagate:
 * this runs as a side-effect right after a DB write already committed (see
 * cache/index.ts's invalidateUser, called from db.ts after every
 * create/update/delete). A dead SSE connection can throw synchronously from
 * inside res.write() — without this try/catch, that throw would bubble all
 * the way up through invalidateUser() and fail the *caller's* mutation
 * (e.g. deleteTransaction) even though the actual delete already succeeded,
 * making the client wrongly report "delete failed".
 */
export function emitUserEvent(userId: number, entity: string): void {
  const emittedAt = Date.now();
  totalEventsEmitted++;
  emittedByEntity[entity] = (emittedByEntity[entity] ?? 0) + 1;
  // Persist to DB too (see syncLog.ts) so the Metrics page can show a trend
  // over days, not just this process's in-memory counters above — those
  // reset to zero on every restart/deploy. Fire-and-forget, single instance
  // only (see file header) — this is a supplement to the in-memory stats,
  // not a replacement.
  logSyncEvent(entity, emittedAt);
  try {
    emitter.emit(channel(userId), entity);
  } catch (err) {
    console.warn("[events] listener threw while broadcasting, ignoring:", err);
  }
}

/** Subscribe to changes for `userId`. Returns an unsubscribe function. */
export function subscribeUser(userId: number, listener: (entity: string) => void): () => void {
  const ch = channel(userId);
  emitter.on(ch, listener);
  return () => emitter.off(ch, listener);
}
