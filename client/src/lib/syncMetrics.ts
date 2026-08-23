// Tiny observable store (no external state lib needed) that useLiveSync
// writes into on every SSE event/connection-state change, and MetricsView
// reads via useSyncExternalStore. Lives outside React so it survives across
// remounts of whatever component happens to render the SSE connection.

export type SyncConnectionState = "connecting" | "open" | "closed";

export type SyncMetricEvent = {
  entity: string;
  emittedAt: number; // server clock, when invalidateUser fired
  receivedAt: number; // client clock, when the SSE message arrived
  latencyMs: number; // receivedAt - emittedAt (server+client clocks assumed close enough)
};

const MAX_HISTORY = 30;

let history: SyncMetricEvent[] = [];
let connectionState: SyncConnectionState = "connecting";
let connectedAt: number | null = null;
let snapshot = buildSnapshot();

function buildSnapshot() {
  return { history, connectionState, connectedAt };
}

const listeners = new Set<() => void>();
function notify() {
  snapshot = buildSnapshot();
  for (const l of listeners) l();
}

export function recordSyncEvent(entity: string, emittedAt: number) {
  const receivedAt = Date.now();
  const latencyMs = Math.max(0, receivedAt - emittedAt);
  history = [{ entity, emittedAt, receivedAt, latencyMs }, ...history].slice(0, MAX_HISTORY);
  notify();
}

export function setSyncConnectionState(state: SyncConnectionState) {
  connectionState = state;
  connectedAt = state === "open" ? Date.now() : null;
  notify();
}

export function getSyncSnapshot() {
  return snapshot;
}

export function subscribeSyncMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
