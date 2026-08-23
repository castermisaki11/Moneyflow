import { z } from "zod";
import { getCacheStats } from "./cache";
import { getEventStats } from "./events";
import { notifyOwner } from "./notification";
import { getSyncTrend } from "./syncLog";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  // Admin-only: hit/miss/size for the server-side cache layer
  // (server/_core/cache). Lets us confirm in production whether caching is
  // actually paying off before/after tuning TTLs, without needing log access.
  cacheStats: adminProcedure.query(() => {
    const stats = getCacheStats();
    return {
      available: stats !== null,
      hits: stats?.hits ?? 0,
      misses: stats?.misses ?? 0,
      size: stats?.size ?? 0,
      hitRate: stats && stats.hits + stats.misses > 0
        ? Math.round((stats.hits / (stats.hits + stats.misses)) * 1000) / 10
        : 0,
    };
  }),

  // Admin-only: real-time sync (SSE) metrics — active connections and event
  // counts by entity. Pairs with cacheStats to see the full picture: cache
  // shows read-side savings, this shows the push side keeping bot/web in sync.
  syncStats: adminProcedure.query(() => {
    return getEventStats();
  }),

  // Admin-only: daily sync-event counts persisted in the DB (server/_core/syncLog.ts),
  // so unlike syncStats above this survives restarts/deploys and shows a trend
  // over time instead of just "since the process last started".
  syncTrend: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).default(14) }).optional())
    .query(({ input }) => getSyncTrend(input?.days ?? 14)),
});
