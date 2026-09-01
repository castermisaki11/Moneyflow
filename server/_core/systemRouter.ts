import { z } from "zod";
import { getCacheStats } from "./cache";
import { getEventStats } from "./events";
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

  // Admin-only: hit/miss/size for the server-side cache layer
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

  // Admin-only: real-time sync (SSE) metrics
  syncStats: adminProcedure.query(() => {
    return getEventStats();
  }),

  // Admin-only: daily sync-event counts persisted in the DB
  syncTrend: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).default(14) }).optional())
    .query(({ input }) => getSyncTrend(input?.days ?? 14)),
});
