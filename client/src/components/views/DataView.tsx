import { Button } from "@/components/ui/button";
import { formatCurrency, toNumber, tsToDateInput } from "@/lib/money";
import {
  type Transaction,
  type Budget,
  type Goal,
  type WishItem,
  type Recurring,
  type TxType,
} from "@/lib/types";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, Download, FileText, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

interface DataViewProps {
  currency: string;
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  wishlist: WishItem[];
  recurring: Recurring[];
}

interface ImportPreview {
  valid: ParsedRow[];
  skipped: { row: number; reason: string }[];
}

interface ParsedRow {
  type: TxType;
  amount: number;
  category: string | null;
  note: string | null;
  occurredAt: number;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      result.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function csvCell(val: string | number | null | undefined): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function DataView({ currency, transactions, budgets, goals, wishlist, recurring }: DataViewProps) {
  const utils = trpc.useUtils();
  const createTx = trpc.transactions.create.useMutation();
  const importInput = useRef<HTMLInputElement | null>(null);
  const csvImportInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMode, setImportMode] = useState<"json" | "csv" | null>(null);

  const triggerDownload = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportJson = () => {
    const payload = { exportedAt: new Date().toISOString(), currency, transactions, budgets, goals, wishlist, recurring };
    triggerDownload(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `moneyflow-${Date.now()}.json`);
  };

  const exportCsv = () => {
    const header = ["id", "type", "amount", "category", "note", "occurredAt", "date"].join(",");
    const rows = transactions.map((t) =>
      [t.id, t.type, toNumber(t.amount), csvCell(t.category), csvCell(t.note), new Date(Number(t.occurredAt)).toISOString(), tsToDateInput(Number(t.occurredAt))].join(","),
    );
    triggerDownload(new Blob(["\uFEFF" + [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" }), `moneyflow-transactions-${Date.now()}.csv`);
  };

  const parseCsv = async (file: File): Promise<ImportPreview> => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { valid: [], skipped: [{ row: 0, reason: "ไฟล์ว่างหรือมีแค่หัวตาราง" }] };
    const rawHeader = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\ufeff/g, ""));
    const getIdx = (...names: string[]) => { for (const n of names) { const i = rawHeader.indexOf(n); if (i >= 0) return i; } return -1; };
    const iType = getIdx("type", "ประเภท");
    const iAmt = getIdx("amount", "จำนวน", "จำนวนเงิน");
    const iCat = getIdx("category", "หมวดหมู่");
    const iNote = getIdx("note", "โน้ต", "หมายเหตุ");
    const iDate = getIdx("occurredat", "date", "วันที่");
    if (iType < 0 || iAmt < 0) return { valid: [], skipped: [{ row: 0, reason: `ไม่พบคอลัมน์ที่จำเป็น (type, amount) — พบ: ${rawHeader.join(", ")}` }] };
    const valid: ParsedRow[] = [];
    const skipped: { row: number; reason: string }[] = [];
    const typeMap: Record<string, TxType> = { income: "income", รายรับ: "income", expense: "expense", รายจ่าย: "expense", saving: "saving", ออม: "saving" };
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const type = typeMap[(cols[iType] ?? "").trim().toLowerCase()];
      if (!type) { skipped.push({ row: i + 1, reason: `type "${cols[iType]}" ไม่รู้จัก` }); continue; }
      const amt = parseFloat((cols[iAmt] ?? "").replace(/,/g, ""));
      if (!amt || amt <= 0) { skipped.push({ row: i + 1, reason: `amount "${cols[iAmt]}" ไม่ถูกต้อง` }); continue; }
      let occurredAt = Date.now();
      if (iDate >= 0 && cols[iDate]) { const p = new Date(cols[iDate].trim()).getTime(); if (!isNaN(p)) occurredAt = p; }
      valid.push({ type, amount: amt, category: iCat >= 0 ? (cols[iCat] || null) : null, note: iNote >= 0 ? (cols[iNote] || null) : null, occurredAt });
    }
    return { valid, skipped };
  };

  const handleCsvFile = async (file: File) => {
    setBusy(true);
    try { const result = await parseCsv(file); setPreview(result); setImportMode("csv"); }
    catch { toast.error("อ่านไฟล์ CSV ไม่สำเร็จ"); }
    finally { setBusy(false); }
  };

