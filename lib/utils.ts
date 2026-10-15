import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import type { UIEvent } from "react"

// Teach tailwind-merge our custom radius token (--radius-pill in globals.css).
// Without it, `rounded-pill` isn't recognised as a border-radius class, so a
// caller's `rounded-lg` never replaces a primitive's `rounded-pill` — both
// stay in the class list and the pill silently wins.
const twMerge = extendTailwindMerge({
  extend: { theme: { radius: ["pill"] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Scroll a combobox option into view *within its listbox only* — never the page.
 *
 * `Element.scrollIntoView` walks every scrollable ancestor, so when the listbox
 * (and its editing row) sits above the viewport, it yanks the whole page up to
 * follow the highlighted option. Adjusting the listbox's own `scrollTop` keeps
 * the page put. No-op when the listbox doesn't actually scroll.
 */
export function scrollOptionIntoView(
  listbox: HTMLElement | null,
  option: HTMLElement | null
) {
  if (!listbox || !option) return;
  const optTop = option.offsetTop;
  const optBottom = optTop + option.offsetHeight;
  if (optTop < listbox.scrollTop) {
    listbox.scrollTop = optTop;
  } else if (optBottom > listbox.scrollTop + listbox.clientHeight) {
    listbox.scrollTop = optBottom - listbox.clientHeight;
  }
}

/** Shared table header row classes */
export const tableHeaderRow = "text-[12px] font-bold text-foreground/60 uppercase tracking-[0.06em] sticky top-0 bg-card z-10 border-b border-border";

/**
 * Right-edge shadow for sticky first-column cells, shown only while the
 * table is horizontally scrolled. Pair with `stickyColScroll` on the
 * overflow container — the `in-data-scrolled:` variant keys off the
 * data attribute it toggles.
 */
export const stickyColShadow =
  "transition-shadow in-data-scrolled:shadow-[inset_-1px_0_0_var(--border),4px_0_6px_-4px_rgba(0,0,0,0.08)]";

/** onScroll handler for the overflow container wrapping a sticky-column table */
export function stickyColScroll(e: UIEvent<HTMLDivElement>) {
  e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollLeft > 0);
}

/** Shared dialog field classes — transparent in light mode, filled in dark mode */
export const fieldClass =
  "flex h-10 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground dark:bg-input";

export const selectClass = fieldClass + " pr-8 appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')]";
