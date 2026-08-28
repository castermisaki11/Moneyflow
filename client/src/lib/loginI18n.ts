// Tiny, self-contained i18n for the login page only (TH/EN). Kept scoped to
// this one screen on purpose — the rest of the app is Thai-only for now. The
// preference persists in localStorage so it survives reloads.

export type Lang = "th" | "en";

export type LoginKey =
  | "welcome"
  | "welcomeSub"
  | "discord"
  | "google"
  | "demo"
  | "terms1"
  | "terms2";

const STRINGS: Record<LoginKey, { th: string; en: string }> = {
  welcome: { th: "ยินดีต้อนรับ", en: "Welcome" },
  welcomeSub: {
    th: "เข้าสู่ระบบเพื่อเริ่มจัดการเงินของคุณ — ฟรี ไม่จำกัดรายการ",
    en: "Sign in to start managing your money — free, unlimited entries",
  },
  discord: { th: "เข้าสู่ระบบด้วย Discord", en: "Continue with Discord" },
  google: { th: "เข้าสู่ระบบด้วย Google", en: "Continue with Google" },
  demo: { th: "ลองใช้ Demo", en: "Try the Demo" },
  terms1: {
    th: "เข้าสู่ระบบถือว่าคุณยอมรับเงื่อนไขการใช้งาน",
    en: "By signing in you agree to the Terms of Service",
  },
  terms2: {
    th: "ข้อมูลของคุณเป็นส่วนตัว — เห็นได้เฉพาะบัญชีคุณเท่านั้น",
    en: "Your data is private — visible only to your own account",
  },
};

const STORAGE_KEY = "moneyflow.lang";

export function loadLang(): Lang {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    return v === "en" ? "en" : "th";
  } catch {
    return "th";
  }
}

export function saveLang(l: Lang): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* ignore */
  }
}

export function t(lang: Lang, key: LoginKey): string {
  return STRINGS[key][lang];
}