  const handleJsonFile = async (file: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      const txArr = Array.isArray(data?.transactions) ? data.transactions : [];
      const valid: ParsedRow[] = []; const skipped: { row: number; reason: string }[] = [];
      txArr.forEach((t: any, idx: number) => {
        if (!["income", "expense", "saving"].includes(t.type)) { skipped.push({ row: idx + 1, reason: `type "${t.type}" ไม่รู้จัก` }); return; }
        const amt = toNumber(t.amount);
        if (amt <= 0) { skipped.push({ row: idx + 1, reason: "amount ไม่ถูกต้อง" }); return; }
        valid.push({ type: t.type, amount: amt, category: t.category || null, note: t.note || null, occurredAt: Number(t.occurredAt) || Date.now() });
      });
      setPreview({ valid, skipped }); setImportMode("json");
    } catch { toast.error("ไฟล์ JSON ไม่ถูกต้อง"); }
    finally { setBusy(false); }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      let ok = 0;
      for (const row of preview.valid) {
        await createTx.mutateAsync({ type: row.type, amount: row.amount, category: row.category ?? null, note: row.note ?? null, occurredAt: row.occurredAt });
        ok++;
      }
      utils.transactions.list.invalidate();
      toast.success(`นำเข้า ${ok} รายการสำเร็จ`);
      setPreview(null); setImportMode(null);
    } catch { toast.error("นำเข้าไม่สำเร็จ"); }
    finally { setBusy(false); }
  };

  if (preview) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">ตรวจสอบก่อนนำเข้า ({importMode?.toUpperCase()})</span>
        </div>
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-green-500">
            <CheckCircle2 className="w-4 h-4" />
            <span>{preview.valid.length} รายการพร้อมนำเข้า</span>
          </div>
          {preview.skipped.length > 0 && (
            <div className="flex items-center gap-1.5 text-amber-500">
              <AlertCircle className="w-4 h-4" />
              <span>{preview.skipped.length} แถวถูกข้าม</span>
            </div>
          )}
        </div>
        {preview.valid.length > 0 && (
          <div className="overflow-auto max-h-48 rounded-lg border border-border/50">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 text-left">ประเภท</th>
                  <th className="p-2 text-right">จำนวน</th>
                  <th className="p-2 text-left">หมวดหมู่</th>
                  <th className="p-2 text-left">วันที่</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {preview.valid.slice(0, 50).map((row, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${row.type === "income" ? "bg-green-500/15 text-green-400" : row.type === "expense" ? "bg-red-500/15 text-red-400" : "bg-blue-500/15 text-blue-400"}`}>
                        {row.type === "income" ? "รายรับ" : row.type === "expense" ? "รายจ่าย" : "ออม"}
                      </span>
                    </td>
                    <td className="p-2 text-right tabular-nums">{formatCurrency(row.amount, currency)}</td>
                    <td className="p-2 text-muted-foreground truncate max-w-[120px]">{row.category || "—"}</td>
                    <td className="p-2 text-muted-foreground">{tsToDateInput(row.occurredAt)}</td>
                  </tr>
                ))}
                {preview.valid.length > 50 && (
                  <tr><td colSpan={4} className="p-2 text-center text-muted-foreground">...และอีก {preview.valid.length - 50} รายการ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {preview.skipped.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-amber-500 hover:text-amber-400">ดูแถวที่ถูกข้าม ({preview.skipped.length})</summary>
            <ul className="mt-1 space-y-0.5 text-muted-foreground pl-3">
              {preview.skipped.slice(0, 10).map((s, i) => <li key={i}>แถว {s.row}: {s.reason}</li>)}
              {preview.skipped.length > 10 && <li>...และอีก {preview.skipped.length - 10} แถว</li>}
            </ul>
          </details>
        )}
        <div className="flex gap-2">
          <Button onClick={confirmImport} disabled={busy || preview.valid.length === 0}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            นำเข้า {preview.valid.length} รายการ
          </Button>
          <Button variant="outline" onClick={() => { setPreview(null); setImportMode(null); }} disabled={busy}>ยกเลิก</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
        <div className="text-sm font-semibold mb-1">Export</div>
        <div className="text-xs text-muted-foreground mb-3">ดาวน์โหลดข้อมูลทั้งหมด (รายการ / งบ / เป้าหมาย / Wishlist / รายการประจำ)</div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={exportJson} variant="default"><Download className="w-4 h-4 mr-1" /> JSON (ทั้งหมด)</Button>
          <Button onClick={exportCsv} variant="outline"><Download className="w-4 h-4 mr-1" /> CSV (รายการ)</Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">CSV รองรับ Excel — เปิดตรงได้โดยไม่ต้องแปลง encoding (มี BOM UTF-8)</p>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
        <div className="text-sm font-semibold mb-1">Import JSON</div>
        <div className="text-xs text-muted-foreground mb-3">นำเข้ารายการจากไฟล์ JSON ที่ Export ไว้ — แสดง preview ก่อนยืนยัน</div>
        <input type="file" ref={importInput} accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) handleJsonFile(f); }} />
        <Button onClick={() => importInput.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
          เลือกไฟล์ JSON
        </Button>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card md:col-span-2">
        <div className="text-sm font-semibold mb-1">Import CSV</div>
        <div className="text-xs text-muted-foreground mb-3">
          นำเข้ารายการจากไฟล์ CSV — ต้องมีคอลัมน์ <code className="bg-muted px-1 rounded">type</code>, <code className="bg-muted px-1 rounded">amount</code> และแนะนำให้มี <code className="bg-muted px-1 rounded">date</code>, <code className="bg-muted px-1 rounded">category</code>, <code className="bg-muted px-1 rounded">note</code>
        </div>
        <div className="flex items-start gap-6 flex-wrap">
          <div>
            <input type="file" ref={csvImportInput} accept="text/csv,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) handleCsvFile(f); }} />
            <Button onClick={() => csvImportInput.current?.click()} disabled={busy} variant="outline">
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
              เลือกไฟล์ CSV
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            <div className="font-medium mb-0.5">ตัวอย่าง header:</div>
            <code className="bg-muted px-1.5 py-0.5 rounded block">type,amount,category,note,date</code>
            <div className="mt-0.5">type: income / expense / saving</div>
            <div>date: YYYY-MM-DD หรือ ISO 8601</div>
          </div>
        </div>
      </div>
    </div>
  );
}
