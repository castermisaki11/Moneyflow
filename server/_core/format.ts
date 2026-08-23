// Small formatting helpers shared across telegram.ts, pacing.ts, scheduler.ts.
// Kept dependency-free (no imports from other _core modules) so nothing that
// needs these ever risks a circular import.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatMoney(n: number): string {
  const rounded = Math.round(n);
  return `${rounded.toLocaleString("th-TH")} บาท`;
}
