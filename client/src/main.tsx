import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { createRoot } from "react-dom/client";
import App from "./App";
import { queryClient } from "@/lib/queryClient";
import { initWebVitals } from "@/lib/webVitals";
import "./index.css";
import "./styles/ui.css";

// Start collecting browser performance signals (LCP/CLS/TTFB/long tasks)
initWebVitals();

// Per-entity staleTime, mirrored from the old server's cache TTLs so views
// that were written against those timings keep the same refresh feel.
queryClient.setQueryDefaults(["transactions.list"], { staleTime: 30 * 1000 });
queryClient.setQueryDefaults(["budgets.list"], { staleTime: 60 * 1000 });
queryClient.setQueryDefaults(["goals.list"], { staleTime: 60 * 1000 });
queryClient.setQueryDefaults(["recurring.list"], { staleTime: 2 * 60 * 1000 });
queryClient.setQueryDefaults(["settings.get"], { staleTime: 5 * 60 * 1000 });
queryClient.setQueryDefaults(["security.status"], { staleTime: 60 * 1000 });

// Persist the query cache to localStorage so reopening the app (or a cold
// start on mobile) paints the last-known data immediately. All data already
// lives on-device, so this is purely cosmetic speedup — the local store is
// the source of truth and react-query revalidates from it right away.
const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  // -v4: the local-first build reads/writes its own store; old persisted
  // server snapshots (auth: excluded, rows with userId) are no longer valid.
  key: "moneyflow-query-cache-v4",
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000, // discard persisted cache after 24h untouched
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </QueryClientProvider>
);
