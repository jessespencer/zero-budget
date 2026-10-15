"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Returns a `data-flash` value ("a" | "b") for ~700ms after `value` changes,
 * else undefined. Spread it onto the element that displays the value; the
 * `amount-flash` keyframes in globals.css do the rest.
 *
 * - Never flashes on mount.
 * - `scope` resets the baseline without flashing: pass the month on budget
 *   surfaces so navigating months doesn't light up every number at once.
 * - Alternates "a"/"b" so a second change mid-animation restarts it (the two
 *   values map to identically-shaped keyframes with different names).
 */
export function useFlashOnChange(value: number, scope?: string): "a" | "b" | undefined {
  const prev = useRef({ value, scope });
  const [flash, setFlash] = useState<"a" | "b" | undefined>(undefined);

  useEffect(() => {
    const last = prev.current;
    prev.current = { value, scope };
    if (last.scope !== scope) return;
    // Compare at cent precision — engine sums carry float residue.
    if (Math.round(last.value * 100) === Math.round(value * 100)) return;
    setFlash((f) => (f === "a" ? "b" : "a"));
    const t = window.setTimeout(() => setFlash(undefined), 700);
    return () => window.clearTimeout(t);
  }, [value, scope]);

  return flash;
}
