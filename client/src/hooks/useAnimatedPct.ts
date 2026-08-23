import { useEffect, useRef, useState } from "react";

/**
 * Returns a percentage that starts at 0 and animates up to `pct` right
 * after mount (or whenever `pct` changes) — pair with an element that
 * already has a `transition-[width]` class and the bar will visibly fill
 * in instead of snapping straight to its value.
 *
 * Uses requestAnimationFrame (not a 0ms timeout) so the browser has
 * definitely painted the `width: 0` starting frame before we raise it —
 * without that the transition can get collapsed into a single frame.
 */
export function useAnimatedPct(pct: number) {
  const [animated, setAnimated] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    // On first mount, start from 0 so the fill-in is visible. On later
    // updates (e.g. a new transaction changes the %), animate from
    // wherever it currently sits — no need to reset to 0 first.
    if (!mounted.current) {
      mounted.current = true;
      const raf = requestAnimationFrame(() => setAnimated(pct));
      return () => cancelAnimationFrame(raf);
    }
    setAnimated(pct);
  }, [pct]);

  return animated;
}
