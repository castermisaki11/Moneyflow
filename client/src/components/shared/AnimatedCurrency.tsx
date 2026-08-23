import { animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/money";

interface AnimatedCurrencyProps {
  /** The raw numeric amount (not pre-formatted). */
  value: number;
  currency: string;
  className?: string;
  /** Tween duration in ms. */
  duration?: number;
  /** Briefly tint green on increase / rose on decrease, with a small landing bounce. */
  colorPulse?: boolean;
}

/**
 * Drop-in replacement for `{formatCurrency(value, currency)}` that eases
 * between old and new totals instead of snapping, with a short color pulse
 * (green = went up, rose = went down) so a change actually reads as a
 * change. Used for headline/summary numbers — deliberately not wired into
 * every list row, so the motion stays meaningful instead of constant noise.
 */
export function AnimatedCurrency({
  value,
  currency,
  className = "",
  duration = 700,
  colorPulse = true,
}: AnimatedCurrencyProps) {
  const [display, setDisplay] = useState(() => formatCurrency(value, currency));
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [pop, setPop] = useState(false);
  const prevRef = useRef(value);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = to;

    // Don't animate/flash on first mount — only on actual changes.
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      setDisplay(formatCurrency(to, currency));
      return;
    }
    if (from === to) {
      setDisplay(formatCurrency(to, currency));
      return;
    }

    if (colorPulse) {
      setFlash(to > from ? "up" : "down");
    }
    setPop(true);

    const controls = animate(from, to, {
      duration: duration / 1000,
      ease: [0.16, 1, 0.3, 1], // expo-out — quick start, gentle settle
      onUpdate: (v) => setDisplay(formatCurrency(v, currency)),
    });

    const flashTimer = setTimeout(() => setFlash(null), duration + 300);
    const popTimer = setTimeout(() => setPop(false), 260);

    return () => {
      controls.stop();
      clearTimeout(flashTimer);
      clearTimeout(popTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency, duration, colorPulse]);

  return (
    <span
      className={[
        "inline-block tabular-nums transition-[color,transform] duration-300 ease-out",
        pop ? "scale-[1.08]" : "scale-100",
        flash === "up" ? "text-emerald-500" : flash === "down" ? "text-rose-500" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {display}
    </span>
  );
}
