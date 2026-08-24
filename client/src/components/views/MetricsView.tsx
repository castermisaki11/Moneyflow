import { trpc } from "@/lib/trpc";
import { useSyncExternalStore } from "react";
import { getSyncSnapshot, subscribeSyncMetrics } from "@/lib/syncMetrics";
import {
  RATING_CLASS,
  rateCls,
  rateLcp,
  rateMs,
  subscribeWebVitals,
  getWebVitalsSnapshot,
  type VitalRating,
  type WebVitalsSnapshot,
} from "@/lib/webVitals";
import { Activity, Database, Gauge, Loader2, RadioTower, Zap } from "lucide-react";
import { UsersView } from "@/components/views/UsersView";

/** Vital tile with rating color + threshold hint */
function VitalTile({
  label,
  value,
  rating,
  threshold,
}: {
  label: string;
  value: string;
  rating: VitalRating;
  threshold?: string;
}) {
  const dot =
    rating === "good"
      ? "bg-emerald-500"
      : rating === "warn"
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div className="rounded-xl border border-border/50 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-lg font-semibold leading-tight ${RATING_CLASS[rating]}`}>{value}</div>
      {threshold && (
        <div className="text-[10px] text-muted-foreground mt-0.5">เกณฑ์ดี ≤ {threshold}</div>
      )}
    </div>
  );
}

/** Browser-side performance monitoring — collected live in this tab */
function PerfCard({ vitals }: { vitals: WebVitalsSnapshot }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold">Performance — เบราว์เซอร์นี้</div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          Core Web Vitals
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        วัดจากการใช้งานจริงของแท็บนี้ (PerformanceObserver) — สีเขียว = อยู่ในเกณฑ์ดีตาม Google
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <VitalTile
          label="LCP (paint ใหญ่สุด)"
          value={vitals.lcp !== null ? fmtMs(vitals.lcp) : "—"}
          rating={rateLcp(vitals.lcp)}
          threshold="2.5 วิ"
        />
        <VitalTile
          label="CLS (layout shift)"
          value={vitals.cls !== null ? String(vitals.cls) : "—"}
          rating={rateCls(vitals.cls)}
          threshold="0.1"
        />
        <VitalTile
          label="Input delay (INP ~)"
          value={vitals.inputDelay !== null ? fmtMs(vitals.inputDelay) : "—"}
          rating={rateMs(vitals.inputDelay, 200, 500)}
          threshold="200 ms"
        />
        <VitalTile
          label="TTFB"
          value={vitals.ttfb !== null ? fmtMs(vitals.ttfb) : "—"}
          rating={rateMs(vitals.ttfb, 800, 1800)}
          threshold="800 ms"
        />
        <VitalTile
          label="API latency เฉลี่ย"
          value={vitals.apiAvgMs !== null ? fmtMs(vitals.apiAvgMs) : "—"}
          rating={rateMs(vitals.apiAvgMs, 300, 1000)}
          threshold="300 ms"
        />
        <VitalTile
          label="Long tasks (>50ms)"
          value={`${vitals.longTasks}`}
          rating={rateMs(vitals.longTasks, 5, 20)}
          threshold={"≤5 ครั้ง"}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard icon={<Zap className="w-4 h-4" />} label="API เรียกทั้งหมด" value={String(vitals.apiCount)} sub="ตั้งแต่เปิดแท็บ" />
        <StatCard icon={<Activity className="w-4 h-4" />} label="API ช้าสุด" value={vitals.apiMaxMs !== null ? fmtMs(vitals.apiMaxMs) : "—"} sub="ใน 50 ครั้งล่าสุด" />
        <StatCard icon={<Gauge className="w-4 h-4" />} label="DOMContentLoaded" value={vitals.domContentLoaded !== null ? fmtMs(vitals.domContentLoaded) : "—"} />
        <StatCard icon={<Activity className="w-4 h-4" />} label="Blocking time รวม" value={vitals.longTaskTotalMs > 0 ? fmtMs(vitals.longTaskTotalMs) : "—"} sub="ผลรวมเกิน 50ms/task" />
      </div>
    </div>
  );
}

