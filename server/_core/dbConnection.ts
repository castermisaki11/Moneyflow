import { drizzle } from "drizzle-orm/node-postgres";

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Shared lazy DB connection — one instance for the whole process.
 * Lives in its own file (not db.ts) so lower-level modules that db.ts
 * itself depends on indirectly (server/_core/events.ts, via
 * cache/index.ts -> events.ts) can also read/write the DB — e.g. to log
 * sync events for the Metrics trend view — without creating an import
 * cycle back through db.ts.
 */
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
