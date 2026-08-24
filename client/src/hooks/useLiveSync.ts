import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "@/lib/trpc";
import { recordSyncEvent, setSyncConnectionState } from "@/lib/syncMetrics";

// entity name (matches server/_core/cache CACHE_TTL keys) -> query key to invalidate
const ENTITY_QUERY_KEYS: Record<string, () => unknown[]> = {
  transactions: () => getQueryKey(trpc.transactions.list),
  budgets: () => getQueryKey(trpc.budgets.list),
  goals: () => getQueryKey(trpc.goals.list),
  recurring: () => getQueryKey(trpc.recurring.list),
  settings: () => getQueryKey(trpc.settings.get),
};

/**
 * Keeps the open web app in sync the instant data changes elsewhere — most
 * notably when the Telegram bot adds/edits a transaction. Without this, the
 * page relies on react-query's staleTime/refetchOnWindowFocus and can sit on
 * stale data for up to a minute (or until you switch tabs) after a bot action.
 *
 * Opens an SSE connection to /api/events while `enabled` (i.e. logged in);
 * the server pushes a `sync` event with the changed entity name any time
 * cache/index.ts's invalidateUser runs for this user, from any source.
 *
 * Reconnection: native EventSource auto-retries on a dropped connection, but
 * that alone isn't enough here —
 *   - on repeated failures (e.g. an expired session hitting 401) it would
 *     retry every ~3s forever with no backoff, hammering the server, so we
 *     take over reconnection ourselves with exponential backoff (capped 30s)
 *   - some mobile browsers suspend/kill background-tab EventSource
 *     connections and don't reliably resume them on their own, so we force a
 *     fresh connection on `visibilitychange` (tab foregrounded) and `online`
 *     (network restored) if the existing one isn't actually open.
 */
export function useLiveSync(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let cancelled = false;

    const onSync = (event: MessageEvent) => {
      let entity: string | undefined;
      let emittedAt: number | undefined;
      try {
        const parsed = JSON.parse(event.data);
        entity = parsed?.entity;
        emittedAt = parsed?.emittedAt;
      } catch {
        return;
      }
      if (entity && typeof emittedAt === "number") {
        recordSyncEvent(entity, emittedAt);
      }
      const getKey = entity ? ENTITY_QUERY_KEYS[entity] : undefined;
      if (getKey) {
        queryClient.invalidateQueries({ queryKey: getKey() });
      }
    };

    function scheduleReconnect() {
      if (cancelled) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      attempt += 1;
      // exponential backoff (1s, 2s, 4s, ... capped 30s) + jitter so many tabs don't retry in lockstep
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) + Math.random() * 500;
      reconnectTimer = setTimeout(connect, delay);
    }

    function connect() {
      if (cancelled) return;
      setSyncConnectionState("connecting");

      source = new EventSource("/api/events", { withCredentials: true });

      source.onopen = () => {
        attempt = 0; // reset backoff once a connection actually succeeds
        setSyncConnectionState("open");
      };

      source.onerror = () => {
        setSyncConnectionState("closed");
        // ปิดของเดิมแล้วคุมการต่อใหม่เอง (พร้อม backoff) แทนที่จะปล่อยให้
        // EventSource retry รัวๆ ทุก 3 วิไม่จำกัด เช่นตอน session หมดอายุ
        source?.close();
        scheduleReconnect();
      };

      source.addEventListener("sync", onSync as EventListener);
    }

    connect();

    const forceReconnectIfDown = () => {
      if (source?.readyState !== EventSource.OPEN) {
        source?.close();
        attempt = 0;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        connect();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") forceReconnectIfDown();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", forceReconnectIfDown);

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", forceReconnectIfDown);
      source?.close();
      setSyncConnectionState("closed");
    };
  }, [enabled, queryClient]);
}
