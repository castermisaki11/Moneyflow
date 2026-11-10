import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import PinLockScreen from "./components/PinLockScreen";
import { ThemeProvider } from "./contexts/ThemeContext";
import { usePinLock } from "./hooks/usePinLock";
import MoneyFlow from "./pages/MoneyFlow";
import { trpc } from "@/lib/trpc";
import { Spinner } from "@/components/ui/spinner";

// The app is single-tenant and login-less: auth.me is always a fixed local
// session. ProtectedRoute still guards the PIN lock around it.
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const pinLock = usePinLock(user?.id);

  // รอทั้งสถานะ login และสถานะ PIN lock ก่อน — กันไม่ให้ข้อมูลกระพริบให้เห็นก่อนเช็ค PIN เสร็จ
  if (isLoading || (user && pinLock.isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!user) {
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
      <Route path="/" component={() => <ProtectedRoute component={MoneyFlow} />} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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
