import TxFormDialog from "@/components/TxFormDialog";
import { MonthlyReportView } from "@/components/views/MonthlyReportView";
import { DataView } from "@/components/views/DataView";
import { SettingsView } from "@/components/views/SettingsView";
import { AccountView } from "@/components/views/AccountView";
import { MetricsView } from "@/components/views/MetricsView";

import { Button } from "@/components/ui/button";
import {
  LoadError,
  SkeletonBars,
  SkeletonRows,
  SkeletonStatCard,
} from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/contexts/ThemeContext";
import { ThemeMenu } from "@/components/ThemeMenu";
import {
  CATEGORIES,
  CURRENCIES,
  Freq,
  Period,
  Priority,
  TYPE_LABEL,
  TxType,
  dateInputToTs,
  endOfMonthTs,
  endOfDayTs,
  endOfWeekTs,
  endOfYearTs,
  formatCurrency,
  isSameDay,
  isSameMonth,
  isSameWeek,
  startOfDayTs,
  startOfMonthTs,
  startOfWeekTs,
  startOfYearTs,
  toNumber,
  tsToDateInput,
} from "@/lib/money";
import { trpc } from "@/lib/trpc";

import {
  Activity,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Circle,
  Coins,
  Database,
  Download,
  FileBarChart,
  ListChecks,
  Loader2,
  Paperclip,
  Pencil,
  CircleUserRound,
  Plus,
  Repeat,
  Search,
  Settings,
  Sun,
  Target,
  Trash2,
  Upload,
  Wallet,
  X,
  TrendingUp,
  TrendingDown,
  PiggyBank,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { useAnimatedPct } from "@/hooks/useAnimatedPct";
import { AnimatedCurrency } from "@/components/shared/AnimatedCurrency";
import "@/styles/moneyflow.css";

/**
 * Shared by every entity's delete mutation's onError handler (transactions,
 * budgets, goals, recurring — all follow the same optimistic
 * delete pattern below).
 *
 * Why this exists: with tRPC's httpBatchLink, a delete can fail on the
 * client (network drop, tab backgrounded mid-request, flaky mobile data)
 * *after* the server already committed it — the response never made it
 * back, but the row is genuinely gone. A single re-check right after that
 * error often hits the same still-recovering connection and also fails,
 * which used to make the code give up and tell the user the delete failed
 * — even though it had actually succeeded a moment earlier. The row would
 * then quietly disappear later (once background revalidation caught up),
 * with no toast explaining why, which is confusing on its own.
 *
 * Retrying the verification a few times with backoff gives that transient
 * hiccup a real chance to clear before we conclude anything. A definitive
 * "still there" answer from the server is trusted immediately (not
 * retried) since retrying doesn't help when the delete genuinely failed —
 * only when the *network*, not the server, was the problem.
 */
async function verifyDeleteSucceeded<T extends { id: number }>(
  fetchFreshList: () => Promise<T[] | undefined>,
  id: number,
): Promise<{ succeeded: boolean; fresh?: T[] }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700 * attempt));
    try {
      const fresh = await fetchFreshList();
      const stillThere = fresh?.some((row) => row.id === id);
      // Definitive answer either way — stop here, don't retry.
      return { succeeded: !stillThere, fresh };
    } catch {
      // Couldn't reach the server at all — retry unless out of attempts.
    }
  }
  return { succeeded: false }; // never got a definitive answer
}

type Tab =
  | "dashboard"
  | "transactions"
  | "budgets"
  | "recurring"
  | "report"
  | "data"
  | "settings"
  | "account"
  | "metrics";

export default function MoneyFlowPage() {
  // Register service worker for PWA
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() => {});
    }
  }, []);

  return <MoneyFlowApp />;
}

/** Hook: merges default CATEGORIES with user's custom categories from settings */
function useMergedCategories(): typeof CATEGORIES {
  const settings = trpc.settings.get.useQuery();
  return useMemo<typeof CATEGORIES>(() => {
    const raw = settings.data?.customCategories;
    if (!raw) return CATEGORIES;
    try {
      const custom = JSON.parse(raw) as Partial<typeof CATEGORIES>;
      return {
        income: [...CATEGORIES.income, ...(custom.income || [])],
        expense: [...CATEGORIES.expense, ...(custom.expense || [])],
        saving: [...CATEGORIES.saving, ...(custom.saving || [])],
      };
    } catch {
      return CATEGORIES;
    }
  }, [settings.data?.customCategories]);
}

/**
 * Smooth list updates: keeps the ids currently playing their exit animation.
 * `animateRemove(id, removeFn)` plays the CSS exit class for ~200ms, then
 * actually removes the item and clears the id — so rows slide out instead of
 * vanishing instantly.
 */
function useRemovingIds() {
  const [removingIds, setRemovingIds] = useState<Set<number>>(new Set());
  const animateRemove = (id: number, removeFn: () => void) => {
    setRemovingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      removeFn();
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };
  return { removingIds, animateRemove };
}

