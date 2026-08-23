import { Button } from "@/components/ui/button";
import { AnimatedCurrency } from "@/components/shared/AnimatedCurrency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatCurrency,
  monthKey,
  startOfMonthTs,
  endOfMonthTs,
  toNumber,
} from "@/lib/money";
import { type Transaction } from "@/lib/types";
import { Download, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useMemo, useState } from "react";

interface MonthlyReportViewProps {
  currency: string;
  transactions: Transaction[];
}

function getAvailableMonths(transactions: Transaction[]): string[] {
  const keys = new Set<string>();
  const now = new Date();
  // always include last 12 months
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  transactions.forEach((t) => keys.add(monthKey(Number(t.occurredAt))));
  return Array.from(keys).sort().reverse();
}

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
}

export function MonthlyReportView({ currency, transactions }: MonthlyReportViewProps) {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);

  const months = useMemo(() => getAvailableMonths(transactions), [transactions]);

  const report = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const from = startOfMonthTs(new Date(y, m - 1, 1).getTime());
    const to = endOfMonthTs(new Date(y, m - 1, 1).getTime());

    const filtered = transactions.filter((t) => {
      const ts = Number(t.occurredAt);
      return ts >= from && ts <= to;
    });

    let income = 0, expense = 0, saving = 0;
    const catMap: Record<string, number> = {};

    for (const t of filtered) {
      const amt = toNumber(t.amount);
      if (t.type === "income") income += amt;
      else if (t.type === "expense") {
        expense += amt;
        const cat = t.category || "ไม่มีหมวดหมู่";
        catMap[cat] = (catMap[cat] || 0) + amt;
      } else if (t.type === "saving") saving += amt;
    }

    const top5 = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const expenseRatio = income > 0 ? (expense / income) * 100 : expense > 0 ? 100 : 0;
    const savingRatio = income > 0 ? (saving / income) * 100 : 0;
    const balance = income - expense - saving;

    const txCount = filtered.length;
    const avgExpense = txCount > 0 ? expense / filtered.filter((t) => t.type === "expense").length || 0 : 0;

    // Daily breakdown
    const dailyMap: Record<string, { income: number; expense: number; saving: number }> = {};
    for (const t of filtered) {
      const d = new Date(Number(t.occurredAt));
      const key = `${d.getDate()}`;
      if (!dailyMap[key]) dailyMap[key] = { income: 0, expense: 0, saving: 0 };
      const amt = toNumber(t.amount);
      if (t.type === "income") dailyMap[key].income += amt;
      else if (t.type === "expense") dailyMap[key].expense += amt;
      else dailyMap[key].saving += amt;
    }

    const daysInMonth = new Date(y, m, 0).getDate();

    return { income, expense, saving, balance, top5, expenseRatio, savingRatio, txCount, avgExpense, catMap, daysInMonth, dailyMap, filtered };
  }, [transactions, selectedMonth]);

  const exportReport = () => {
    const lines: string[] = [
      `รายงานสรุปประจำเดือน — ${monthLabel(selectedMonth)}`,
      `สกุลเงิน: ${currency}`,
      "",
      "=== ยอดรวม ===",
      `รายรับ:   ${formatCurrency(report.income, currency)}`,
      `รายจ่าย:  ${formatCurrency(report.expense, currency)}`,
      `ออม:      ${formatCurrency(report.saving, currency)}`,
      `คงเหลือ:  ${formatCurrency(report.balance, currency)}`,
      "",
      `อัตราส่วนรายจ่าย/รายรับ: ${report.expenseRatio.toFixed(1)}%`,
      `อัตราส่วนออม/รายรับ:      ${report.savingRatio.toFixed(1)}%`,
      `จำนวนรายการทั้งหมด: ${report.txCount}`,
      "",
      "=== Top 5 หมวดรายจ่าย ===",
      ...report.top5.map(([cat, amt], i) => `${i + 1}. ${cat}: ${formatCurrency(amt, currency)}`),
      "",
      "=== รายจ่ายแยกตามหมวด ===",
      ...Object.entries(report.catMap)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => `${cat}: ${formatCurrency(amt, currency)}`),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${selectedMonth}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const maxDayExpense = Math.max(...Object.values(report.dailyMap).map((d) => d.expense), 1);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">รายงานสรุปรายเดือน</div>
            <div className="text-xs text-muted-foreground">ยอดรวม / หมวดหมู่ / อัตราส่วน</div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((mk) => (
                  <SelectItem key={mk} value={mk}>{monthLabel(mk)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportReport}>
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "รายรับ", value: report.income, color: "#22c55e", icon: <TrendingUp className="w-4 h-4" /> },
          { label: "รายจ่าย", value: report.expense, color: "#ef4444", icon: <TrendingDown className="w-4 h-4" /> },
          { label: "ออม", value: report.saving, color: "#3b82f6", icon: <Wallet className="w-4 h-4" /> },
          { label: "คงเหลือ", value: report.balance, color: report.balance >= 0 ? "#a78bfa" : "#f97316", icon: <Wallet className="w-4 h-4" /> },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-3 mf-card">
            <div className="flex items-center gap-1.5 mb-1" style={{ color: card.color }}>
              {card.icon}
              <span className="text-xs font-medium">{card.label}</span>
            </div>
            <div className="text-base font-bold" style={{ color: card.color }}>
              <AnimatedCurrency value={card.value} currency={currency} colorPulse={false} />
            </div>
          </div>
        ))}
      </div>

      {/* Ratios + Top 5 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Ratio bars */}
        <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
          <div className="text-sm font-semibold mb-3">อัตราส่วน (เทียบรายรับ)</div>
          <div className="space-y-3">
            {[
              { label: "รายจ่าย", pct: report.expenseRatio, color: "#ef4444" },
              { label: "ออม", pct: report.savingRatio, color: "#3b82f6" },
              { label: "คงเหลือ", pct: report.income > 0 ? Math.max(0, (report.balance / report.income) * 100) : 0, color: "#a78bfa" },
            ].map((bar) => (
              <div key={bar.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{bar.label}</span>
                  <span className="tabular-nums">{bar.pct.toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${Math.min(100, bar.pct)}%`, background: bar.color }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between"><span>จำนวนรายการทั้งหมด</span><span>{report.txCount}</span></div>
            <div className="flex justify-between">
              <span>รายจ่ายเฉลี่ยต่อรายการ</span>
              <span className="tabular-nums">{formatCurrency(report.filtered.filter(t=>t.type==="expense").length > 0 ? report.expense / report.filtered.filter(t=>t.type==="expense").length : 0, currency)}</span>
            </div>
          </div>
        </div>

        {/* Top 5 categories */}
        <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
          <div className="text-sm font-semibold mb-3">Top 5 หมวดรายจ่าย</div>
          {report.top5.length === 0 ? (
            <div className="text-xs text-muted-foreground">ไม่มีรายจ่ายในเดือนนี้</div>
          ) : (
            <div className="space-y-2">
              {report.top5.map(([cat, amt], i) => {
                const pct = report.expense > 0 ? (amt / report.expense) * 100 : 0;
                const colors = ["#ef4444", "#f97316", "#eab308", "#6366f1", "#8b5cf6"];
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold w-4 text-center" style={{ color: colors[i] }}>
                          #{i + 1}
                        </span>
                        <span className="truncate max-w-[120px]">{cat}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground">{pct.toFixed(1)}%</span>
                        <span className="tabular-nums font-medium">{formatCurrency(amt, currency)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-[width] duration-700"
                        style={{ width: `${pct}%`, background: colors[i] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* All categories */}
      {Object.keys(report.catMap).length > 5 && (
        <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
          <div className="text-sm font-semibold mb-3">รายจ่ายทุกหมวดหมู่</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {Object.entries(report.catMap)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, amt]) => (
                <div key={cat} className="flex justify-between text-xs">
                  <span className="text-muted-foreground truncate">{cat}</span>
                  <span className="tabular-nums font-medium ml-2 shrink-0">{formatCurrency(amt, currency)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Daily expense heatmap */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
        <div className="text-sm font-semibold mb-3">รายจ่ายรายวัน</div>
        <div className="flex gap-0.5 flex-wrap">
          {Array.from({ length: report.daysInMonth }, (_, i) => {
            const day = String(i + 1);
            const d = report.dailyMap[day];
            const exp = d?.expense || 0;
            const opacity = exp > 0 ? Math.max(0.15, exp / maxDayExpense) : 0;
            return (
              <div
                key={day}
                className="relative group"
                style={{ width: "calc(100% / 31 - 2px)", minWidth: 20, minHeight: 32 }}
              >
                <div
                  className="w-full h-8 rounded transition-opacity"
                  style={{
                    background: exp > 0 ? `rgba(239,68,68,${opacity})` : "transparent",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                />
                <div className="text-[9px] text-center text-muted-foreground mt-0.5">{day}</div>
                {exp > 0 && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-popover border border-border text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    วันที่ {day}: {formatCurrency(exp, currency)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
          <div className="w-3 h-3 rounded" style={{ background: "rgba(239,68,68,0.15)" }} />
          <span>น้อย</span>
          <div className="w-3 h-3 rounded" style={{ background: "rgba(239,68,68,0.6)" }} />
          <span>ปานกลาง</span>
          <div className="w-3 h-3 rounded" style={{ background: "rgba(239,68,68,1)" }} />
          <span>มาก</span>
        </div>
      </div>
    </div>
  );
}
