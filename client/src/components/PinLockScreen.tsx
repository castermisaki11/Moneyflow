import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { trpc } from "@/lib/trpc";
import { Lock, LogOut } from "lucide-react";
import { useState } from "react";

type Props = {
  onUnlocked: () => void;
};

export default function PinLockScreen({ onUnlocked }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logout = trpc.auth.logout.useMutation();

  const verify = trpc.security.verifyPin.useMutation({
    onSuccess: (res) => {
      if (res.valid) {
        onUnlocked();
      } else {
        setError("รหัส PIN ไม่ถูกต้อง");
        setPin("");
      }
    },
    onError: (err) => {
      setError(err.message || "ลองผิดหลายครั้งเกินไป กรุณารอสักครู่");
      setPin("");
    },
  });

  const handleComplete = (value: string) => {
    setError(null);
    verify.mutate({ pin: value });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 bg-background">
      <div className="flex flex-col items-center gap-2">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Lock className="w-5 h-5 text-primary" />
        </div>
        <div className="text-sm font-semibold">ใส่รหัส PIN เพื่อเข้าใช้งาน</div>
        <div className="text-xs text-muted-foreground">MoneyFlow ถูกล็อกไว้เพื่อความเป็นส่วนตัว</div>
      </div>

      <InputOTP
        maxLength={6}
        value={pin}
        onChange={(v) => {
          setPin(v);
          setError(null);
        }}
        onComplete={handleComplete}
        disabled={verify.isPending}
      >
        <InputOTPGroup>
          {Array.from({ length: 6 }).map((_, i) => (
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>

      {error && <div className="text-xs text-destructive -mt-3">{error}</div>}

      {pin.length >= 4 && pin.length < 6 && (
        <Button size="sm" onClick={() => handleComplete(pin)} disabled={verify.isPending}>
          ยืนยัน
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground"
         onClick={() =>
           logout.mutate(undefined, {
             onSuccess: () => {
               sessionStorage.removeItem("moneyflow.pinUnlockedUserId");
               sessionStorage.removeItem("moneyflow.pinUnlockedAt");
               window.location.replace("/login");
             },
           })
         }
      >
        <LogOut className="w-3.5 h-3.5 mr-1.5" /> ออกจากระบบ
      </Button>
    </div>
  );
}
