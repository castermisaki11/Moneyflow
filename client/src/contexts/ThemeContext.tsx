import React, { createContext, useContext, useEffect, useState } from "react";

// "system" tracks the OS/browser color-scheme preference live; "light"/"dark"
// are explicit user choices that override it; "blackgold" is a dark variant
// with gold accents (theme #3). `theme` (what components read to decide
// colors) always resolves to "light" | "dark" — never "system"/"blackgold".
export type ThemeMode = "light" | "dark" | "blackgold" | "system";
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
      if (stored === "light" || stored === "dark" || stored === "blackgold" || stored === "system") return stored;
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

  const theme: ResolvedTheme = mode === "light" ? "light" : "dark";
  const isBlackGold = mode === "blackgold";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("black-gold", isBlackGold);

    if (switchable) {
      localStorage.setItem("theme", mode);
    }
  }, [theme, isBlackGold, mode, switchable]);

  const setMode = switchable ? (m: ThemeMode) => setModeState(m) : undefined;

  // Quick toggle (header icon button): cycles light → dark → blackgold → light.
  // If currently following the system, jump to the opposite of what's showing.
  const toggleTheme = switchable
    ? () =>
        setModeState((prev) => {
          if (prev === "system") return theme === "dark" ? "light" : "dark";
          if (prev === "light") return "dark";
          if (prev === "dark") return "blackgold";
          return "light";
        })
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