const ENTITY_LABEL: Record<string, string> = {
  transactions: "รายการ",
  budgets: "งบ",
  goals: "เป้าหมาย",
  recurring: "รายการประจำ",
  settings: "ตั้งค่า",
};

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/40 p-3 flex items-start gap-2.5">
      <div className="mt-0.5 text-primary">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold leading-tight">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} วินาที`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("th-TH", { hour12: false });
}

export function MetricsView() {
  // ดึงค่าใหม่ทุก 5 วิ ให้เหมือน dashboard วัดผลแบบสด ๆ โดยไม่ต้องกด refresh เอง
  const cacheStats = trpc.system.cacheStats.useQuery(undefined, { refetchInterval: 5000 });
  const vitals = useSyncExternalStore(subscribeWebVitals, getWebVitalsSnapshot) as WebVitalsSnapshot;
  const syncStats = trpc.system.syncStats.useQuery(undefined, { refetchInterval: 5000 });
  // Persisted trend (survives restarts/deploys) — refetch less often than the
  // live counters above, a few-minute-old trend chart is plenty fresh.
  const syncTrend = trpc.system.syncTrend.useQuery({ days: 14 }, { refetchInterval: 60_000 });
  const liveSync = useSyncExternalStore(subscribeSyncMetrics, getSyncSnapshot);

  const trendByDay = new Map<string, number>();
  for (const p of syncTrend.data ?? []) {
    trendByDay.set(p.day, (trendByDay.get(p.day) ?? 0) + p.count);
  }
  const trendDays = [...trendByDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const trendMax = Math.max(1, ...trendDays.map(([, c]) => c));

  function fmtDay(d: string): string {
    return new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  }

  const latencies = liveSync.history.map((h) => h.latencyMs);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  const lastLatency = latencies[0] ?? null;

  const connectionLabel =
    liveSync.connectionState === "open"
      ? "เชื่อมต่ออยู่"
      : liveSync.connectionState === "connecting"
      ? "กำลังเชื่อมต่อ..."
      : "หลุดการเชื่อมต่อ (กำลังลองใหม่)";

  const connectionColor =
    liveSync.connectionState === "open"
      ? "bg-emerald-500/15 text-emerald-500"
      : liveSync.connectionState === "connecting"
      ? "bg-amber-500/15 text-amber-500"
      : "bg-red-500/15 text-red-500";

  return (
    <div className="space-y-4">
      {/* Browser performance — Web Vitals + API latency (เครื่องนี้) */}
      <PerfCard vitals={vitals} />

      {/* Real-time sync (SSE) — ฝั่งนี้ */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RadioTower className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold">Real-time sync — เครื่องนี้</div>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${connectionColor}`}>
            {connectionLabel}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          วัดเวลาตั้งแต่ server ยิง event (เช่น Bot เพิ่มรายการ) จนถึงตอนแท็บนี้ได้รับ — ยิ่งน้อยยิ่งดี
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatCard
            icon={<Zap className="w-4 h-4" />}
            label="latency ล่าสุด"
            value={lastLatency !== null ? fmtMs(lastLatency) : "—"}
          />
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label={`ค่าเฉลี่ย (${latencies.length} ครั้งล่าสุด)`}
            value={avgLatency !== null ? fmtMs(avgLatency) : "—"}
          />
        </div>

        {liveSync.history.length > 0 && (
          <div className="overflow-auto rounded-lg border border-border/50 max-h-56">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 text-left">เวลาที่ได้รับ</th>
                  <th className="p-2 text-left">ข้อมูลที่เปลี่ยน</th>
                  <th className="p-2 text-right">latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {liveSync.history.map((h, i) => (
                  <tr key={`${h.receivedAt}-${i}`} className="hover:bg-muted/20">
                    <td className="p-2 whitespace-nowrap">{fmtTime(h.receivedAt)}</td>
                    <td className="p-2 text-muted-foreground">{ENTITY_LABEL[h.entity] ?? h.entity}</td>
                    <td className="p-2 text-right font-medium">{fmtMs(h.latencyMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {liveSync.history.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">
            ยังไม่มี event เข้ามา — ลองเพิ่ม/แก้รายการจากอีกแท็บ หรือผ่าน Telegram bot แล้วดูตรงนี้
          </p>
        )}
      </div>

      {/* Server-side: active connections + events emitted */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center gap-2">
          <RadioTower className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold">Real-time sync — ทั้งระบบ (server)</div>
        </div>

        {syncStats.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด...
          </div>
        ) : syncStats.isError ? (
          <p className="text-sm text-red-400">โหลดไม่สำเร็จ — ต้องเป็นผู้ดูแลระบบเท่านั้น</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard
                icon={<RadioTower className="w-4 h-4" />}
                label="Connection ที่เปิดอยู่ตอนนี้"
                value={String(syncStats.data?.activeConnections ?? 0)}
                sub="รวมทุก user/ทุกแท็บ/แอป"
              />
              <StatCard
                icon={<Zap className="w-4 h-4" />}
                label="Event ที่ยิงไปทั้งหมด"
                value={String(syncStats.data?.totalEventsEmitted ?? 0)}
                sub="ตั้งแต่ server เริ่มทำงานล่าสุด"
              />
            </div>

            {syncStats.data && Object.keys(syncStats.data.emittedByEntity).length > 0 && (
              <div className="rounded-lg border border-border/50 p-2.5">
                <div className="text-[11px] text-muted-foreground mb-1.5">แยกตามประเภทข้อมูล (นับตั้งแต่ server เริ่มทำงาน)</div>
                <div className="space-y-1">
                  {Object.entries(syncStats.data.emittedByEntity)
                    .sort((a, b) => b[1] - a[1])
                    .map(([entity, count]) => (
                      <div key={entity} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{ENTITY_LABEL[entity] ?? entity}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Persisted trend — survives restarts/deploys, unlike the counters above */}
            <div className="rounded-lg border border-border/50 p-2.5 space-y-1.5">
              <div className="text-[11px] text-muted-foreground">
                แนวโน้ม 14 วันล่าสุด (เก็บลง DB — ดูย้อนหลังได้แม้ deploy ใหม่)
              </div>
              {syncTrend.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลด...
                </div>
              ) : trendDays.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">ยังไม่มีข้อมูลย้อนหลัง</p>
              ) : (
                <div className="space-y-1">
                  {trendDays.map(([day, count]) => (
                    <div key={day} className="flex items-center gap-2 text-[11px]">
                      <span className="w-12 shrink-0 text-muted-foreground">{fmtDay(day)}</span>
                      <div className="flex-1 h-3 rounded bg-muted/40 overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded"
                          style={{ width: `${Math.max(4, (count / trendMax) * 100)}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Cache */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold">Server cache</div>
        </div>

        {cacheStats.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด...
          </div>
        ) : cacheStats.isError || !cacheStats.data?.available ? (
          <p className="text-sm text-red-400">
            {cacheStats.isError ? "โหลดไม่สำเร็จ — ต้องเป็นผู้ดูแลระบบเท่านั้น" : "cache backend ไม่รองรับการรายงานสถิติ"}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <StatCard icon={<Zap className="w-4 h-4" />} label="Hit rate" value={`${cacheStats.data.hitRate}%`} />
            <StatCard icon={<Activity className="w-4 h-4" />} label="Hits" value={String(cacheStats.data.hits)} />
            <StatCard icon={<Activity className="w-4 h-4" />} label="Misses" value={String(cacheStats.data.misses)} />
            <StatCard icon={<Database className="w-4 h-4" />} label="Entries ในแคช" value={String(cacheStats.data.size)} />
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Hit rate สูง = คำขออ่านข้อมูลส่วนใหญ่ตอบจาก memory โดยไม่ต้องแตะฐานข้อมูล
        </p>
      </div>

      {/* User management (รวมจากหน้า "ผู้ใช้" เดิม) */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold">บัญชีผู้ใช้ทั้งหมด</div>
        </div>
        <UsersView />
      </div>
    </div>
  );
}
