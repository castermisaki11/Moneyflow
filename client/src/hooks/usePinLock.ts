import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useState } from "react";

const SESSION_KEY = "moneyflow.pinUnlockedUserId";
const LEGACY_SESSION_KEY = "moneyflow.pinUnlockedAt";
// ถ้าสลับแอป/ปิดหน้าจอไว้นานกว่านี้ ให้ล็อกใหม่อีกครั้งตอนกลับมา
const RELOCK_AFTER_HIDDEN_MS = 5 * 60 * 1000;

function readUnlocked(userId: number | null | undefined): boolean {
  if (typeof window === "undefined" || userId == null) return false;
  return sessionStorage.getItem(SESSION_KEY) === String(userId);
}

export function usePinLock(userId: number | null | undefined) {
  const { data: status, isLoading } = trpc.security.status.useQuery(undefined, {
    staleTime: 60_000,
    enabled: userId != null,
    refetchOnMount: "always",
  });
  const pinEnabled = Boolean(status?.pinEnabled);

  const [unlocked, setUnlocked] = useState(() => readUnlocked(userId));

  // Never carry a PIN unlock from another account or from the old global key.
  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
    }
    setUnlocked(readUnlocked(userId));
  }, [userId]);

  const unlock = useCallback(() => {
    if (userId == null) return;
    sessionStorage.setItem(SESSION_KEY, String(userId));
    setUnlocked(true);
  }, [userId]);

  const lock = useCallback(() => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SESSION_KEY);
    }
    setUnlocked(false);
  }, []);

  // ล็อกใหม่อัตโนมัติถ้าสลับแอป/ปิดหน้าจอไปนาน (กันคนอื่นมาเห็นข้อมูลตอนหยิบมือถือมาเปิด)
  useEffect(() => {
    if (!pinEnabled) return;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (document.visibilityState === "visible" && hiddenAt) {
        if (Date.now() - hiddenAt > RELOCK_AFTER_HIDDEN_MS) lock();
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pinEnabled, lock]);

  return {
    isLoading,
    pinEnabled,
    locked: userId != null && pinEnabled && !unlocked,
    unlock,
    lock,
  };
}
