import { trpc } from "@/lib/trpc";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { getQueryKey } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { initWebVitals, trackApiLatency } from "@/lib/webVitals";
import "./index.css";

// Start collecting browser performance signals (LCP/CLS/TTFB/long tasks)
initWebVitals();

// ── Cache tuning ────────────────────────────────────────────────────────
// Default react-query behaviour treats data as stale the instant it lands,
// so switching screens (or the app resuming from background on mobile)
// re-fetches everything and shows loading spinners even though nothing
// changed. Data here only changes when *this* device writes to it (every
// mutation already calls utils.<x>.invalidate()), so a short staleTime is
// safe and removes almost all of those redundant refetches.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // fallback for anything without a per-entity override below
      gcTime: 24 * 60 * 60 * 1000, // keep unused data in memory up to 24h so tab-switching stays instant
      refetchOnWindowFocus: true, // still revalidate in the background when the app regains focus
      retry: 1,
    },
  },
});

// Per-entity staleTime, mirrored from the server's cache TTLs
// (server/_core/cache/index.ts CACHE_TTL) so the client doesn't treat data
// as fresh for longer than the server itself would keep serving it from
// cache — otherwise the client could sit on a stale value well past the
// point the server would have returned new data anyway.
queryClient.setQueryDefaults(getQueryKey(trpc.transactions.list), { staleTime: 30 * 1000 });
queryClient.setQueryDefaults(getQueryKey(trpc.budgets.list), { staleTime: 60 * 1000 });
queryClient.setQueryDefaults(getQueryKey(trpc.goals.list), { staleTime: 60 * 1000 });
queryClient.setQueryDefaults(getQueryKey(trpc.wishlist.list), { staleTime: 60 * 1000 });
queryClient.setQueryDefaults(getQueryKey(trpc.recurring.list), { staleTime: 2 * 60 * 1000 });
queryClient.setQueryDefaults(getQueryKey(trpc.settings.get), { staleTime: 5 * 60 * 1000 });

// Persist the query cache to localStorage so reopening the app (or a cold
// start on mobile) paints the last-known data immediately instead of a
// blank/loading screen, while react-query revalidates in the background.
const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  // Bumped to -v3: older builds could persist a stale "logged out" auth.me
  // result, which then bounced freshly-logged-in users back to /login.
  // Changing the key makes browsers that already have the bad snapshot
  // start clean instead of reading it back in.
  key: "moneyflow-query-cache-v3",
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        const startedAt = performance.now();
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        }).finally(() => {
          trackApiLatency(performance.now() - startedAt);
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000, // discard persisted cache after 24h untouched
        // Never persist transaction data while it's mid-flight or a settings
        // save hasn't confirmed yet — only cache queries that resolved cleanly.
        //
        // auth.me is excluded on purpose: it resolves to `null` (not an
        // error) for a logged-out user, so a "no user" result taken right
        // before a login gets written to localStorage as a successful query.
        // On the next page load (e.g. right after the Discord OAuth
        // redirect back to "/") that stale "logged out" snapshot gets
        // restored and shown before the fresh network check comes back,
        // which bounced people straight back to /login even though the
        // login itself had worked. Auth state must always come from the
        // network, never from the persisted cache.
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" &&
            !(Array.isArray(query.queryKey[0]) && query.queryKey[0][0] === "auth"),
        },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </trpc.Provider>
);
