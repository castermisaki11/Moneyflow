import React, { createContext, useContext, useEffect, useState } from "react";

// "system" tracks the OS/browser color-scheme preference live; "light"/"dark"
// are explicit user choices that override it. `theme` (what components read
// to decide colors) always resolves to "light" | "dark" — never "system".
export type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  theme: ResolvedTheme; // resolved value — safe to use directly for styling
  mode: ThemeMode; // the user's actual selection, including "system"
  setMode?: (mode: ThemeMode) => void;
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemeMode;
  switchable?: boolean;
}

function getSystemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (switchable) {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark" || stored === "system") return stored;
    }
    return defaultTheme;
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(getSystemPrefersDark);

  // Keep systemPrefersDark in sync while `mode === "system"` (and it costs
  // nothing to keep listening even otherwise, in case the user switches to
  // "system" later without a re-render trigger).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  const theme: ResolvedTheme = mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable) {
      localStorage.setItem("theme", mode);
    }
  }, [theme, mode, switchable]);

  const setMode = switchable ? (m: ThemeMode) => setModeState(m) : undefined;

  // Quick toggle (header icon button): if currently following the system,
  // lock to the opposite of what's showing right now; otherwise flip light/dark.
  const toggleTheme = switchable
    ? () => setModeState((prev) => (prev === "system" ? (theme === "dark" ? "light" : "dark") : prev === "light" ? "dark" : "light"))
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
