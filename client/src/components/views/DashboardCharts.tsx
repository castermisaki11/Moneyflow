import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
  LineChart, Line,
} from "recharts";
import { formatCurrency, toNumber, isSameMonth, startOfMonthTs, endOfMonthTs } from "@/lib/money";

const COLORS = ["#6366f1", "#a855f7", "#ec4899", "#f43f5e", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6"];

type Tx = { type: string; amount: string; category?: string | null; occurredAt: bigint | number };

function monthLabel(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString("th-TH", { month: "short" });
}

function useMonthlyStats(transactions: Tx[], months = 6) {
  return useMemo(() => {
    const now = Date.now();
    const result: { month: string; income: number; expense: number }[] = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const start = startOfMonthTs(d.getTime());
      const end = endOfMonthTs(d.getTime());

      let income = 0;
      let expense = 0;
      for (const tx of transactions) {
        const ts = Number(tx.occurredAt);
        if (ts >= start && ts <= end) {
          if (tx.type === "income") income += toNumber(tx.amount);
          else if (tx.type === "expense") expense += toNumber(tx.amount);
        }
      }
      result.push({ month: monthLabel(start), income, expense });
    }
    return result;
  }, [transactions, months]);
}

function useCategoryBreakdown(transactions: Tx[]) {
  return useMemo(() => {
    const now = Date.now();
    const map: Record<string, number> = {};

    for (const tx of transactions) {
      if (tx.type === "expense" && isSameMonth(Number(tx.occurredAt), now)) {
        const cat = tx.category || "อื่นๆ";
        map[cat] = (map[cat] || 0) + toNumber(tx.amount);
      }
    }

    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [transactions]);
}

function useBalanceTrend(transactions: Tx[], months = 6) {
  return useMemo(() => {
    const now = Date.now();
    let running = 0;
    // Calculate total balance from all time before the window
    for (const tx of transactions) {
      const ts = Number(tx.occurredAt);
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      if (ts < startOfMonthTs(d.getTime())) {
        if (tx.type === "income") running += toNumber(tx.amount);
        else if (tx.type === "expense") running -= toNumber(tx.amount);
        else if (tx.type === "saving") running -= toNumber(tx.amount);
      }
    }

    const result: { month: string; balance: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const start = startOfMonthTs(d.getTime());
      const end = endOfMonthTs(d.getTime());

      for (const tx of transactions) {
        const ts = Number(tx.occurredAt);
        if (ts >= start && ts <= end) {
          if (tx.type === "income") running += toNumber(tx.amount);
          else if (tx.type === "expense") running -= toNumber(tx.amount);
          else if (tx.type === "saving") running -= toNumber(tx.amount);
        }
      }
      result.push({ month: monthLabel(start), balance: running });
    }
    return result;
  }, [transactions, months]);
}

function ChartTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs">
      <div className="font-medium mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{formatCurrency(p.value, currency)}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardCharts({
  transactions,
  currency,
}: {
  transactions: Tx[];
  currency: string;
}) {
  const monthlyData = useMonthlyStats(transactions);
  const categoryData = useCategoryBreakdown(transactions);
  const balanceData = useBalanceTrend(transactions);

  const hasMonthly = monthlyData.some((d) => d.income > 0 || d.expense > 0);
  const hasCategories = categoryData.length > 0;

  if (!hasMonthly && !hasCategories) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13l3 3L22 4" /></svg>
          <span className="text-sm font-medium text-muted-foreground">ยังไม่มีข้อมูลสำหรับกราฟ</span>
        </div>
        <p className="text-xs text-muted-foreground">เพิ่มรายการเพื่อดูสถิติของคุณ</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bar Chart: Income vs Expense */}
      {hasMonthly && (
        <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
          <div className="text-sm font-semibold mb-3">รายรับ vs รายจ่าย</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={55} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <Tooltip content={<ChartTooltip currency={currency} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="income" name="รายรับ" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="รายจ่าย" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Pie Chart: Category breakdown */}
        {hasCategories && (
          <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
            <div className="text-sm font-semibold mb-3">สัดส่วนรายจ่าย</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={65}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => formatCurrency(Number(v), currency)}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {categoryData.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  {d.name}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Line Chart: Balance trend */}
        {balanceData.length > 1 && (
          <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
            <div className="text-sm font-semibold mb-3">แนวโน้มเงินคงเหลือ</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={balanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={55} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip content={<ChartTooltip currency={currency} />} />
                  <Line type="monotone" dataKey="balance" name="คงเหลือ" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: "#6366f1" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
