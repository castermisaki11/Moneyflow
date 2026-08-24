import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { useLocation } from "wouter";

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

const LOGIN_METHOD_LABEL: Record<string, string> = {
  discord: "Discord",
  google: "Google",
  password: "รหัสผ่าน",
};

/** Initials for the avatar circle — first grapheme of the name, or "?" */
function initial(name: string | null | undefined): string {
  const n = (name || "").trim();
  return n ? Array.from(n)[0].toUpperCase() : "?";
}

export function AccountView() {
  const me = trpc.auth.me.useQuery();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      sessionStorage.removeItem("moneyflow.pinUnlockedAt");
      sessionStorage.removeItem("moneyflow.pinUnlockedUserId");
      queryClient.clear();
      setLocation("/login", { replace: true });
    },
  });

  if (me.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> กำลังโหลด...
      </div>
    );
  }

  const user = me.data;
  if (!user) return null;

  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-4">
      {/* Profile header card */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-5 mf-card relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl pointer-events-none"
          style={{ background: "#6366f1", opacity: 0.15 }}
        />
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 shrink-0 rounded-full grid place-items-center text-xl font-bold text-white shadow-lg"
            style={{
              background: isAdmin
                ? "linear-gradient(135deg,#6366f1,#a855f7)"
                : "linear-gradient(135deg,#3b82f6,#06b6d4)",
            }}
          >
            {initial(user.name)}
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold truncate">{user.name || "(ไม่มีชื่อ)"}</div>
            <div className="text-sm text-muted-foreground truncate flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              {user.email || "—"}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                  isAdmin ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {isAdmin ? <ShieldCheck className="w-3 h-3" /> : <UserIcon className="w-3 h-3" />}
                {isAdmin ? "แอดมิน" : "ผู้ใช้ทั่วไป"}
              </span>
              {user.loginMethod && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
                  เข้าสู่ระบบด้วย {LOGIN_METHOD_LABEL[user.loginMethod] ?? user.loginMethod}
                </span>
              )}
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full sm:w-auto"
          disabled={logoutMutation.isPending}
          onClick={() => logoutMutation.mutate()}
        >
          {logoutMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
          ) : (
            <LogOut className="w-3.5 h-3.5 mr-1.5" />
          )}
          ออกจากระบบ
        </Button>
      </div>

      {/* Account details */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="text-sm font-semibold">ข้อมูลบัญชี</div>
        <ul className="divide-y divide-border/50 text-sm">
          <li className="flex items-start justify-between gap-3 py-2">
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" /> สมัครเมื่อ
            </span>
            <span className="text-right whitespace-nowrap">{fmtDate(user.createdAt)}</span>
          </li>
          <li className="flex items-start justify-between gap-3 py-2">
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <Clock className="w-3.5 h-3.5 shrink-0" /> เข้าสู่ระบบล่าสุด
            </span>
            <span className="text-right whitespace-nowrap">{fmtDate(user.lastSignedIn)}</span>
          </li>
          <li className="flex items-start justify-between gap-3 py-2">
            <span className="text-muted-foreground text-xs">ช่องทางเข้าสู่ระบบ</span>
            <span>{LOGIN_METHOD_LABEL[user.loginMethod ?? ""] ?? user.loginMethod ?? "—"}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
