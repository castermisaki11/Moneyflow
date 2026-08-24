import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  Send,
  Sparkles,
  TimerReset,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

const RECURRENCE_LABEL: Record<string, string> = {
  once: "ครั้งเดียว",
  daily: "ทุกวัน",
  weekly: "ทุกสัปดาห์",
  monthly: "ทุกเดือน",
};

/** "2 วัน 4 ชม." / "5 นาที 12 วิ" / "ครบกำหนดแล้ว" — recomputed every tick from `now`. */
function fmtCountdown(nextAt: number, now: number): string {
  const diff = nextAt - now;
  if (diff <= 0) return "ครบกำหนดแล้ว";
  const s = Math.floor(diff / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days} วัน ${hours} ชม.`;
  if (hours > 0) return `${hours} ชม. ${mins} นาที`;
  if (mins > 0) return `${mins} นาที ${secs} วิ`;
  return `${secs} วินาที`;
}

/** "12 วินาทีที่แล้ว" / "5 นาทีที่แล้ว" — recomputed every tick from `now`. */
function fmtAgo(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} วินาทีที่แล้ว`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  return `${hours} ชม.ที่แล้ว`;
}

function StatCard({
  icon,
  label,
  value,
  sub,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="rounded-xl border border-border/50 bg-background/40 p-3 flex items-start gap-2.5"
    >
      <div className="mt-0.5 text-primary">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold leading-tight tabular-nums">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </motion.div>
  );
}

