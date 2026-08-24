import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import PinLockScreen from "./components/PinLockScreen";
import { ThemeProvider } from "./contexts/ThemeContext";
import { usePinLock } from "./hooks/usePinLock";
import { useLiveSync } from "./hooks/useLiveSync";
import MoneyFlow from "./pages/MoneyFlow";
import { LoginPage } from "./pages/Login";
import { trpc } from "@/lib/trpc";
import { Spinner } from "@/components/ui/spinner";
import { useEffect } from "react";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: user, isLoading, isError } = trpc.auth.me.useQuery(undefined, {
    retry: 1,
    retryDelay: 500,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const [location, setLocation] = useLocation();
  const pinLock = usePinLock(user?.id);
  // เปิดฟัง real-time sync event ทันทีที่ login แล้ว (ก่อน early return ด้านล่าง
  // เพื่อไม่ให้ผิดกฎ Rules of Hooks) — ให้ผลทันทีเมื่อ bot เพิ่ม/แก้รายการ
  useLiveSync(!!user && !isError);

  // เปลี่ยนหน้าใน effect แทนการทำระหว่าง render และใช้ replace เพื่อไม่ให้
  // หน้า login ที่เกิดจากการเช็ค session ชั่วคราวค้างอยู่ใน back stack
  useEffect(() => {
    if (!isLoading && (!user || isError) && location !== "/login") {
      setLocation("/login", { replace: true });
    }
  }, [isError, isLoading, location, setLocation, user]);

  // รอทั้งสถานะ login และสถานะ PIN lock ก่อน — กันไม่ให้ข้อมูลกระพริบให้เห็นก่อนเช็ค PIN เสร็จ
  if (isLoading || (!isError && user && pinLock.isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!user || isError) {
    return null;
  }

  // มี user แล้ว แต่ตั้ง PIN lock ไว้และยังไม่ได้ปลดล็อกรอบนี้
  if (pinLock.locked) {
    return <PinLockScreen onUnlocked={pinLock.unlock} />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/" component={() => <ProtectedRoute component={MoneyFlow} />} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const utils = trpc.useUtils();

  // Telegram Mini App: when the app is opened from inside Telegram, use the
  // signed initData to log in automatically (server verifies it against the
  // bot token and matches the linked account), then reload so the session
  // cookie is picked up by the normal auth flow.
  useEffect(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string; expand?: () => void } } }).Telegram?.WebApp;
    if (!tg?.initData) return;
    tg.expand?.();
    fetch("/api/auth/telegram-webapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData }),
    })
      .then((r) => {
        if (r.ok) window.location.reload();
      })
      .catch(() => {});
  }, []);

  // ตั้ง interval เพื่อ refresh auth state ทุก 5 นาที
  // เพื่อให้ access token ถูกรีเฟรชจาก refresh token ก่อนหมดอายุ
  useEffect(() => {
    const interval = setInterval(() => {
      utils.auth.me.refetch();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [utils]);

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system" switchable>
        <TooltipProvider>
          <Toaster richColors position="top-center" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
