import { sql } from "drizzle-orm";
import { syncEventLog } from "../../drizzle/schema";
import { getDb } from "./dbConnection";

// How long history to keep. This app runs a single Render instance and
// low personal-scale event volume, so a flat 30-day retention (rather than
// e.g. downsampling into hourly buckets) keeps this simple and the table
// small enough to never need its own cleanup job.
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Record one sync event to the DB so it survives restarts/deploys (unlike
 * the in-memory counters in events.ts, which reset every time the process
 * restarts). Called alongside emitUserEvent — see events.ts.
 *
 * Fire-and-forget: never let a logging failure affect the caller, since
 * this runs as a side-effect of every data mutation (see cache/index.ts's
 * invalidateUser). Also prunes old rows occasionally (~1% of calls) instead
 * of running a dedicated cron — cheap and keeps the table bounded without
 * adding another scheduled job.
 */
export function logSyncEvent(entity: string, emittedAt: number): void {
  void (async () => {
    try {
      const db = await getDb();
      if (!db) return;
      await db.insert(syncEventLog).values({ entity, emittedAt: new Date(emittedAt) });
      if (Math.random() < 0.01) await pruneSyncLog();
    } catch (err) {
      console.warn("[syncLog] failed to record event, ignoring:", err);
    }
  })();
}

async function pruneSyncLog(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const cutoff = new Date(Date.now() - RETENTION_MS);
  await db.execute(sql`DELETE FROM "sync_event_log" WHERE "emittedAt" < ${cutoff}`);
}

export type SyncTrendPoint = {
  day: string; // YYYY-MM-DD (server-local date)
  entity: string;
  count: number;
};

/**
 * Daily event counts per entity for the last `days` days — powers the
 * trend view on the admin Metrics page ("today vs last week", etc).
 */
export async function getSyncTrend(days: number = 14): Promise<SyncTrendPoint[]> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.execute<{ day: string; entity: string; count: number }>(sql`
    SELECT to_char(date_trunc('day', "emittedAt"), 'YYYY-MM-DD') AS day,
           "entity" AS entity,
           count(*)::int AS count
    FROM "sync_event_log"
    WHERE "emittedAt" >= ${since}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `);
  return rows.rows.map((r) => ({ day: r.day, entity: r.entity, count: Number(r.count) }));
}
