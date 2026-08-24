/**
 * Skeleton primitives for progressive rendering.
 * Sizes mirror the real components they stand in for so swapping
 * skeleton → content does not cause visible layout shift.
 */
import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

/** Matches StatCard layout (p-2.5 sm:p-3.5, icon circle, big number, hint line). */
export function SkeletonStatCard() {
  return (
    <div
      aria-hidden
      className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-2.5 sm:p-3.5 shadow-sm min-w-0"
    >
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-3 w-14 sm:w-20" />
        <Skeleton className="h-6 w-6 sm:h-7 sm:w-7 shrink-0 rounded-full" />
      </div>
      <Skeleton className="mt-1 sm:mt-1.5 h-6 sm:h-7 w-24 max-w-full" />
      <Skeleton className="mt-1.5 h-2.5 w-16" />
    </div>
  );
}

/** Rows that approximate list items inside dashboard cards / list tabs. */
export function SkeletonRows({
  rows = 3,
  rowClass = "h-9",
}: {
  rows?: number;
  rowClass?: string;
}) {
  return (
    <div aria-hidden className="space-y-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("w-full", rowClass)} />
      ))}
    </div>
  );
}

/** Progress-bar placeholder used by budget/goal dashboard cards. */
export function SkeletonBars({ bars = 3 }: { bars?: number }) {
  return (
    <div aria-hidden className="space-y-3">
      {Array.from({ length: bars }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Per-section error box with retry — never takes over the whole page. */
export function LoadError({
  title = "โหลดข้อมูลไม่สำเร็จ",
  onRetry,
}: {
  title?: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/70 p-4 flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{title}</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        ลองใหม่
      </button>
    </div>
  );
}
