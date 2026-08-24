/**
 * Lightweight Web Vitals + performance monitor (no external deps).
 *
 * Collects browser-side performance signals using PerformanceObserver and
 * the Navigation Timing APIs:
 *  - TTFB / DOMContentLoaded / load  (navigation timing)
 *  - LCP  (largest-contentful-paint)
 *  - CLS  (layout-shift)
 *  - INP-ish input delay (first-input)
 *  - long tasks count + total blocking time
 *  - tRPC API call latency (fed from the httpBatchLink fetch wrapper)
 *
 * Exposes a subscribe/getSnapshot pair so views can render it live with
 * useSyncExternalStore, same pattern as syncMetrics.
 */

export interface WebVitalsSnapshot {
  /** Time to first byte (ms) */
  ttfb: number | null;
  /** DOMContentLoaded end (ms since navigation start) */
  domContentLoaded: number | null;
  /** window load event (ms since navigation start) */
  loadEvent: number | null;
  /** Largest Contentful Paint (ms) */
  lcp: number | null;
  /** Cumulative Layout Shift (unitless) */
  cls: number | null;
  /** First input delay / INP proxy (ms) */
  inputDelay: number | null;
  /** Number of long tasks (>50ms) observed */
  longTasks: number;
  /** Total time spent in long tasks (ms) */
  longTaskTotalMs: number;
  /** tRPC batch calls recorded */
  apiCount: number;
  /** Average tRPC latency over the recent window (ms) */
  apiAvgMs: number | null;
  /** Slowest recent tRPC call (ms) */
  apiMaxMs: number | null;
  /** Monotonic version — bumps whenever any metric updates */
  version: number;
}

const API_WINDOW = 50; // keep last N api call latencies

let snapshot: WebVitalsSnapshot = {
  ttfb: null,
  domContentLoaded: null,
  loadEvent: null,
  lcp: null,
  cls: null,
  inputDelay: null,
  longTasks: 0,
  longTaskTotalMs: 0,
  apiCount: 0,
  apiAvgMs: null,
  apiMaxMs: null,
  version: 0,
};

const listeners = new Set<() => void>();
const apiLatencies: number[] = [];

function update(patch: Partial<Omit<WebVitalsSnapshot, "version">>) {
  snapshot = { ...snapshot, ...patch, version: snapshot.version + 1 };
  listeners.forEach((l) => l());
}

function readNavigationTiming() {
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (!nav) return;
  update({
    ttfb: Math.round(nav.responseStart),
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
    loadEvent: Math.round(nav.loadEventEnd) || null, // 0 until load fires
  });
}

export function initWebVitals(): void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;

  // Navigation timing (read now and again after load completes)
  readNavigationTiming();
  if (document.readyState === "complete") {
    // re-read once more so loadEventEnd is final
    setTimeout(readNavigationTiming, 500);
  } else {
    window.addEventListener("load", () => setTimeout(readNavigationTiming, 500), { once: true });
  }

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry | undefined;
      if (last) update({ lcp: Math.round(last.startTime) });
    }).observe({ type: "largest-contentful-paint", buffered: true } as PerformanceObserverInit);
  } catch {
    /* unsupported browser */
  }

  try {
    let cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{ hadRecentInput?: boolean; value: number }>) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
      update({ cls: Math.round(cls * 1000) / 1000 });
    }).observe({ type: "layout-shift", buffered: true } as PerformanceObserverInit);
  } catch {
    /* unsupported browser */
  }

  // Measure input delay from event timing entries (INP proxy, widely supported).
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { processingStart?: number };
        if (e.processingStart != null && snapshot.inputDelay === null) {
          update({ inputDelay: Math.max(1, Math.round(e.processingStart - entry.startTime)) });
        }
      }
    }).observe({ type: "event", buffered: true } as PerformanceObserverInit);
  } catch {
    /* unsupported browser */
  }

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      update({
        longTasks: snapshot.longTasks + entries.length,
        longTaskTotalMs:
          Math.round(
            entries.reduce((a, e) => a + (e.duration - 50), 0) + snapshot.longTaskTotalMs,
          ),
      });
    }).observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
  } catch {
    /* unsupported browser */
  }
}

/** Record one completed API call. Called from the trpc fetch wrapper. */
export function trackApiLatency(ms: number): void {
  apiLatencies.push(Math.round(ms));
  if (apiLatencies.length > API_WINDOW) apiLatencies.shift();
  const avg = Math.round(apiLatencies.reduce((a, b) => a + b, 0) / apiLatencies.length);
  update({
    apiCount: snapshot.apiCount + 1,
    apiAvgMs: avg,
    apiMaxMs: Math.max(...apiLatencies),
  });
}

export function getWebVitalsSnapshot(): WebVitalsSnapshot {
  return snapshot;
}

export function subscribeWebVitals(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ---------- rating helpers (Google Core Web Vitals thresholds) ---------- */

export type VitalRating = "good" | "warn" | "poor";

export function rateLcp(ms: number | null): VitalRating {
  if (ms === null) return "good";
  return ms <= 2500 ? "good" : ms <= 4000 ? "warn" : "poor";
}
export function rateCls(v: number | null): VitalRating {
  if (v === null) return "good";
  return v <= 0.1 ? "good" : v <= 0.25 ? "warn" : "poor";
}
export function rateMs(ms: number | null, goodAt: number, warnAt: number): VitalRating {
  if (ms === null) return "good";
  return ms <= goodAt ? "good" : ms <= warnAt ? "warn" : "poor";
}

export const RATING_CLASS: Record<VitalRating, string> = {
  good: "text-emerald-500",
  warn: "text-amber-500",
  poor: "text-rose-500",
};