export function BotView() {
  const overview = trpc.bot.overview.useQuery(undefined, { refetchInterval: 15000 });

  const [broadcastText, setBroadcastText] = useState("");
  const [confirmArmed, setConfirmArmed] = useState(false);
  const broadcast = trpc.bot.broadcast.useMutation({
    onSuccess: (res) => {
      setConfirmArmed(false);
      if (!res.configured) {
        toast.error("บอทยังไม่ได้ตั้งค่า ส่งไม่ได้");
        return;
      }
      if (res.total === 0) {
        toast.error("ยังไม่มีใครเชื่อม Telegram เลย");
        return;
      }
      setBroadcastText("");
      overview.refetch();
      if (res.failed === 0) {
        toast.success(`ส่งถึง ${res.sent} คนสำเร็จทั้งหมด`);
      } else {
        toast.warning(`ส่งสำเร็จ ${res.sent}/${res.total} คน (ล้มเหลว ${res.failed})`);
      }
    },
    onError: (err) => {
      setConfirmArmed(false);
      toast.error(err.message || "ส่งข้อความไม่สำเร็จ");
    },
  });

  // Local clock, ticks every second so countdown chips update live without
  // re-fetching from the server (the server data itself only needs to be
  // fresh every ~15s — the countdown math just needs "now").
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (overview.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> กำลังโหลด...
      </div>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card text-sm text-red-400">
        โหลดข้อมูล Bot ไม่สำเร็จ — ต้องเป็นผู้ดูแลระบบเท่านั้น
      </div>
    );
  }

  const d = overview.data;
  const linkedPct = d.totalUsers > 0 ? Math.round((d.linkedUsers / d.totalUsers) * 100) : 0;
  const soonest = d.upcomingReminders[0];

  // Feature adoption among linked users — powers the "วัดผล" bars below.
  const usagePct = (n: number) => (d.linkedUsers > 0 ? Math.round((n / d.linkedUsers) * 100) : 0);
  const usageBreakdown = [
    { label: "เตือนประจำวัน", count: d.dailyReminderOn, pct: usagePct(d.dailyReminderOn) },
    { label: "สรุปรายสัปดาห์", count: d.weeklySummaryOn, pct: usagePct(d.weeklySummaryOn) },
    { label: "แจ้งงบคงเหลือรายวัน", count: d.dailyPacingOn, pct: usagePct(d.dailyPacingOn) },
  ];

  return (
    <div className="space-y-4">
      {/* Bot connection status */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              animate={d.configured ? { scale: [1, 1.12, 1] } : {}}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              className={`w-9 h-9 rounded-full flex items-center justify-center ${
                d.configured ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"
              }`}
            >
              <Bot className="w-5 h-5" />
            </motion.div>
            <div>
              <div className="text-sm font-semibold">Telegram Bot</div>
              <div className="text-xs text-muted-foreground">
                {d.configured ? d.botUsername ? `@${d.botUsername}` : "เชื่อมต่อแล้ว" : "ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN"}
              </div>
            </div>
          </div>
          <span
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
              d.configured ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-400"
            }`}
          >
            <span className="relative flex h-2 w-2">
              {d.configured && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${d.configured ? "bg-emerald-500" : "bg-red-400"}`} />
            </span>
            {d.configured ? "ออนไลน์" : "ออฟไลน์"}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatCard icon={<Users className="w-4 h-4" />} label="ผู้ใช้ทั้งหมด" value={String(d.totalUsers)} delay={0} />
          <StatCard
            icon={<Bot className="w-4 h-4" />}
            label="เชื่อม Telegram แล้ว"
            value={String(d.linkedUsers)}
            sub={`${linkedPct}% ของผู้ใช้ทั้งหมด`}
            delay={0.05}
          />
          <StatCard
            icon={<TimerReset className="w-4 h-4" />}
            label="เตือนความจำที่ตั้งไว้"
            value={String(d.activeCustomReminders)}
            sub="กำลังรอเวลาแจ้งเตือน"
            delay={0.1}
          />
          <StatCard
            icon={<CheckCircle2 className="w-4 h-4" />}
            label="ยอดกดเสร็จแล้วสะสม"
            value={String(d.reminderCompletions.total)}
            sub={`${d.reminderCompletions.last7Days} ครั้งใน 7 วันล่าสุด`}
            delay={0.15}
          />
        </div>
      </div>

      {/* Scheduler status — is the periodic-check loop alive, when did it last run */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              animate={d.scheduler.internalTimerRunning ? { rotate: 360 } : {}}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            >
              <Activity className="w-4 h-4 text-primary" />
            </motion.div>
            <div className="text-sm font-semibold">สถานะ Scheduler</div>
          </div>
          <span
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
              d.scheduler.internalTimerRunning ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"
            }`}
          >
            <span className="relative flex h-2 w-2">
              {d.scheduler.internalTimerRunning && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  d.scheduler.internalTimerRunning ? "bg-emerald-500" : "bg-muted-foreground"
                }`}
              />
            </span>
            {d.scheduler.internalTimerRunning ? "กำลังทำงาน" : "ไม่ได้ทำงาน"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <StatCard
            icon={<Clock className="w-4 h-4" />}
            label="เช็คล่าสุด"
            value={d.scheduler.lastRunAt ? fmtAgo(d.scheduler.lastRunAt, now) : "ยังไม่เคยรัน"}
            sub={d.scheduler.lastRunAt ? fmtDateTime(d.scheduler.lastRunAt) : undefined}
          />
          <StatCard
            icon={<TimerReset className="w-4 h-4" />}
            label="เช็คถัดไปในอีก"
            value={d.scheduler.nextScheduledTickAt ? fmtCountdown(d.scheduler.nextScheduledTickAt, now) : "—"}
            sub={d.scheduler.lastRunDurationMs !== null ? `ครั้งล่าสุดใช้เวลา ${d.scheduler.lastRunDurationMs} ms` : undefined}
            delay={0.05}
          />
        </div>

        {d.scheduler.lastRunError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-2.5 py-2 text-[11px] text-red-300">
            เช็คล่าสุดล้มเหลว: {d.scheduler.lastRunError}
          </div>
        )}

        {!d.scheduler.internalTimerRunning && d.configured && (
          <p className="text-[11px] text-muted-foreground">
            ตัวจับเวลาในเซิร์ฟเวอร์ไม่ได้ทำงาน — อาจใช้ external cron endpoint (/api/cron/check-notifications) แทนบนโฮสต์ที่ปิดพัก
            process เมื่อไม่มีคนเข้า
          </p>
        )}

        {/* Custom scheduler settings — master switch + check frequency */}
        <SchedulerSettingsCard config={d.schedulerConfig} />
      </div>

      {/* Broadcast — send one message to every linked user */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold">ส่งข้อความถึงทุกคนที่เชื่อม Telegram</div>
          </div>
          <span className="text-[11px] text-muted-foreground">ผู้รับ {d.linkedUsers} คน</span>
        </div>

        <Textarea
          value={broadcastText}
          onChange={(e) => {
            setBroadcastText(e.target.value);
            setConfirmArmed(false);
          }}
          placeholder="พิมพ์ข้อความประกาศที่จะส่งถึงผู้ใช้ทุกคน..."
          rows={3}
          maxLength={4000}
          disabled={!d.configured}
          className="resize-none text-sm"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{broadcastText.length}/4000</span>
          <Button
            size="sm"
            disabled={!d.configured || d.linkedUsers === 0 || !broadcastText.trim() || broadcast.isPending}
            onClick={() => {
              if (!confirmArmed) {
                setConfirmArmed(true);
                return;
              }
              broadcast.mutate({ text: broadcastText.trim() });
            }}
            className={confirmArmed ? "bg-amber-600 hover:bg-amber-600/90" : undefined}
          >
            {broadcast.isPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5 mr-1.5" />
            )}
            {confirmArmed ? `ยืนยันส่งถึง ${d.linkedUsers} คน?` : "ส่งข้อความ"}
          </Button>
        </div>
      </div>

      {/* Broadcast history — past admin broadcasts */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold">ประวัติการส่งข้อความ</div>
        </div>

        {d.broadcastHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">ยังไม่เคยส่งข้อความประกาศเลย</p>
        ) : (
          <div className="space-y-1.5">
            {d.broadcastHistory.map((b, i) => (
              <motion.div
                key={`${b.createdAt}-${i}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="rounded-lg border border-border/50 px-2.5 py-2 text-xs space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 whitespace-pre-wrap break-words">{b.text}</p>
                  <span className="shrink-0 text-muted-foreground whitespace-nowrap">{fmtDateTime(b.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
                  <span>โดย {b.adminName || "(ไม่มีชื่อ)"}</span>
                  <span>·</span>
                  <span className={b.failedCount > 0 ? "text-amber-500" : "text-emerald-500"}>
                    สำเร็จ {b.sentCount}/{b.targetCount}
                    {b.failedCount > 0 ? ` (ล้มเหลว ${b.failedCount})` : ""}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Countdown — soonest upcoming reminders across every user */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold">นับถอยหลังการแจ้งเตือน</div>
        </div>

        {soonest && (
          <motion.div
            key={soonest.userId + soonest.text + soonest.nextAt}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl border border-primary/30 bg-primary/5 p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-muted-foreground mb-0.5">เตือนถัดไปที่ใกล้ที่สุด</div>
                <div className="text-sm font-medium truncate">{soonest.text}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {soonest.userName || "(ไม่มีชื่อ)"} · {RECURRENCE_LABEL[soonest.recurrence] ?? soonest.recurrence}
                </div>
              </div>
              <motion.div
                key={fmtCountdown(soonest.nextAt, now)}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: 1 }}
                className="shrink-0 text-right"
              >
                <div className="text-lg font-bold tabular-nums text-primary">{fmtCountdown(soonest.nextAt, now)}</div>
                <div className="text-[10px] text-muted-foreground">{fmtDateTime(soonest.nextAt)}</div>
              </motion.div>
            </div>
          </motion.div>
        )}

        <div className="space-y-1.5">
          <AnimatePresence initial={false}>
            {d.upcomingReminders.slice(1).map((r) => (
              <motion.div
                key={`${r.userId}-${r.text}-${r.nextAt}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-2.5 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate">{r.text}</div>
                  <div className="text-muted-foreground text-[10.5px]">{r.userName || "(ไม่มีชื่อ)"}</div>
                </div>
                <div className="shrink-0 font-medium tabular-nums">{fmtCountdown(r.nextAt, now)}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {d.upcomingReminders.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">ยังไม่มีใครตั้งเตือนความจำผ่านบอทเลย</p>
        )}
      </div>

      {/* วัดผล — feature adoption among linked users */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold">การใช้งานฟีเจอร์แจ้งเตือน (ในผู้ใช้ที่เชื่อม Telegram แล้ว)</div>
        </div>

        {d.linkedUsers === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">ยังไม่มีใครเชื่อม Telegram เลย</p>
        ) : (
          <div className="space-y-2">
            {usageBreakdown.map((u, i) => (
              <div key={u.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{u.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {u.count}/{d.linkedUsers} ({u.pct}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${u.pct}%` }}
                    transition={{ duration: 0.6, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full rounded-full bg-primary"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent reminder completions */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold">เตือนที่กด "เสร็จแล้ว" ล่าสุด</div>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {d.reminderCompletions.last7Days} ครั้งใน 7 วัน · {d.reminderCompletions.total} ครั้งทั้งหมด
          </span>
        </div>

        {d.reminderCompletions.recent.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">ยังไม่มีใครกด "เสร็จแล้ว" เลย</p>
        ) : (
          <div className="space-y-1.5">
            {d.reminderCompletions.recent.map((r, i) => (
              <motion.div
                key={`${r.completedAt}-${i}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-2.5 py-2 text-xs"
              >
                <div className="min-w-0 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate">{r.text}</div>
                    <div className="text-muted-foreground text-[10.5px]">{r.userName || "(ไม่มีชื่อ)"}</div>
                  </div>
                </div>
                <div className="shrink-0 text-muted-foreground whitespace-nowrap">{fmtDateTime(r.completedAt)}</div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {!d.configured && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-2.5 text-xs text-red-300">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            ยังไม่ได้ตั้งค่า <code className="bg-muted px-1 rounded">TELEGRAM_BOT_TOKEN</code> บนเซิร์ฟเวอร์ —
            ผู้ใช้จะเชื่อมบอทหรือรับการแจ้งเตือนไม่ได้จนกว่าจะตั้งค่า
          </span>
        </div>
      )}
    </div>
  );
}


/* ----------------- Scheduler settings (admin-tunable) ----------------- */

const INTERVAL_PRESETS = [
  { label: "30 วิ", seconds: 30 },
  { label: "1 นาที", seconds: 60 },
  { label: "5 นาที", seconds: 300 },
  { label: "15 นาที", seconds: 900 },
  { label: "1 ชม.", seconds: 3600 },
];

function fmtSeconds(total: number): string {
  if (total < 60) return `${total} วินาที`;
  if (total % 3600 === 0) return `${total / 3600} ชั่วโมง`;
  if (total % 60 === 0) return `${total / 60} นาที`;
  return `${Math.floor(total / 60)} นาที ${total % 60} วิ`;
}

function SchedulerSettingsCard({
  config,
}: {
  config: { enabled: boolean; intervalMs: number };
}) {
  const utils = trpc.useUtils();
  const [enabled, setEnabled] = useState(config.enabled);
  const [seconds, setSeconds] = useState(Math.round(config.intervalMs / 1000));

  useEffect(() => {
    setEnabled(config.enabled);
    setSeconds(Math.round(config.intervalMs / 1000));
  }, [config.enabled, config.intervalMs]);

  const initialSeconds = Math.round(config.intervalMs / 1000);
  const dirty = enabled !== config.enabled || seconds !== initialSeconds;
  const valid = Number.isFinite(seconds) && seconds >= 10 && seconds <= 86400;

  const save = trpc.bot.updateSchedulerConfig.useMutation({
    onSuccess: (res) => {
      utils.bot.overview.invalidate();
      toast.success("บันทึกการตั้งค่า Scheduler แล้ว");
      setEnabled(res.schedulerConfig.enabled);
      setSeconds(Math.round(res.schedulerConfig.intervalMs / 1000));
    },
    onError: (err) => toast.error(err.message || "บันทึกไม่สำเร็จ"),
  });

  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium">ตั้งค่า Scheduler</div>
          <div className="text-[10px] text-muted-foreground">ใช้กับแจ้งเตือนอัตโนมัติของทุก user — มีผลทันทีไม่ต้อง restart</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{enabled ? "เปิด" : "ปิด"}</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium">ความถี่เช็ค (custom ได้)</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {INTERVAL_PRESETS.map((preset) => (
            <button
              key={preset.seconds}
              type="button"
              onClick={() => setSeconds(preset.seconds)}
              className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${
                seconds === preset.seconds
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={10}
            max={86400}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
            className="h-8 w-28 text-sm"
          />
          <span className="text-xs text-muted-foreground">วินาที ({seconds >= 10 && seconds <= 86400 ? `\u2248 ${fmtSeconds(seconds)}` : "10\u0E27\u0E34–24\u0E0A\u0E21."})</span>
        </div>
        {!valid && (
          <p className="text-[11px] text-red-400">ความถี่ต้องอยู่ระหว่าง 10 วินาที – 24 ชั่วโมง</p>
        )}
      </div>

      <Button size="sm" disabled={!dirty || !valid || save.isPending} onClick={() => save.mutate({ enabled, intervalSeconds: seconds })}>
        {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
        บันทึกการตั้งค่า
      </Button>
    </div>
  );
}
