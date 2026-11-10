/**
 * Shared QueryClient — built once at import so both the provider tree in
 * main.tsx and the local-data layer can use it (e.g. cross-tab invalidation).
 */
import { QueryClient } from "@tanstack/react-query";
import { bootLocalStore, onExternalWrite } from "./localdb";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // fallback for anything without a per-entity override below
      gcTime: 24 * 60 * 60 * 1000, // keep unused data in memory up to 24h so tab-switching stays instant
      refetchOnWindowFocus: true, // still revalidate in the background when the app regains focus
      retry: 1,
    },
  },
});

// Materialise any past-due recurring rows once at startup
bootLocalStore();

// Another tab wrote to the store (window "storage" event) → refresh views
onExternalWrite(() => {
  queryClient.invalidateQueries();
});