function MoneyFlowApp() {
  // Open a specific tab on first load when reached via a deep link
  // (e.g. the post-login redirect "/?tab=account"). Defaults to the dashboard.
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return requested === "account" ? "account" : "dashboard";
  });
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<TxType>("expense");
  const { mode: themeMode, setMode: setThemeMode } = useTheme();

  const settings = trpc.settings.get.useQuery();
  const currency = settings.data?.currency || "THB";
  const effectiveCats = useMergedCategories();
  const me = trpc.auth.me.useQuery();
  const isAdmin = me.data?.role === "admin";

  // Load all data (user-scoped)
  const txs = trpc.transactions.list.useQuery();
  const budgets = trpc.budgets.list.useQuery();
  const goals = trpc.goals.list.useQuery();
  const recurring = trpc.recurring.list.useQuery();

  // derived numbers for current month
  const monthTotals = useMemo(() => {
    const t = { income: 0, expense: 0, saving: 0 };
    (txs.data || []).forEach((x) => {
      if (!isSameMonth(Number(x.occurredAt))) return;
      t[x.type as TxType] += toNumber(x.amount);
    });
    return t;
  }, [txs.data]);

  const balance = monthTotals.income - monthTotals.expense - monthTotals.saving;

  // ยอดยกมา: รายรับ - รายจ่าย - ออม ของทุกเดือนก่อนหน้า
  const carryover = useMemo(() => {
    const now = Date.now();
    const thisMonthStart = startOfMonthTs(now);
    return (txs.data || []).reduce((acc, x) => {
      if (Number(x.occurredAt) >= thisMonthStart) return acc;
      if (x.type === "income") return acc + toNumber(x.amount);
      return acc - toNumber(x.amount); // expense + saving หักออก
    }, 0);
  }, [txs.data]);

  const totalBalance = carryover + balance;

  const openAdd = (t: TxType) => {
    setAddType(t);
    setAddOpen(true);
  };

  return (
    <div className="min-h-screen relative pb-28 md:pb-10">
      <div className="mf-orb" style={{ top: -80, left: -40, width: 320, height: 320, background: "#6366f1" }} />
      <div className="mf-orb" style={{ top: 120, right: -60, width: 320, height: 320, background: "#d946ef" }} />

      {/* Header */}
      <header className="relative z-10 px-3 sm:px-6 pt-4 sm:pt-5 pb-2 sm:pb-3 max-w-5xl mx-auto flex items-center gap-2">
        <div className="min-w-0">
          <span className="inline-flex items-center rounded-xl border border-border/70 bg-card/60 backdrop-blur px-3 py-1 shadow-sm">
            <span className="text-base sm:text-lg font-bold mf-gradient-text truncate">Satang</span>
          </span>
        </div>
      </header>

      {/* Quick-entry summary cards */}
      <section className="relative z-10 px-3 sm:px-6 max-w-5xl mx-auto">
        <motion.div
          className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
          }}
        >
          {txs.isLoading
            ? [0, 1, 2, 3].map((i) => <SkeletonStatCard key={i} />)
            : (
          <>
          <motion.div variants={{ hidden: { opacity: 0, y: 12, scale: 0.96 }, show: { opacity: 1, y: 0, scale: 1 } }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
          <StatCard
            color="#22c55e"
            title="รายรับ"
            fullTitle="รายรับเดือนนี้"
            value={monthTotals.income}
            currency={currency}
            icon={<TrendingUp className="w-4 h-4" />}
            onClick={() => openAdd("income")}
            hint="แตะเพื่อเพิ่ม"
          />
          </motion.div>
          <motion.div variants={{ hidden: { opacity: 0, y: 12, scale: 0.96 }, show: { opacity: 1, y: 0, scale: 1 } }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
          <StatCard
            color="#ef4444"
            title="รายจ่าย"
            fullTitle="รายจ่ายเดือนนี้"
            value={monthTotals.expense}
            currency={currency}
            icon={<TrendingDown className="w-4 h-4" />}
            onClick={() => openAdd("expense")}
            hint="แตะเพื่อเพิ่ม"
          />
          </motion.div>
          <motion.div variants={{ hidden: { opacity: 0, y: 12, scale: 0.96 }, show: { opacity: 1, y: 0, scale: 1 } }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
          <StatCard
            color="#3b82f6"
            title="ออม"
            fullTitle="ออมเดือนนี้"
            value={monthTotals.saving}
            currency={currency}
            icon={<PiggyBank className="w-4 h-4" />}
            onClick={() => openAdd("saving")}
            hint="แตะเพื่อเพิ่ม"
          />
          </motion.div>
          <motion.div variants={{ hidden: { opacity: 0, y: 12, scale: 0.96 }, show: { opacity: 1, y: 0, scale: 1 } }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
          <StatCard
            color="#a78bfa"
            title="คงเหลือ"
            fullTitle="คงเหลือรวม"
            value={totalBalance}
            currency={currency}
            icon={<Wallet className="w-4 h-4" />}
            onClick={() => setTab("dashboard")}
            hint={
              carryover !== 0
                ? `ยกมา ${formatCurrency(carryover, currency)}`
                : totalBalance >= 0
                ? "สถานะดี"
                : "ควรระวัง"
            }
            highlight={totalBalance < 0 ? "negative" : "neutral"}
          />
          </motion.div>
          </>
          )}
        </motion.div>
      </section>

      {/* Tabs */}
      <nav className="relative z-10 mt-3 sm:mt-4 px-3 sm:px-6 max-w-5xl mx-auto">
        <div className="flex gap-1.5 overflow-x-auto mf-no-scrollbar py-1 -mx-1 px-1">
          {[
            { k: "dashboard", label: "แดชบอร์ด", icon: <BarChart3 className="w-4 h-4" /> },
            { k: "transactions", label: "รายการ", icon: <ListChecks className="w-4 h-4" /> },
            { k: "budgets", label: "งบ", icon: <Coins className="w-4 h-4" /> },
            { k: "recurring", label: "รายการประจำ", icon: <Repeat className="w-4 h-4" /> },
            { k: "settings", label: "ตั้งค่า", icon: <Settings className="w-4 h-4" /> },
            { k: "account", label: "บัญชี", icon: <CircleUserRound className="w-4 h-4" /> },
            ...(isAdmin
              ? [
                  { k: "metrics", label: "วัดผล & ผู้ใช้", icon: <Activity className="w-4 h-4" /> },
                ]
              : []),
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as Tab)}
              className={`mf-tab flex items-center gap-1 sm:gap-1.5 rounded-full border px-2.5 sm:px-3 py-1.5 text-[12.5px] sm:text-sm whitespace-nowrap shrink-0 ${
                tab === (t.k as Tab)
                  ? "bg-primary text-primary-foreground border-transparent shadow-md"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="relative z-10 mt-3 sm:mt-4 px-3 sm:px-6 max-w-5xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {tab === "dashboard" && (
              <DashboardView
                currency={currency}
                transactions={txs.data || []}
                goals={goals.data || []}
                budgets={budgets.data || []}
                recurring={recurring.data || []}
                onAdd={openAdd}
                onNavigate={(t) => setTab(t)}
                sections={{
                  budgets: {
                    loading: budgets.isLoading,
                    error: !!budgets.error && !budgets.data,
                    retry: () => budgets.refetch(),
                  },
                  recurring: {
                    loading: recurring.isLoading,
                    error: !!recurring.error && !recurring.data,
                    retry: () => recurring.refetch(),
                  },
                  goals: {
                    loading: goals.isLoading,
                    error: !!goals.error && !goals.data,
                    retry: () => goals.refetch(),
                  },
                }}
              />
            )}
            {tab === "transactions"
              ? txs.data
                ? <TransactionsView currency={currency} transactions={txs.data} onAdd={openAdd} />
                : txs.isLoading
                ? <SkeletonRows rows={8} rowClass="h-[52px]" />
                : <LoadError onRetry={() => txs.refetch()} />
              : null}
            {tab === "budgets"
              ? budgets.data
                ? <BudgetsView currency={currency} transactions={txs.data || []} budgets={budgets.data} />
                : budgets.isLoading
                ? <div className="space-y-3"><SkeletonBars bars={5} /></div>
                : <LoadError onRetry={() => budgets.refetch()} />
              : null}
            {tab === "recurring"
              ? recurring.data
                ? <RecurringView currency={currency} items={recurring.data} goals={goals.data || []} />
                : recurring.isLoading
                ? <SkeletonRows rows={4} rowClass="h-[56px]" />
                : <LoadError onRetry={() => recurring.refetch()} />
              : null}
            {tab === "report" && (
              <MonthlyReportView
                currency={currency}
                transactions={txs.data || []}
              />
            )}
            {tab === "data" && (
              <DataView
                currency={currency}
                transactions={txs.data || []}
                budgets={budgets.data || []}
                goals={goals.data || []}
                recurring={recurring.data || []}
                onBack={() => setTab("settings")}
              />
            )}
            {tab === "settings" && <SettingsView onOpenBackup={() => setTab("data")} />}
            {tab === "account" && <AccountView />}
            {tab === "metrics" && isAdmin && <MetricsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating theme switcher — bottom-left corner */}
      <div className="fixed bottom-5 left-5 z-20 mf-pop">
        <div className="rounded-full border border-border/70 bg-card/70 backdrop-blur-md shadow-xl">
          <ThemeMenu mode={themeMode} onModeChange={(m) => setThemeMode?.(m)} />
        </div>
      </div>

      {/* Floating Add button */}
      <button
        onClick={() => openAdd("expense")}
        className="fixed bottom-5 right-5 z-20 h-14 w-14 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-xl grid place-items-center mf-pop hover:scale-105 active:scale-[0.92] transition-transform"
        aria-label="Add"
      >
        <Plus className="w-6 h-6" />
      </button>

      <TxFormDialog open={addOpen} onOpenChange={setAddOpen} initialType={addType} categories={effectiveCats} />
    </div>
  );
}

function StatCard({
  color,
  title,
  fullTitle,
  value,
  currency,
  icon,
  onClick,
  hint,
  highlight,
}: {
  color: string;
  title: string;
  fullTitle?: string;
  value: number;
  currency: string;
  icon: ReactNode;
  onClick?: () => void;
  hint?: string;
  highlight?: "negative" | "neutral";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative mf-stat mf-card text-left rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-3 sm:p-4 shadow-sm hover:shadow-lg hover:border-border active:scale-[0.97] transition-all min-w-0 overflow-hidden"
      style={{ ["--stat-color" as any]: color }}
    >
      {/* Soft color glow bleeding from the top-right corner */}
      <div
        aria-hidden
        className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl pointer-events-none transition-opacity duration-300"
        style={{ background: color, opacity: 0.14 }}
      />
      {/* Thin color accent along the bottom edge */}
      <div
        aria-hidden
        className="absolute inset-x-3 bottom-0 h-[2.5px] rounded-full pointer-events-none"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
      />

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="sm:hidden text-[11px] uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          <span className="hidden sm:inline text-[11px] uppercase tracking-wide text-muted-foreground">
            {fullTitle || title}
          </span>
        </div>
        {/* Tinted icon chip instead of a solid dot */}
        <div
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl grid place-items-center font-bold text-xs sm:text-sm shrink-0 transition-transform duration-200 group-hover:scale-110"
          style={{
            backgroundColor: `${color}1f`,
            color,
            boxShadow: `inset 0 0 0 1px ${color}33`,
          }}
        >
          {icon}
        </div>
      </div>
      <div className="mt-1.5 sm:mt-2 text-base sm:text-xl font-bold truncate tabular-nums">
        <AnimatedCurrency
          value={value}
          currency={currency}
          className={highlight === "negative" ? "text-rose-500" : ""}
        />
      </div>
      {hint && (
        <div className="mt-1 text-[10px] sm:text-[11px] text-muted-foreground flex items-center gap-0.5 truncate">
          {hint} <ChevronRight className="w-3 h-3 shrink-0 opacity-60 transition-transform duration-200 group-hover:translate-x-0.5" />
        </div>
      )}
    </button>
  );
}

/** Progress-bar fill that animates from 0 up to `pct` on mount (and on
 * further changes), instead of snapping straight to its value. */
function AnimatedBar({ pct, background }: { pct: number; background: string }) {
  const animatedPct = useAnimatedPct(pct);
  return (
    <div
      className="mf-progress h-full rounded-full transition-[width] duration-700"
      style={{ width: `${animatedPct}%`, background }}
    />
  );
}

/* ----------------- DASHBOARD ----------------- */

/** Per-section async state for the dashboard cards */
interface SectionState {
  loading: boolean;
  error: boolean;
  retry: () => void;
}

function DashboardView({
  currency,
  transactions,
  goals,
  budgets,
  recurring,
  onAdd,
  onNavigate,
  sections,
}: {
  currency: string;
  transactions: any[];
  goals: any[];
  budgets: any[];
  recurring: any[];
  onAdd: (t: TxType) => void;
  onNavigate: (tab: Tab) => void;
  sections?: {
    budgets?: SectionState;
    recurring?: SectionState;
    goals?: SectionState;
  };
}) {
  const mtdExpense = transactions
    .filter((t) => t.type === "expense" && isSameMonth(Number(t.occurredAt)))
    .reduce((a, b) => a + toNumber(b.amount), 0);

  const _now = Date.now();
  const _d = new Date(); _d.setHours(0, 0, 0, 0);
  const _dayStart = _d.getTime(); const _dayEnd = _dayStart + 86399999;
  const _w = new Date(); _w.setDate(_w.getDate() - _w.getDay()); _w.setHours(0, 0, 0, 0);
  const _weekStart = _w.getTime(); const _weekEnd = _weekStart + 7 * 86400000 - 1;
  const _monthStart = startOfMonthTs(_now); const _monthEnd = endOfMonthTs(_now);
  const _yearStart = startOfYearTs(_now); const _yearEnd = endOfYearTs(_now);

  const topBudgets = budgets
    .filter((b) => b.period === "monthly" || b.period === "daily" || b.period === "weekly" || b.period === "yearly")
    .slice(0, 3)
    .map((b) => {
      const [from, to] =
        b.period === "daily" ? [_dayStart, _dayEnd] :
        b.period === "weekly" ? [_weekStart, _weekEnd] :
        b.period === "yearly" ? [_yearStart, _yearEnd] :
        [_monthStart, _monthEnd];
      const periodLabel =
        b.period === "daily" ? "วันนี้" :
        b.period === "weekly" ? "สัปดาห์นี้" :
        b.period === "yearly" ? "ปีนี้" :
        "เดือนนี้";
      const used = transactions
        .filter(
          (t) =>
            t.type === "expense" &&
            t.category === b.category &&
            Number(t.occurredAt) >= from &&
            Number(t.occurredAt) <= to,
        )
        .reduce((a, c) => a + toNumber(c.amount), 0);
      return { ...b, used, limit: toNumber(b.limitAmount), periodLabel };
    });

  return (
    <motion.div
      className="grid grid-cols-1 gap-4"
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
      }}
    >
      <motion.div
        variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={() => onNavigate("budgets")}
        className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card cursor-pointer transition-colors hover:bg-card active:scale-[0.97]"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">ภาพรวมงบประมาณ</div>
          <Coins className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="text-xs text-muted-foreground mb-3">
          รายจ่ายเดือนนี้ทั้งหมด: <span className="font-medium text-foreground"><AnimatedCurrency value={mtdExpense} currency={currency} colorPulse={false} /></span>
        </div>
        <div className="mt-1 space-y-3">
          {sections?.budgets?.error ? (
            <LoadError onRetry={sections.budgets.retry} />
          ) : sections?.budgets?.loading ? (
            <SkeletonBars bars={3} />
          ) : topBudgets.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              ยังไม่ได้ตั้งงบ — ลองไปที่แท็บ "งบ" เพื่อตั้งเพดานรายจ่าย
            </div>
          ) : (
            topBudgets.map((b) => {
              const pct = b.limit > 0 ? Math.min(100, (b.used / b.limit) * 100) : 0;
              const over = b.used > b.limit;
              const warn = !over && pct >= 80;
              return (
                <div key={b.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{b.category}</span>
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {b.periodLabel}
                      </span>
                    </div>
                    <span className={over ? "text-rose-500" : warn ? "text-amber-500" : "text-muted-foreground"}>
                      <AnimatedCurrency value={b.used} currency={currency} colorPulse={false} /> / {formatCurrency(b.limit, currency)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <AnimatedBar
                      pct={pct}
                      background={
                        over
                          ? "linear-gradient(90deg,#ef4444,#f97316)"
                          : warn
                          ? "linear-gradient(90deg,#f59e0b,#f97316)"
                          : "linear-gradient(90deg,#6366f1,#a855f7)"
                      }
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>

      {/* Monthly report — compact launcher tile */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={() => onNavigate("report")}
        className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 backdrop-blur-md px-3 py-2.5 mf-card cursor-pointer transition-colors hover:bg-card hover:border-border active:scale-[0.97]"
      >
        <span className="w-8 h-8 shrink-0 rounded-lg bg-primary/10 text-primary grid place-items-center">
          <FileBarChart className="w-4 h-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">รายงานรายเดือน</span>
          <span className="block text-[11px] text-muted-foreground">สรุปยอด + กราฟแยกตามหมวด</span>
        </span>
        <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
      </motion.div>

      {/* Recurring */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={() => onNavigate("recurring")}
        className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card cursor-pointer transition-colors hover:bg-card active:scale-[0.97]"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">รายการประจำที่กำลังจะถึง</div>
          <Repeat className="w-4 h-4 text-muted-foreground" />
        </div>
        {sections?.recurring?.error ? (
          <LoadError onRetry={sections.recurring.retry} />
        ) : sections?.recurring?.loading ? (
          <SkeletonRows rows={4} rowClass="h-9" />
        ) : recurring.length === 0 ? (
          <div className="text-xs text-muted-foreground">ยังไม่มีรายการประจำ</div>
        ) : (
          <ul className="space-y-2">
            {[...recurring]
              .sort((a, b) => Number(a.nextDate) - Number(b.nextDate))
              .slice(0, 5)
              .map((r) => {
                const daysLeft = Math.ceil((Number(r.nextDate) - Date.now()) / 86400000);
                const isToday = daysLeft <= 0;
                const isSoon = daysLeft <= 3 && daysLeft > 0;
                const typeColor =
                  r.type === "income" ? "text-emerald-500" : r.type === "expense" ? "text-rose-500" : "text-sky-500";
                const freqLabel: Record<string, string> = {
                  daily: "ทุกวัน", weekly: "ทุกสัปดาห์", monthly: "ทุกเดือน", yearly: "ทุกปี",
                };
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs font-medium truncate">
                        <span className="truncate">{r.category || r.note || freqLabel[r.freq] || r.freq}</span>
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {freqLabel[r.freq] || r.freq}
                        </span>
                      </div>
                      <div className={`text-[11px] mt-0.5 ${isToday ? "text-rose-500 font-semibold" : isSoon ? "text-amber-500" : "text-muted-foreground"}`}>
                        {isToday ? "ครบกำหนดวันนี้" : daysLeft === 1 ? "พรุ่งนี้" : `อีก ${daysLeft} วัน`}
                      </div>
                    </div>
                    <div className={`text-sm font-bold tabular-nums shrink-0 ${typeColor}`}>
                      {r.type === "income" ? "+" : "-"}{formatCurrency(toNumber(r.amount), currency)}
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </motion.div>

      {/* Goals */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={() => onNavigate("recurring")}
        className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card cursor-pointer transition-colors hover:bg-card active:scale-[0.97]"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">เป้าหมายการออม</div>
          <Target className="w-4 h-4 text-muted-foreground" />
        </div>
        {sections?.goals?.error ? (
          <LoadError onRetry={sections.goals.retry} />
        ) : sections?.goals?.loading ? (
          <SkeletonBars bars={3} />
        ) : goals.length === 0 ? (
          <div className="text-xs text-muted-foreground">ยังไม่ได้ตั้งเป้าหมาย</div>
        ) : (
          <ul className="space-y-3">
            {[...goals]
              .sort((a, b) => toNumber(b.savedAmount) / toNumber(b.targetAmount) - toNumber(a.savedAmount) / toNumber(a.targetAmount))
              .slice(0, 4)
              .map((g) => {
                const saved = toNumber(g.savedAmount);
                const target = toNumber(g.targetAmount);
                const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
                const done = saved >= target;
                const daysLeft = g.deadline
                  ? Math.ceil((Number(g.deadline) - Date.now()) / 86400000)
                  : null;
                return (
                  <li key={g.id}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium truncate flex items-center gap-1">
                        {g.emoji && <span>{g.emoji}</span>}
                        <span className="truncate">{g.name}</span>
                      </span>
                      <span className={done ? "text-emerald-500 font-semibold" : "text-muted-foreground"}>
                        {done ? "✓ สำเร็จ" : `${Math.round(pct)}%`}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <AnimatedBar
                        pct={pct}
                        background={
                          done
                            ? "linear-gradient(90deg,#22c55e,#16a34a)"
                            : "linear-gradient(90deg,#f59e0b,#f97316)"
                        }
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                      <span>{formatCurrency(saved, currency)} / {formatCurrency(target, currency)}</span>
                      {daysLeft !== null && (
                        <span className={daysLeft < 0 ? "text-rose-500" : daysLeft <= 7 ? "text-amber-500" : ""}>
                          {daysLeft < 0 ? `เกินกำหนด ${Math.abs(daysLeft)} วัน` : daysLeft === 0 ? "วันนี้" : `อีก ${daysLeft} วัน`}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </motion.div>


    </motion.div>
  );
}

function TransactionsView({
  currency,
  transactions,
  onAdd,
}: {
  currency: string;
  transactions: any[];
  onAdd: (t: TxType) => void;
}) {
  const utils = trpc.useUtils();
  // Ids currently playing the slide-out/fade exit animation — kept out of
  // the optimistic cache update until the animation finishes so the row
  // has time to animate instead of vanishing the instant delete is confirmed.
  const { removingIds, animateRemove } = useRemovingIds();
  const del = trpc.transactions.remove.useMutation({
    onMutate: async ({ id }) => {
      await utils.transactions.list.cancel();
      const prev = utils.transactions.list.getData();
      utils.transactions.list.setData(undefined, (old) => (old ?? []).filter((t) => t.id !== id));
      return { prev };
    },
    onError: async (_err, vars, ctx) => {
      // staleTime: 0 is required here: an earlier setData call stamps this
      // query as "fresh" (setData always updates dataUpdatedAt), so a plain
      // .fetch() could return that cached snapshot instead of asking the
      // server — defeating the whole point of verifying.
      const { succeeded, fresh } = await verifyDeleteSucceeded(
        () => utils.transactions.list.fetch(undefined, { staleTime: 0 }),
        vars.id,
      );
      if (succeeded) {
        utils.transactions.list.setData(undefined, fresh);
        toast.success("ลบแล้ว");
        return;
      }
      if (ctx?.prev) utils.transactions.list.setData(undefined, ctx.prev);
      toast.error("ลบไม่สำเร็จ");
    },
    onSuccess: () => toast.success("ลบแล้ว"),
    onSettled: () => utils.transactions.list.invalidate(),
  });
  const update = trpc.transactions.update.useMutation({
    onMutate: async (vars) => {
      await utils.transactions.list.cancel();
      const prev = utils.transactions.list.getData();
      utils.transactions.list.setData(undefined, (old) =>
        (old ?? []).map((t) =>
          t.id === vars.id
            ? {
                ...t,
                ...(vars.type && { type: vars.type }),
                ...(vars.amount !== undefined && { amount: String(vars.amount) }),
                ...(vars.category !== undefined && { category: vars.category }),
                ...(vars.note !== undefined && { note: vars.note }),
                ...(vars.occurredAt !== undefined && { occurredAt: vars.occurredAt }),
              }
            : t,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.transactions.list.setData(undefined, ctx.prev);
      toast.error("แก้ไขไม่สำเร็จ");
    },
    onSuccess: () => {
      toast.success("แก้ไขแล้ว");
      setEditTx(null);
    },
    onSettled: () => utils.transactions.list.invalidate(),
  });

  const CATS = useMergedCategories();

  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState<string>(() => tsToDateInput(startOfMonthTs(Date.now())));
  const [toDate, setToDate] = useState<string>(() => tsToDateInput(endOfMonthTs(Date.now())));
  const [filterType, setFilterType] = useState<"all" | TxType>("all");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [rangePreset, setRangePreset] = useState<"day" | "week" | "month" | "all" | "custom">("month");
  const [openTxId, setOpenTxId] = useState<number | null>(null);
  const [deleteTx, setDeleteTx] = useState<any | null>(null);
  const [editTx, setEditTx] = useState<any | null>(null);
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);

  // Edit form state
  const [editType, setEditType] = useState<TxType>("expense");
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editDate, setEditDate] = useState("");

  const openEdit = (t: any) => {
    setEditTx(t);
    setEditType(t.type as TxType);
    setEditAmount(String(toNumber(t.amount)));
    setEditCategory(t.category || "");
    setEditNote(t.note || "");
    setEditDate(tsToDateInput(Number(t.occurredAt)));
  };

  useEffect(() => {
    if (rangePreset === "day") {
      const t = tsToDateInput(Date.now());
      setFromDate(t);
      setToDate(t);
    } else if (rangePreset === "week") {
      const now = Date.now();
      setFromDate(tsToDateInput(startOfWeekTs(now)));
      setToDate(tsToDateInput(endOfWeekTs(now)));
    } else if (rangePreset === "month") {
      const now = Date.now();
      setFromDate(tsToDateInput(startOfMonthTs(now)));
      setToDate(tsToDateInput(endOfMonthTs(now)));
    } else if (rangePreset === "all") {
      setFromDate("");
      setToDate("");
    }
  }, [rangePreset]);

  // Reset to page 1 when filters/search change
  useEffect(() => { setPage(1); }, [q, fromDate, toDate, filterType, filterCat, pageSize]);

  const filtered = useMemo(() => {
    let list = [...transactions];
    list.sort((a, b) => Number(b.occurredAt) - Number(a.occurredAt));
    if (filterType !== "all") list = list.filter((t) => t.type === filterType);
    if (filterCat !== "all") list = list.filter((t) => (t.category || "") === filterCat);
    if (fromDate) {
      const ts = dateInputToTs(fromDate);
      list = list.filter((t) => Number(t.occurredAt) >= ts);
    }
    if (toDate) {
      const ts = dateInputToTs(toDate) + 24 * 3600 * 1000 - 1;
      list = list.filter((t) => Number(t.occurredAt) <= ts);
    }
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      list = list.filter(
        (t) =>
          (t.category || "").toLowerCase().includes(qq) ||
          (t.note || "").toLowerCase().includes(qq) ||
          String(t.amount).includes(qq),
      );
    }
    return list;
  }, [transactions, filterType, filterCat, fromDate, toDate, q]);

  const totalShown = filtered.reduce(
    (acc, t) => {
      acc[t.type as TxType] += toNumber(t.amount);
      return acc;
    },
    { income: 0, expense: 0, saving: 0 } as Record<TxType, number>,
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const allCats = useMemo(() => {
    const s = new Set<string>();
    transactions.forEach((t) => t.category && s.add(t.category));
    return Array.from(s).sort();
  }, [transactions]);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-3 mf-card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="ค้นหาหมวด/โน้ต/จำนวน"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(["day", "week", "month", "all", "custom"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRangePreset(r)}
                className={`mf-chip rounded-full border px-2.5 py-1 text-xs ${
                  rangePreset === r
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "border-border text-muted-foreground"
                }`}
              >
                {r === "day" ? "วันนี้" : r === "week" ? "สัปดาห์นี้" : r === "month" ? "เดือนนี้" : r === "all" ? "ทั้งหมด" : "กำหนดเอง"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
            <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกประเภท</SelectItem>
                <SelectItem value="income">รายรับ</SelectItem>
                <SelectItem value="expense">รายจ่าย</SelectItem>
                <SelectItem value="saving">ออม</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterCat} onValueChange={setFilterCat}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="หมวดทั้งหมด" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">หมวดทั้งหมด</SelectItem>
                {allCats.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {rangePreset === "custom" && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <Label className="text-xs">จากวันที่</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">ถึงวันที่</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">รวม {filtered.length} รายการ</span>
          <span className="inline-flex items-center gap-1 text-emerald-500">
            + <AnimatedCurrency value={totalShown.income} currency={currency} colorPulse={false} />
          </span>
          <span className="inline-flex items-center gap-1 text-rose-500">
            - <AnimatedCurrency value={totalShown.expense} currency={currency} colorPulse={false} />
          </span>
          <span className="inline-flex items-center gap-1 text-sky-500">
            ⧠ <AnimatedCurrency value={totalShown.saving} currency={currency} colorPulse={false} />
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">แสดง</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-7 w-[70px] text-xs px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">รายการ</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => onAdd("expense")}>
            <Plus className="w-3.5 h-3.5 mr-1" /> เพิ่มรายการ
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-1 mf-card">
        {filtered.length === 0 ? (
          <Empty text="ยังไม่มีรายการตรงกับตัวกรอง" />
        ) : (
          <ul className="divide-y divide-border/60">
            {paginated.map((t) => {
              const color =
                t.type === "income"
                  ? "text-emerald-500"
                  : t.type === "expense"
                    ? "text-rose-500"
                    : "text-sky-500";
              const sign = t.type === "income" ? "+" : "-";
              const isOpen = openTxId === t.id;
              const isRemoving = removingIds.has(t.id);
              return (
                <li
                  key={t.id}
                  className={`px-2.5 sm:px-3 py-2.5 mf-pop mf-list-item ${
                    isRemoving ? "mf-list-item-removing" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    <button
                      className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 text-left"
                      onClick={() => setOpenTxId(isOpen ? null : t.id)}
                    >
                      <div
                        className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full grid place-items-center font-bold text-white shrink-0 ${
                          t.type === "income"
                            ? "bg-emerald-500"
                            : t.type === "expense"
                              ? "bg-rose-500"
                              : "bg-sky-500"
                        }`}
                      >
                        {t.type === "income" ? "↑" : t.type === "expense" ? "↓" : "⧠"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {t.category || TYPE_LABEL[t.type as TxType]}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {new Date(Number(t.occurredAt)).toLocaleDateString("th-TH", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                          {t.note ? ` • ${t.note}` : ""}
                        </div>
                      </div>
                      <div className={`text-sm font-bold tabular-nums whitespace-nowrap ${color}`}>
                        {sign}
                        {formatCurrency(toNumber(t.amount), currency)}
                      </div>
                    </button>
                    {(t as any).attachmentId ? (
                      <a
                        href={`/api/attachments/${(t as any).attachmentId}`}
                        target="_blank"
                        rel="noreferrer"
                        title="ดูสลิปที่แนบจาก Telegram"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                      </a>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => openEdit(t)}
                      title="แก้ไข"
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setDeleteTx(t)}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 flex-wrap">
          <button
            onClick={() => setPage(1)}
            disabled={safePage === 1}
            className="h-8 w-8 rounded-lg border border-border text-xs flex items-center justify-center disabled:opacity-30 hover:bg-muted transition-colors"
            title="หน้าแรก"
          >
            «
          </button>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="h-8 w-8 rounded-lg border border-border text-xs flex items-center justify-center disabled:opacity-30 hover:bg-muted transition-colors"
            title="ก่อนหน้า"
          >
            ‹
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
            .reduce<(number | "...")[]>((acc, p, idx, arr) => {
              if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("...");
              acc.push(p);
              return acc;
            }, [])
            .map((item, idx) =>
              item === "..." ? (
                <span key={`ellipsis-${idx}`} className="h-8 w-8 flex items-center justify-center text-xs text-muted-foreground">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  onClick={() => setPage(item as number)}
                  className={`h-8 w-8 rounded-lg border text-xs flex items-center justify-center transition-colors ${
                    safePage === item
                      ? "bg-primary text-primary-foreground border-transparent"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {item}
                </button>
              )
            )}

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="h-8 w-8 rounded-lg border border-border text-xs flex items-center justify-center disabled:opacity-30 hover:bg-muted transition-colors"
            title="ถัดไป"
          >
            ›
          </button>
          <button
            onClick={() => setPage(totalPages)}
            disabled={safePage === totalPages}
            className="h-8 w-8 rounded-lg border border-border text-xs flex items-center justify-center disabled:opacity-30 hover:bg-muted transition-colors"
            title="หน้าสุดท้าย"
          >
            »
          </button>
          <span className="text-xs text-muted-foreground ml-1">
            หน้า {safePage}/{totalPages}
          </span>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTx} onOpenChange={(v) => !v && setDeleteTx(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ยืนยันการลบ</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            ต้องการลบรายการ{" "}
            <span className="font-semibold text-foreground">
              {deleteTx?.category || TYPE_LABEL[deleteTx?.type as TxType]}
            </span>{" "}
            จำนวน{" "}
            <span className="font-semibold text-foreground">
              {formatCurrency(toNumber(deleteTx?.amount), currency)}
            </span>{" "}
            ใช่ไหม? การดำเนินการนี้ไม่สามารถย้อนกลับได้
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTx(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() => {
                if (!deleteTx) return;
                const id = deleteTx.id;
                setDeleteTx(null); // close dialog immediately
                // Play the slide-out/fade animation on the row first, then
                // remove it from data once the animation has finished.
                animateRemove(id, () => del.mutate({ id }));
              }}
            >
              {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "ลบ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTx} onOpenChange={(v) => !v && setEditTx(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>แก้ไขรายการ</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(["income", "expense", "saving"] as TxType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setEditType(t);
                    if (!CATS[t].includes(editCategory)) setEditCategory(CATS[t][0]);
                  }}
                  className={`mf-chip rounded-lg border px-2 py-2 text-sm font-medium ${
                    editType === t ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground"
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <div>
              <Label>จำนวน</Label>
              <Input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <div>
              <Label>หมวด</Label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATS[editType].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>โน้ต</Label>
              <Textarea rows={2} value={editNote} onChange={(e) => setEditNote(e.target.value)} className="resize-none" />
            </div>
            <div>
              <Label>วันที่</Label>
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTx(null)}>ยกเลิก</Button>
            <Button
              disabled={!editAmount || update.isPending}
              onClick={() => {
                if (!editTx) return;
                update.mutate({
                  id: editTx.id,
                  type: editType,
                  amount: Number(editAmount),
                  category: editCategory || null,
                  note: editNote || null,
                  occurredAt: dateInputToTs(editDate),
                });
              }}
            >
              {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "บันทึก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ----------------- BUDGETS ----------------- */

function BudgetsView({
  currency,
  transactions,
  budgets,
}: {
  currency: string;
  transactions: any[];
  budgets: any[];
}) {
  const utils = trpc.useUtils();
  const CATS = useMergedCategories();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(CATEGORIES.expense[0]);
  const [limitAmount, setLimitAmount] = useState("");
  const [period, setPeriod] = useState<Period>("monthly");

  const create = trpc.budgets.create.useMutation({
    onMutate: async (vars) => {
      await utils.budgets.list.cancel();
      const prev = utils.budgets.list.getData();
      utils.budgets.list.setData(undefined, (old) => [
        ...(old ?? []),
        { id: Date.now(), ...vars, limitAmount: String(vars.limitAmount) } as any,
      ]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.budgets.list.setData(undefined, ctx.prev);
      toast.error("ตั้งงบไม่สำเร็จ");
    },
    onSuccess: () => {
      toast.success("ตั้งงบเรียบร้อย");
      setOpen(false);
      setLimitAmount("");
    },
    onSettled: () => utils.budgets.list.invalidate(),
  });
  const remove = trpc.budgets.remove.useMutation({
    onMutate: async ({ id }) => {
      await utils.budgets.list.cancel();
      const prev = utils.budgets.list.getData();
      utils.budgets.list.setData(undefined, (old) => (old ?? []).filter((b) => b.id !== id));
      return { prev };
    },
    onError: async (_err, vars, ctx) => {
      const { succeeded, fresh } = await verifyDeleteSucceeded(
        () => utils.budgets.list.fetch(undefined, { staleTime: 0 }),
        vars.id,
      );
      if (succeeded) {
        utils.budgets.list.setData(undefined, fresh);
        toast.success("ลบแล้ว");
        return;
      }
      if (ctx?.prev) utils.budgets.list.setData(undefined, ctx.prev);
      toast.error("ลบงบไม่สำเร็จ");
    },
    onSuccess: () => toast.success("ลบแล้ว"),
    onSettled: () => utils.budgets.list.invalidate(),
  });

  const now = Date.now();
  const monthStart = startOfMonthTs(now);
  const monthEnd = endOfMonthTs(now);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const yearEnd = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59).getTime();
  const _today = new Date(); _today.setHours(0,0,0,0);
  const dayStart = _today.getTime();
  const dayEnd = _today.getTime() + 86399999;
  const _weekDay = new Date(); const _wd = _weekDay.getDay(); _weekDay.setDate(_weekDay.getDate() - _wd); _weekDay.setHours(0,0,0,0);
  const weekStart = _weekDay.getTime();
  const weekEnd = weekStart + 7 * 86400000 - 1;
  const { removingIds: removingBudgets, animateRemove: animateRemoveBudget } = useRemovingIds();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">ตั้งเพดานรายจ่ายตามหมวด</div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> ตั้งงบใหม่
        </Button>
      </div>
      {budgets.length === 0 ? (
        <Empty text="ยังไม่มีงบประมาณ" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {budgets.map((b) => {
            const from = b.period === "monthly" ? monthStart : b.period === "yearly" ? yearStart : b.period === "weekly" ? weekStart : dayStart;
            const to = b.period === "monthly" ? monthEnd : b.period === "yearly" ? yearEnd : b.period === "weekly" ? weekEnd : dayEnd;
            const used = transactions
              .filter(
                (t) =>
                  t.type === "expense" &&
                  t.category === b.category &&
                  Number(t.occurredAt) >= from &&
                  Number(t.occurredAt) <= to,
              )
              .reduce((a, c) => a + toNumber(c.amount), 0);
            const limit = toNumber(b.limitAmount);
            const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
            const over = used > limit;
            return (
              <div key={b.id} className={`rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card mf-list-item ${removingBudgets.has(b.id) ? "mf-card-removing" : ""}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{b.category}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {b.period === "daily" ? "รายวัน" : b.period === "weekly" ? "รายสัปดาห์" : b.period === "monthly" ? "รายเดือน" : "รายปี"}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => animateRemoveBudget(b.id, () => remove.mutate({ id: b.id }))}
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
                <div className="text-xs mb-1 flex justify-between">
                  <span><AnimatedCurrency value={used} currency={currency} colorPulse={false} /></span>
                  <span className={over ? "text-rose-500" : "text-muted-foreground"}>
                    / {formatCurrency(limit, currency)} ({Math.round(pct)}%)
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <AnimatedBar
                    pct={pct}
                    background={
                      over
                        ? "linear-gradient(90deg,#ef4444,#f97316)"
                        : "linear-gradient(90deg,#6366f1,#a855f7)"
                    }
                  />
                </div>
                {over && (
                  <div className="mt-1.5 text-[11px] text-rose-500">
                    ใช้เกินงบ <AnimatedCurrency value={used - limit} currency={currency} colorPulse={false} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ตั้งงบใหม่</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>หมวด</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATS.expense.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>จำนวน</Label>
              <Input type="number" value={limitAmount} onChange={(e) => setLimitAmount(e.target.value)} />
            </div>
            <div>
              <Label>ช่วงเวลา</Label>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">รายวัน</SelectItem>
                  <SelectItem value="weekly">รายสัปดาห์</SelectItem>
                  <SelectItem value="monthly">รายเดือน</SelectItem>
                  <SelectItem value="yearly">รายปี</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              onClick={() =>
                create.mutate({
                  category,
                  limitAmount: Number(limitAmount),
                  period,
                })
              }
              disabled={create.isPending || !limitAmount}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ----------------- GOALS ----------------- */

function GoalsView({ currency, goals }: { currency: string; goals: any[] }) {
  const utils = trpc.useUtils();
  const { removingIds: removingGoals, animateRemove: animateRemoveGoal } = useRemovingIds();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState<string>("");

  const [addMoneyId, setAddMoneyId] = useState<number | null>(null);
  const [addMoneyAmount, setAddMoneyAmount] = useState("");

  const create = trpc.goals.create.useMutation({
    onMutate: async (vars) => {
      await utils.goals.list.cancel();
      const prev = utils.goals.list.getData();
      utils.goals.list.setData(undefined, (old) => [
        ...(old ?? []),
        { id: Date.now(), ...vars, targetAmount: String(vars.targetAmount), savedAmount: "0" } as any,
      ]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.goals.list.setData(undefined, ctx.prev);
      toast.error("เพิ่มเป้าหมายไม่สำเร็จ");
    },
    onSuccess: () => {
      toast.success("เพิ่มเป้าหมายแล้ว");
      setOpen(false);
      setName("");
      setEmoji("");
      setTarget("");
      setDeadline("");
    },
    onSettled: () => utils.goals.list.invalidate(),
  });
  const remove = trpc.goals.remove.useMutation({
    onMutate: async ({ id }) => {
      await utils.goals.list.cancel();
      const prev = utils.goals.list.getData();
      utils.goals.list.setData(undefined, (old) => (old ?? []).filter((g) => g.id !== id));
      return { prev };
    },
    onError: async (_err, vars, ctx) => {
      const { succeeded, fresh } = await verifyDeleteSucceeded(
        () => utils.goals.list.fetch(undefined, { staleTime: 0 }),
        vars.id,
      );
      if (succeeded) {
        utils.goals.list.setData(undefined, fresh);
        toast.success("ลบแล้ว");
        return;
      }
      if (ctx?.prev) utils.goals.list.setData(undefined, ctx.prev);
      toast.error("ลบเป้าหมายไม่สำเร็จ");
    },
    onSuccess: () => toast.success("ลบแล้ว"),
    onSettled: () => utils.goals.list.invalidate(),
  });
  const addAmt = trpc.goals.addAmount.useMutation({
    onMutate: async (vars) => {
      await utils.goals.list.cancel();
      const prev = utils.goals.list.getData();
      utils.goals.list.setData(undefined, (old) =>
        (old ?? []).map((g) =>
          g.id === vars.id
            ? { ...g, savedAmount: String(toNumber(g.savedAmount) + vars.amount) }
            : g,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.goals.list.setData(undefined, ctx.prev);
      toast.error("เพิ่มเงินไม่สำเร็จ");
    },
    onSuccess: () => {
      toast.success("เพิ่มเงินออมเข้าเป้าหมาย");
      setAddMoneyId(null);
      setAddMoneyAmount("");
    },
    onSettled: () => utils.goals.list.invalidate(),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">ตั้งเป้าหมายการออม และเพิ่มเงินเข้าสะสม</div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> เป้าหมายใหม่
        </Button>
      </div>
      {goals.length === 0 ? (
        <Empty text="ยังไม่มีเป้าหมาย" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {goals.map((g) => {
            const saved = toNumber(g.savedAmount);
            const target = toNumber(g.targetAmount);
            const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
            return (
              <div key={g.id} className={`rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card mf-list-item ${removingGoals.has(g.id) ? "mf-card-removing" : ""}`}>
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex items-center gap-2">
                    <div className="text-2xl">{g.emoji}</div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{g.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {g.deadline ? new Date(Number(g.deadline)).toLocaleDateString("th-TH") : "ไม่มีกำหนด"}
                      </div>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => animateRemoveGoal(g.id, () => remove.mutate({ id: g.id }))}>
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
                <div className="mt-3 text-xs flex justify-between">
                  <span><AnimatedCurrency value={saved} currency={currency} /></span>
                  <span className="text-muted-foreground">
                    / {formatCurrency(target, currency)} ({Math.round(pct)}%)
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <AnimatedBar pct={pct} background="linear-gradient(90deg,#22c55e,#14b8a6)" />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setAddMoneyId(g.id);
                      setAddMoneyAmount("");
                    }}
                  >
                    + เพิ่มเงิน
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>เป้าหมายใหม่</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-[88px_1fr] gap-2">
              <div>
                <Label>อีโมจิ</Label>
                <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} />
              </div>
              <div>
                <Label>ชื่อ</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="iPhone ใหม่ / กองทุนฉุกเฉิน" />
              </div>
            </div>
            <div>
              <Label>จำนวนเป้าหมาย</Label>
              <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div>
              <Label>กำหนดเสร็จ (ไม่บังคับ)</Label>
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              onClick={() =>
                create.mutate({
                  name: name || "เป้าหมาย",
                  emoji: emoji,
                  targetAmount: Number(target),
                  deadline: deadline ? dateInputToTs(deadline) : null,
                })
              }
              disabled={!name || !target || create.isPending}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addMoneyId !== null} onOpenChange={(v) => !v && setAddMoneyId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>เพิ่มเงินเข้าเป้าหมาย</DialogTitle>
          </DialogHeader>
          <div>
            <Label>จำนวน</Label>
            <Input
              type="number"
              value={addMoneyAmount}
              onChange={(e) => setAddMoneyAmount(e.target.value)}
              className="text-2xl font-bold h-14"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddMoneyId(null)}>
              ยกเลิก
            </Button>
            <Button
              onClick={() => {
                if (addMoneyId == null) return;
                const a = Number(addMoneyAmount);
                if (!a || a <= 0) {
                  toast.error("จำนวนไม่ถูกต้อง");
                  return;
                }
                addAmt.mutate({ id: addMoneyId, amount: a });
              }}
              disabled={addAmt.isPending || !addMoneyAmount}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ----------------- RECURRING ----------------- */

function RecurringView({ currency, items, goals }: { currency: string; items: any[]; goals: any[] }) {
  const utils = trpc.useUtils();
  const { removingIds: removingRecurring, animateRemove: animateRemoveRecurring } = useRemovingIds();
  const CATS = useMergedCategories();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(CATEGORIES.expense[0]);
  const [note, setNote] = useState("");
  const [freq, setFreq] = useState<Freq>("monthly");
  const [nextDate, setNextDate] = useState<string>(tsToDateInput(Date.now()));

  useEffect(() => {
    if (!CATS[type].includes(category)) setCategory(CATS[type][0]);
  }, [type, category]);

  const create = trpc.recurring.create.useMutation({
    onMutate: async (vars) => {
      await utils.recurring.list.cancel();
      const prev = utils.recurring.list.getData();
      utils.recurring.list.setData(undefined, (old) => [
        ...(old ?? []),
        { id: Date.now(), ...vars, amount: String(vars.amount) } as any,
      ]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.recurring.list.setData(undefined, ctx.prev);
      toast.error("เพิ่มรายการประจำไม่สำเร็จ");
    },
    onSuccess: () => {
      toast.success("เพิ่มรายการประจำแล้ว");
      setOpen(false);
      setAmount("");
      setNote("");
    },
    onSettled: () => utils.recurring.list.invalidate(),
  });
  const remove = trpc.recurring.remove.useMutation({
    onMutate: async ({ id }) => {
      await utils.recurring.list.cancel();
      const prev = utils.recurring.list.getData();
      utils.recurring.list.setData(undefined, (old) => (old ?? []).filter((r) => r.id !== id));
      return { prev };
    },
    onError: async (_err, vars, ctx) => {
      const { succeeded, fresh } = await verifyDeleteSucceeded(
        () => utils.recurring.list.fetch(undefined, { staleTime: 0 }),
        vars.id,
      );
      if (succeeded) {
        utils.recurring.list.setData(undefined, fresh);
        toast.success("ลบแล้ว");
        return;
      }
      if (ctx?.prev) utils.recurring.list.setData(undefined, ctx.prev);
      toast.error("ลบรายการประจำไม่สำเร็จ");
    },
    onSuccess: () => toast.success("ลบแล้ว"),
    onSettled: () => utils.recurring.list.invalidate(),
  });
  const runNow = trpc.recurring.runNow.useMutation({
    onError: () => toast.error("บันทึกรายการไม่สำเร็จ"),
    onSuccess: () => toast.success("บันทึกรายการประจำงวดนี้แล้ว"),
    onSettled: () => {
      utils.recurring.list.invalidate();
      utils.transactions.list.invalidate();
    },
  });

  const monthlyTotal = useMemo(() => {
    return items.reduce((acc, r) => {
      const amt = toNumber(r.amount);
      const monthly =
        r.freq === "weekly" ? amt * 4.33 : r.freq === "yearly" ? amt / 12 : amt;
      if (r.type === "income") acc.income += monthly;
      else if (r.type === "expense") acc.expense += monthly;
      else acc.saving += monthly;
      return acc;
    }, { income: 0, expense: 0, saving: 0 });
  }, [items]);

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-3 mf-card">
          <div className="text-xs text-muted-foreground mb-1.5">ยอดรวมรายการประจำ (ต่อเดือน โดยประมาณ)</div>
          <div className="flex flex-wrap gap-3 text-sm font-semibold">
            <span className="text-emerald-500">+ {formatCurrency(monthlyTotal.income, currency)}</span>
            <span className="text-rose-500">- {formatCurrency(monthlyTotal.expense, currency)}</span>
            <span className="text-sky-500">⧠ {formatCurrency(monthlyTotal.saving, currency)}</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">รายการที่ต้องจ่าย/รับประจำ เช่น ค่าเช่า เงินเดือน</div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> เพิ่ม
        </Button>
      </div>
      {items.length === 0 ? (
        <Empty text="ยังไม่มีรายการประจำ" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((r) => {
            const due = Number(r.nextDate) <= Date.now();
            return (
              <div key={r.id} className={`rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card mf-list-item ${removingRecurring.has(r.id) ? "mf-card-removing" : ""}`}>
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">
                      {r.category || TYPE_LABEL[r.type as TxType]}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {TYPE_LABEL[r.type as TxType]} • {r.freq === "weekly" ? "สัปดาห์" : r.freq === "monthly" ? "เดือน" : "ปี"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold tabular-nums">{formatCurrency(toNumber(r.amount), currency)}</div>
                    <div className={`text-[11px] ${due ? "text-rose-500" : "text-muted-foreground"}`}>
                      ครบกำหนด {new Date(Number(r.nextDate)).toLocaleDateString("th-TH")}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant={due ? "default" : "outline"} className="flex-1" onClick={() => runNow.mutate({ id: r.id })}>
                    บันทึกงวดนี้
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => animateRemoveRecurring(r.id, () => remove.mutate({ id: r.id }))}>
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>รายการประจำ</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(["income", "expense", "saving"] as TxType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`mf-chip rounded-lg border px-2 py-2 text-sm font-medium ${
                    type === t ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground"
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <div>
              <Label>จำนวน</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>หมวด</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATS[type].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>โน้ต</Label>
              <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} className="resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>ความถี่</Label>
                <Select value={freq} onValueChange={(v) => setFreq(v as Freq)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">สัปดาห์</SelectItem>
                    <SelectItem value="monthly">เดือน</SelectItem>
                    <SelectItem value="yearly">ปี</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>งวดถัดไป</Label>
                <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              onClick={() =>
                create.mutate({
                  type,
                  amount: Number(amount),
                  category,
                  note: note || null,
                  freq,
                  nextDate: dateInputToTs(nextDate),
                })
              }
              disabled={!amount || create.isPending}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* เป้าหมาย — ย้ายมารวมไว้ในหน้ารายการประจำ โดยตีกรอบแยกชัดเจน */}
      <div className="rounded-2xl border-2 border-primary/25 bg-card/40 backdrop-blur-md p-3 space-y-2">
        <div className="flex items-center gap-2 px-1">
          <Target className="w-4 h-4 text-muted-foreground" />
          <div className="text-sm font-semibold">เป้าหมายการออม</div>
        </div>
        <GoalsView currency={currency} goals={goals} />
      </div>
    </div>
  );
}

/* ----------------- shared ----------------- */

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
