// Row state treatments shared by every list/table in the app. Brand green is
// the interactive-selection accent (hue 155) — not --color-positive, which is
// reserved for money. The inset bar is what makes a state read at a glance;
// tint alone sits too close to the hover token.

/** The row whose detail is open in a panel, sheet, or dialog. */
export const OPEN_ROW_CLASS =
  "bg-primary/10 hover:bg-primary/15 shadow-[inset_3px_0_0_var(--color-primary)]";

/** A row ticked for a bulk action — a half-strength bar so "open" still wins. */
export const CHECKED_ROW_CLASS =
  "bg-primary/[0.07] hover:bg-primary/10 shadow-[inset_3px_0_0_color-mix(in_oklch,var(--color-primary)_55%,transparent)]";

// <tr> can't reliably paint an inset box-shadow, so table variants put the
// bar on the first cell instead.
export const OPEN_TABLE_ROW_CLASS =
  "bg-primary/10 hover:bg-primary/15 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-primary)]";
export const CHECKED_TABLE_ROW_CLASS =
  "bg-primary/[0.07] hover:bg-primary/10 [&>td:first-child]:shadow-[inset_3px_0_0_color-mix(in_oklch,var(--color-primary)_55%,transparent)]";
