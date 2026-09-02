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

  const pad = (n: number) => String(n);
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

      </DialogContent>
    </Dialog>
  );
}
