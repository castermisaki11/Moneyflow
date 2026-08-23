import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** true if a PIN is already set (asks for current PIN first) */
  pinEnabled: boolean;
  /** "set" = ตั้ง/เปลี่ยน PIN, "disable" = ปิดการล็อก */
  mode: "set" | "disable";
};

type Step = "current" | "new" | "confirm";

export default function PinSetupDialog({ open, onOpenChange, pinEnabled, mode }: Props) {
  const utils = trpc.useUtils();
  const [step, setStep] = useState<Step>(pinEnabled && mode === "set" ? "current" : "current");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setError(null);
    setStep(pinEnabled ? "current" : "new");
  }, [open, pinEnabled, mode]);

  const setPin = trpc.security.setPin.useMutation({
    onSuccess: () => {
      toast.success(pinEnabled ? "เปลี่ยนรหัส PIN แล้ว" : "ตั้งรหัส PIN แล้ว — ล็อกหน้าเว็บเปิดใช้งาน");
      utils.security.status.invalidate();
      onOpenChange(false);
    },
    onError: (err) => setError(err.message || "เกิดข้อผิดพลาด"),
  });

  const disablePin = trpc.security.disablePin.useMutation({
    onSuccess: () => {
      toast.success("ปิดการล็อกด้วย PIN แล้ว");
      utils.security.status.invalidate();
      onOpenChange(false);
    },
    onError: (err) => setError(err.message || "รหัส PIN ไม่ถูกต้อง"),
  });

  const title = mode === "disable" ? "ปิดการล็อกด้วย PIN" : pinEnabled ? "เปลี่ยนรหัส PIN" : "ตั้งรหัส PIN";

  const handleCurrentComplete = (value: string) => {
    setError(null);
    if (mode === "disable") {
      disablePin.mutate({ currentPin: value });
      return;
    }
    setCurrentPin(value);
    setStep("new");
  };

  const handleNewComplete = (value: string) => {
    setError(null);
    setNewPin(value);
    setStep("confirm");
  };

  const handleConfirmComplete = (value: string) => {
    setError(null);
    if (value !== newPin) {
      setError("รหัส PIN ไม่ตรงกัน ลองใหม่อีกครั้ง");
      setNewPin("");
      setConfirmPin("");
      setStep("new");
      return;
    }
    setConfirmPin(value);
    setPin.mutate({ pin: value, currentPin: pinEnabled ? currentPin : undefined });
  };

  const isPending = setPin.isPending || disablePin.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="text-xs text-muted-foreground text-center">
            {step === "current" && "ใส่รหัส PIN ปัจจุบัน"}
            {step === "new" && "ตั้งรหัส PIN ใหม่ (4-6 หลัก)"}
            {step === "confirm" && "พิมพ์รหัส PIN อีกครั้งเพื่อยืนยัน"}
          </div>

          {step === "current" && (
            <InputOTP maxLength={6} value={currentPin} onChange={setCurrentPin} onComplete={handleCurrentComplete} disabled={isPending}>
              <InputOTPGroup>
                {Array.from({ length: 6 }).map((_, i) => <InputOTPSlot key={i} index={i} />)}
              </InputOTPGroup>
            </InputOTP>
          )}
          {step === "new" && (
            <InputOTP maxLength={6} value={newPin} onChange={setNewPin} onComplete={handleNewComplete} disabled={isPending}>
              <InputOTPGroup>
                {Array.from({ length: 6 }).map((_, i) => <InputOTPSlot key={i} index={i} />)}
              </InputOTPGroup>
            </InputOTP>
          )}
          {step === "confirm" && (
            <InputOTP maxLength={6} value={confirmPin} onChange={setConfirmPin} onComplete={handleConfirmComplete} disabled={isPending}>
              <InputOTPGroup>
                {Array.from({ length: 6 }).map((_, i) => <InputOTPSlot key={i} index={i} />)}
              </InputOTPGroup>
            </InputOTP>
          )}

          {(step === "current" || step === "new") && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending || (step === "current" ? currentPin.length < 4 : newPin.length < 4)}
              onClick={() => (step === "current" ? handleCurrentComplete(currentPin) : handleNewComplete(newPin))}
            >
              ถัดไป
            </Button>
          )}
          {step === "confirm" && (
            <Button size="sm" disabled={isPending || confirmPin.length < 4} onClick={() => handleConfirmComplete(confirmPin)}>
              ยืนยัน
            </Button>
          )}

          {error && <div className="text-xs text-destructive text-center">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={isPending}>
            ยกเลิก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
