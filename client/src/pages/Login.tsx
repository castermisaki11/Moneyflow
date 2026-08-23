import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Sign in to your Satang account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            className="w-full"
            onClick={() => handleOAuthLogin("discord")}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.3671a19.8062 19.8062 0 00-4.885-1.515.0741.0741 0 00-.0785.0371c-.211.3671-.445.8447-.608 1.2321a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.2288.077.077 0 00-.079-.037 19.7896 19.7896 0 00-4.885 1.515.0699.0699 0 00-.032.0274C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.0605 19.9384 19.9384 0 005.993 3.03.0784.0784 0 00.085-.027 14.285 14.285 0 001.146-1.861.076.076 0 00-.042-.106 13.1917 13.1917 0 01-1.871-.892.077.077 0 01-.008-.128 10.2457 10.2457 0 00.372-.294.075.075 0 01.078-.01c3.928 1.793 8.18 1.793 12.062 0a.075.075 0 01.079.009c.12.098.246.198.373.295a.077.077 0 01-.006.127 13.22 13.22 0 01-1.871.892.077.077 0 00-.041.107c.36.698.772 1.362 1.146 1.861a.077.077 0 00.085.028 19.963 19.963 0 005.993-3.03.077.077 0 00.032-.06c.5-4.467.151-8.35-.882-12.087a.077.077 0 00-.031-.028zM8.02 15.3312c-1.044 0-1.9-1.005-1.9-2.247 0-1.242.84-2.247 1.9-2.247 1.062 0 1.919 1.005 1.9 2.247 0 1.242-.84 2.247-1.9 2.247zm7.973 0c-1.044 0-1.9-1.005-1.9-2.247 0-1.242.84-2.247 1.9-2.247 1.062 0 1.919 1.005 1.9 2.247 0 1.242-.837 2.247-1.9 2.247z" />
            </svg>
            Continue with Discord
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => handleOAuthLogin("google")}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.645h6.458a5.52 5.52 0 01-2.395 3.622v3.01h3.878c2.269-2.09 3.578-5.166 3.578-8.822z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.956-1.075 7.941-2.905l-3.878-3.01c-1.075.72-2.45 1.147-4.063 1.147-3.126 0-5.77-2.11-6.716-4.946H1.278v3.107C3.253 21.31 7.31 24 12 24z" />
              <path fill="#FBBC05" d="M5.284 14.286a7.23 7.23 0 010-4.573V6.606H1.278a11.996 11.996 0 000 10.787l4.006-3.107z" />
              <path fill="#EA4335" d="M12 4.773c1.762 0 3.344.606 4.59 1.796l3.442-3.442C17.951 1.19 15.236 0 12 0 7.31 0 3.253 2.69 1.278 6.606l4.006 3.107C6.23 6.877 8.874 4.773 12 4.773z" />
            </svg>
            Continue with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
