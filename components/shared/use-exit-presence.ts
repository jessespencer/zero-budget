"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keeps a conditionally-rendered element mounted for `ms` after it's hidden,
 * so it can play an exit animation instead of vanishing. Returns whether to
 * render at all and whether it's on its way out.
 *
 * Pair with `last` to keep showing the final value during the exit (e.g. a
 * selection count that has already dropped to 0).
 */
export function useExitPresence<T>(visible: boolean, value: T, ms = 150) {
  const [mounted, setMounted] = useState(visible);
  const lastRef = useRef(value);
  if (visible) lastRef.current = value;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(t);
  }, [visible, ms]);

  return {
    mounted: visible || mounted,
    closing: !visible && mounted,
    last: lastRef.current,
  };
}
