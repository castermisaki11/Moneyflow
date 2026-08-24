import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  BarChart3,
  Bell,
  Coins,
  MessageCircle,
  Sparkles,
  Target,
} from "lucide-react";

/** Feature bullets shown beside the sign-in card */
const FEATURES = [
  {
    icon: <MessageCircle className="w-4 h-4" />,
    title: "บันทึกผ่าน Telegram",
    text: "พิมพ์ \"กาแฟ 60\" — bot เดาหมวดให้เอง แนบสลิปรูปได้",
  },
  {
    icon: <BarChart3 className="w-4 h-4" />,
    title: "สรุปทุกวัน",
    text: "รายรับ–รายจ่าย–ออม เห็นยอดคงเหลือแบบเรียลไทม์",
  },
  {
    icon: <Coins className="w-4 h-4" />,
    title: "งบประมาณ + เป้าหมาย",
    text: "ตั้งเพดานรายจ่าย ไล่เป้าออม รู้ทันก่อนเกินมือ",
  },
  {
    icon: <Bell className="w-4 h-4" />,
    title: "แจ้งเตือนอัตโนมัติ",
    text: "เตือนบันทึกรายการ งบเกิน รายการประจำครบกำหนด",
  },
];

export function LoginPage() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading, isError } = trpc.auth.me.useQuery(undefined, {
    retry: 1,
    retryDelay: 500,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // If OAuth returned to /login for any reason after setting the cookie,
  // immediately continue to the account instead of making the user press Back.
  useEffect(() => {
    if (!isLoading && !isError && user) {
      setLocation("/", { replace: true });
    }
  }, [isError, isLoading, setLocation, user]);

  // Check for OAuth errors in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      const errorMessages: Record<string, string> = {
        denied: "Login was denied",
        invalid_params: "Invalid OAuth parameters",
        invalid_state: "Invalid session state. Please try again.",
        oauth_init: "Failed to initiate login",
        oauth_callback: "Failed to complete login",
      };
      toast.error(errorMessages[error] || "An error occurred during login");
      // Clear the error from URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Shared entry point for any OAuth provider — the server route is
  // /api/auth/<provider> for every provider registered in
  // server/_core/oauthProviders.ts, so a new provider only needs a new
  // button below, not a new handler.
  const handleOAuthLogin = (provider: string) => {
    sessionStorage.removeItem("moneyflow.pinUnlockedUserId");
    sessionStorage.removeItem("moneyflow.pinUnlockedAt");
    window.location.assign(`/api/auth/${provider}`);
  };

  if (!isLoading && !isError && user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <Spinner className="h-8 w-8 text-white" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      {/* Ambient orbs (same visual language as the app shell) */}
      <div className="mf-orb" style={{ top: -100, left: -80, width: 380, height: 380, background: "#6366f1" }} />
      <div className="mf-orb" style={{ bottom: -120, right: -60, width: 420, height: 420, background: "#d946ef" }} />
      <div className="mf-orb" style={{ top: "40%", left: "55%", width: 240, height: 240, background: "#f59e0b", opacity: 0.35 }} />

      <div className="relative z-10 min-h-screen max-w-5xl mx-auto px-4 py-10 sm:py-16 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
        {/* ── Brand / hero side ── */}
        <section className="mf-fade-in space-y-6 text-white">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center text-xl font-bold shadow-xl shadow-indigo-500/30">
              ฿
            </div>
            <span className="text-xl font-bold mf-gradient-text">MoneyFlow</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight">
            เงินไหลไปไหน
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
              รู้ทันในไม่กี่วินาที
            </span>
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-md leading-relaxed">
            ผู้ช่วยจัดการการเงินส่วนตัวที่บันทึกได้จาก Telegram สรุปยอดอัตโนมัติ
            ตั้งงบ เป้าหมายออมเงิน และเตือนคุณก่อนเงินหาย
          </p>

          <ul className="space-y-3.5 pt-1">
            {FEATURES.map((f, i) => (
              <li
                key={f.title}
                className="mf-list-item flex items-start gap-3"
                style={{ animationDelay: `${0.08 * i}s` }}
              >
                <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-white/10 border border-white/10 grid place-items-center text-indigo-300 backdrop-blur-sm">
                  {f.icon}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{f.title}</span>
                  <span className="block text-xs text-slate-400">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-500">
            <Sparkles className="w-3.5 h-3.5" />
            ธีมได้ 3 แบบ — สว่าง · มืด · ดำทอง
          </p>
        </section>

        {/* ── Sign-in card ── */}
        <section className="mf-fade-in mf-pop" style={{ animationDelay: "0.15s" }}>
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6 sm:p-8 shadow-2xl shadow-black/40 space-y-5">
            <div className="space-y-1.5 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center text-2xl font-bold shadow-lg shadow-fuchsia-500/30">
                ฿
              </div>
              <h2 className="text-xl font-bold text-white pt-2">ยินดีต้อนรับ</h2>
              <p className="text-xs text-slate-400">
                เข้าสู่ระบบเพื่อเริ่มจัดการเงินของคุณ — ฟรี ไม่จำกัดรายการ
              </p>
            </div>

            <div className="space-y-2.5">
              <Button
                type="button"
                className="w-full h-11 bg-[#5865F2] hover:bg-[#4752c4] text-white font-medium rounded-xl"
                onClick={() => handleOAuthLogin("discord")}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.3671a19.8062 19.8062 0 00-4.885-1.515.0741.0741 0 00-.0785.0371c-.211.3671-.445.8447-.608 1.2321a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.2288.077.077 0 00-.079-.037 19.7896 19.7896 0 00-4.885 1.515.0699.0699 0 00-.032.0274C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.0605 19.9384 19.9384 0 005.993 3.03.0784.0784 0 00.085-.027 14.285 14.285 0 001.146-1.861.076.076 0 00-.042-.106 13.1917 13.1917 0 01-1.871-.892.077.077 0 01-.008-.128 10.2457 10.2457 0 00.372-.294.075.075 0 01.078-.01c3.928 1.793 8.18 1.793 12.062 0a.075.075 0 01.079.009c.12.098.246.198.373.295a.077.077 0 01-.006.127 13.22 13.22 0 01-1.871.892.077.077 0 00-.041.107c.36.698.772 1.362 1.146 1.861a.077.077 0 00.085.028 19.963 19.963 0 005.993-3.03.077.077 0 00.032-.06c.5-4.467.151-8.35-.882-12.087a.077.077 0 00-.031-.028zM8.02 15.3312c-1.044 0-1.9-1.005-1.9-2.247 0-1.242.84-2.247 1.9-2.247 1.062 0 1.919 1.005 1.9 2.247 0 1.242-.84 2.247-1.9 2.247zm7.973 0c-1.044 0-1.9-1.005-1.9-2.247 0-1.242.84-2.247 1.9-2.247 1.062 0 1.919 1.005 1.9 2.247 0 1.242-.837 2.247-1.9 2.247z" />
                </svg>
                เข้าสู่ระบบด้วย Discord
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full h-11 rounded-xl bg-white text-slate-800 hover:bg-slate-100 border-white/60 font-medium"
                onClick={() => handleOAuthLogin("google")}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.645h6.458a5.52 5.52 0 01-2.395 3.622v3.01h3.878c2.269-2.09 3.578-5.166 3.578-8.822z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.956-1.075 7.941-2.905l-3.878-3.01c-1.075.72-2.45 1.147-4.063 1.147-3.126 0-5.77-2.11-6.716-4.946H1.278v3.107C3.253 21.31 7.31 24 12 24z" />
                  <path fill="#FBBC05" d="M5.284 14.286a7.23 7.23 0 010-4.573V6.606H1.278a11.996 11.996 0 000 10.787l4.006-3.107z" />
                  <path fill="#EA4335" d="M12 4.773c1.762 0 3.344.606 4.59 1.796l3.442-3.442C17.951 1.19 15.236 0 12 0 7.31 0 3.253 2.69 1.278 6.606l4.006 3.107C6.23 6.877 8.874 4.773 12 4.773z" />
                </svg>
                เข้าสู่ระบบด้วย Google
              </Button>
            </div>

            <p className="text-center text-[10px] leading-relaxed text-slate-500">
              เข้าสู่ระบบถือว่าคุณยอมรับเงื่อนไขการใช้งาน
              <br />
              ข้อมูลของคุณเป็นส่วนตัว — เห็นได้เฉพาะบัญชีคุณเท่านั้น
            </p>
          </div>

          <div className="flex items-center justify-center gap-1.5 pt-4 text-[11px] text-slate-500">
            <Target className="w-3.5 h-3.5" />
            MoneyFlow — Personal Finance Tracker with Telegram Bot
          </div>
        </section>
      </div>
    </div>
  );
}
