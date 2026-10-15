"use client";

import { useEffect, useRef, useState } from "react";

/** Viewport width (px) below which the sidebar collapses to its icon rail. */
export const AUTO_COLLAPSE_BELOW_PX = 1024;
const NARROW_QUERY = `(max-width: ${AUTO_COLLAPSE_BELOW_PX - 0.02}px)`;

/**
 * Sidebar collapsed state that follows the viewport. Below 1024px a 260px rail
 * leaves too little room for the page (the budget grid, the setup checklist),
 * so the rail collapses to its 60px icon form.
 *
 * It reacts to crossing the breakpoint, not to every resize: expanding by hand
 * on a narrow screen sticks until the window crosses back, and widening again
 * restores what the user last chose on a wide screen rather than always
 * re-expanding.
 */
export function useAutoCollapse(): [collapsed: boolean, toggle: () => void] {
  const [collapsed, setCollapsed] = useState(false);
  const wideChoiceRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const apply = (narrow: boolean) => setCollapsed(narrow ? true : wideChoiceRef.current);
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    if (!window.matchMedia(NARROW_QUERY).matches) wideChoiceRef.current = next;
    setCollapsed(next);
  };

  return [collapsed, toggle];
}
