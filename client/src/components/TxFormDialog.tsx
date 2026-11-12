import { useState, useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, TYPE_LABEL, TxType, dateInputToTs, tsToDateInput } from "@/lib/money";
import { trpc } from "@/lib/trpc";
import { Loader2, WifiOff } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { OutlineButton } from "@/components/ui/OutlineButton";

import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialType?: TxType;
  categories?: typeof CATEGORIES;
};

export default function TxFormDialog({ open, onOpenChange, initialType = "expense", categories: CATS = CATEGORIES }: Props) {
  const utils = trpc.useUtils();
  const [type, setType] = useState<TxType>(initialType);
  const [amount, setAmount] = useState<string>("");
  const [category, setCategory] = useState<string>(CATS[initialType][0]);
  const [note, setNote] = useState<string>("");
  const [date, setDate] = useState<string>(tsToDateInput(Date.now()));
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Track online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setType(initialType);
      setAmount("");
      setCategory(CATS[initialType][0]);
      setNote("");
      setDate(tsToDateInput(Date.now()));
    }
  }, [open, initialType]);

  useEffect(() => {
    // keep category valid when type changes
    if (!CATS[type].includes(category)) {
      setCategory(CATS[type][0]);
    }
  }, [type, category]);

  const create = trpc.transactions.create.useMutation({
    onMutate: async (vars) => {
      await utils.transactions.list.cancel();
      const prev = utils.transactions.list.getData();
      utils.transactions.list.setData(undefined, (old) => [
        ...(old ?? []),
        {
          id: Date.now(),
          type: vars.type,
          amount: String(vars.amount),
          category: vars.category ?? null,
          note: vars.note ?? null,
          occurredAt: BigInt(vars.occurredAt ?? Date.now()),
        } as any,
      ]);
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) utils.transactions.list.setData(undefined, ctx.prev);
      toast.error(e.message || "บันทึกไม่สำเร็จ");
    },
    onSuccess: (data) => {
      // SW returns { id: -timestamp } when queued offline
      const isQueued = typeof data?.id === "number" && data.id < 0;
      if (isQueued) {
        toast("บันทึกชั่วคราว — จะ sync เมื่อออนไลน์", {
          description: "รายการจะถูกส่งไปยังเซิร์ฟเวอร์อัตโนมัติ",
          icon: <WifiOff size={16} />,
          duration: 5000,
        });
      } else {
        toast.success("บันทึกรายการแล้ว");
      }
      onOpenChange(false);
    },
    onSettled: (_data, _err, _vars, ctx: any) => {
      // Skip invalidation if we know it's an offline-queued item
      // (the SW will send TX_SYNCED to trigger refetch later)
      const isQueued = _data && typeof (_data as any).id === "number" && (_data as any).id < 0;
      if (!isQueued) {
        utils.transactions.list.invalidate();
        utils.goals.list.invalidate();
        utils.budgets.list.invalidate();
      }
    },
  });

  const submit = () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("กรุณาใส่จำนวนเงินที่ถูกต้อง");
      return;
    }
    create.mutate({
      type,
      amount: amt,
      category: category || null,
      note: note || null,
      occurredAt: dateInputToTs(date),
    });
  };

  const quickAmounts = [20, 50, 100, 200, 500, 1000];


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100vw-1.25rem)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-4 sm:p-6 card">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg flex items-center gap-2">
            เพิ่มรายการ
            {!isOnline && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500">
                <WifiOff size={10} />
                ออฟไลน์
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* ประเภท: รายรับ / รายจ่าย / ออม */}
          <div className="grid grid-cols-3 gap-2">
            {(["income", "expense", "saving"] as TxType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`mf-chip rounded-lg border px-2 py-2 text-sm font-medium ${
                  type === t
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "border-border text-muted-foreground"
                }`}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          {/* จำนวนเงิน */}
          <div className="space-y-1.5">
            <Label>จำนวนเงิน</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {quickAmounts.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmount(String((Number(amount) || 0) + q))}
                  className="mf-chip rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                >
                  +{q.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {/* หมวดหมู่ */}
          <div className="space-y-1.5">
            <Label>หมวดหมู่</Label>
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

          {/* โน้ต */}
          <div className="space-y-1.5">
            <Label>โน้ต (ไม่บังคับ)</Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ข้าวกลางวัน"
              className="resize-none"
            />
          </div>

          {/* วันที่ */}
          <div className="space-y-1.5">
            <Label>วันที่</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <OutlineButton type="button" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </OutlineButton>
          <PrimaryButton type="button" onClick={submit} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "บันทึก"}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
