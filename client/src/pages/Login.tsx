import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { POST_LOGIN_ROUTE } from "@shared/const";
import { loadLang, saveLang, t, type Lang } from "@/lib/loginI18n";

const DEV_PASSWORD = "Za0951807229";

export function LoginPage() {
  const [, setLocation] = useLocation();
  const [lang, setLang] = useState<Lang>(loadLang());
  const [devPassword, setDevPassword] = useState("");
  const [devLoading, setDevLoading] = useState(false);
  const { data: user, isLoading, isError } = trpc.auth.me.useQuery(undefined, {
    retry: 0,
    retryDelay: 0,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // If already authenticated (e.g. OAuth bounced back here with a valid
  // cookie), continue to the app immediately — no full-screen spinner flash.
  useEffect(() => {
    if (!isLoading && !isError && user) {
      setLocation(POST_LOGIN_ROUTE, { replace: true });
    }
  }, [isError, isLoading, setLocation, user]);

  // Surface OAuth errors passed back in the URL.
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

  const handleDemoLogin = () => {
    sessionStorage.removeItem("moneyflow.pinUnlockedUserId");
    sessionStorage.removeItem("moneyflow.pinUnlockedAt");
    window.location.assign("/api/auth/demo");
  };

  const handleDevLogin = async () => {
    if (devPassword !== DEV_PASSWORD) {
      toast.error("รหัสผ่านไม่ถูกต้อง");
      return;
    }
    setDevLoading(true);
    try {
      const res = await fetch("/api/auth/dev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: devPassword }),
        credentials: "include",
      });
      if (res.redirected) {
        sessionStorage.removeItem("moneyflow.pinUnlockedUserId");
        sessionStorage.removeItem("moneyflow.pinUnlockedAt");
        window.location.assign(res.url);
      } else if (!res.ok) {
        toast.error("เข้าสู่ระบบไม่สำเร็จ");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setDevLoading(false);
    }
  };

  const toggleLang = (l: Lang) => {
    setLang(l);
    saveLang(l);
  };

  // While the session check is still resolving, avoid a branded full-screen
  // spinner — once `user` resolves the effect above redirects at once.
  if (!isLoading && !isError && user) return null;

  const th = (key: Parameters<typeof t>[1]) => t(lang, key);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex items-center justify-center px-4 py-10">
      {/* Ambient orbs (same visual language as the app shell) */}
      <div className="mf-orb" style={{ top: -100, left: -80, width: 380, height: 380, background: "#6366f1" }} />
      <div className="mf-orb" style={{ bottom: -120, right: -60, width: 420, height: 420, background: "#d946ef" }} />

      {/* Language toggle */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-0.5 text-[11px] font-medium">
        <button
          type="button"
          onClick={() => toggleLang("th")}
          className={`rounded-full px-2.5 py-1 transition-colors ${lang === "th" ? "bg-white/15 text-white" : "text-slate-400 hover:text-slate-200"}`}
        >
          TH
        </button>
        <button
          type="button"
          onClick={() => toggleLang("en")}
          className={`rounded-full px-2.5 py-1 transition-colors ${lang === "en" ? "bg-white/15 text-white" : "text-slate-400 hover:text-slate-200"}`}
        >
          EN
        </button>
      </div>

      <section className="relative z-10 w-full max-w-sm mf-fade-in mf-pop">
        <div className="rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6 sm:p-8 shadow-2xl shadow-black/40 space-y-5">
          <div className="space-y-1.5 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center text-2xl font-bold shadow-lg shadow-fuchsia-500/30">
              ฿
            </div>
            <h2 className="text-xl font-bold text-white pt-2">{th("welcome")}</h2>
            <p className="text-xs text-slate-400">{th("welcomeSub")}</p>
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
              {th("discord")}
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
              {th("google")}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full h-11 rounded-xl border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 font-medium"
              onClick={handleDemoLogin}
            >
              <span className="mr-2">✨</span>
              {th("demo")}
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase">
              <span className="bg-white/[0.06] px-2 text-slate-500">Dev</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <input
              type="password"
              placeholder="รหัสผ่าน Dev"
              value={devPassword}
              onChange={(e) => setDevPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDevLogin()}
              className="w-full h-11 rounded-xl border border-white/15 bg-white/5 px-4 text-sm text-white placeholder-slate-500 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50"
              aria-label="รหัสผ่าน Dev"
            />
            <Button
              type="button"
              className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
              onClick={handleDevLogin}
              disabled={devLoading}
            >
              {devLoading ? "กำลังเข้าสู่ระบบ..." : "🔐 เข้าสู่ระบบ Dev"}
            </Button>
          </div>

          <p className="text-center text-[10px] leading-relaxed text-slate-500">
            {th("terms1")}
            <br />
            {th("terms2")}
          </p>
        </div>

        <div className="flex items-center justify-center gap-1.5 pt-4 text-[11px] text-slate-500">
          <span>MoneyFlow — Personal Finance Tracker with Telegram Bot</span>
        </div>
      </section>
    </div>
  );
}
