import { listBudgets, listTransactions } from "../db";
import { daysRemainingInMonth, periodRange } from "./bangkokTime";
import { escapeHtml, formatMoney } from "./format";

/**
 * Builds the "budget left ÷ days left in month" pacing message for a user,
 * one line per monthly budget. Returns null-safe text even with no budgets
 * set up (guides the user to Settings → Budgets instead of sending nothing).
 */
export async function buildPacingMessage(userId: number): Promise<string> {
  const list = await listBudgets(userId);
  const monthly = list.filter((b) => b.period === "monthly");
  if (monthly.length === 0) {
    return "ยังไม่ได้ตั้งงบรายเดือนไว้เลยครับ ตั้งได้ที่ ตั้งค่า → งบประมาณ ในแอปนะ 🙂";
  }

  const { from, to } = periodRange("monthly");
  const daysLeft = daysRemainingInMonth();
  const lines = ["📅 <b>เงินเหลือใช้ต่อวัน (เดือนนี้)</b>"];

  for (const b of monthly) {
    const txs = await listTransactions(userId, { from, to, type: "expense", category: b.category ?? undefined });
    const spent = txs.reduce((sum, t) => sum + Number(t.amount), 0);
    const limit = Number(b.limitAmount);
    const remaining = limit - spent;
    if (remaining <= 0) {
      lines.push(`${escapeHtml(b.category ?? "")}: ใช้เกินงบไปแล้ว ${formatMoney(Math.abs(remaining))}`);
    } else {
      const perDay = remaining / daysLeft;
      lines.push(
        `${escapeHtml(b.category ?? "")}: เหลือ ${formatMoney(remaining)} ÷ ${daysLeft} วัน ≈ ${formatMoney(perDay)}/วัน`,
      );
    }
  }
  return lines.join("\n");
}
