import { addYears, format, startOfDay } from "date-fns";
import { availableCents, roundCents } from "./db-utils";
import type { CategoryWithBudget, Target } from "./types";

// Subset of a Target the recurrence/pace math actually reads. Kept structural
// (rather than `Target`) so callers with partial fixtures still typecheck.
type RecurrenceTarget = {
  type: string;
  target_amount: number;
  target_date: string | null;
  monthly_contribution: number | null;
  recurring?: boolean;
};

// Parse a date-only ISO string ("YYYY-MM-DD") into a local Date at midnight,
// matching how computeMonthlyNeeded already pulls year/month apart — no
// timezone surprises and no hidden Date.now() so tests can pin the clock.
function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return startOfDay(new Date(y, m - 1, d));
}

/**
 * The deadline a target is actually measured against right now.
 *
 * For a non-recurring target (or one without a date) this is just the stored
 * `target_date`. For a recurring Yearly target the stored anchor is rolled
 * forward by whole years until it lands on/after the current month, so the
 * goal keeps a live future deadline every cycle instead of going stale.
 *
 * `currentMonth` is the basis "now" (ISO date string, e.g. the budget month's
 * 1st, or any date). Defaults to today. Date-only throughout for determinism.
 */
export function effectiveTargetDate(
  target: RecurrenceTarget,
  currentMonth?: string
): string | null {
  if (!target.recurring || !target.target_date) return target.target_date;

  const now = currentMonth ? parseDateOnly(currentMonth) : startOfDay(new Date());
  let due = parseDateOnly(target.target_date);

  // Roll forward by whole years while the anchor is strictly before the basis
  // month. Compare on year+month so a deadline within the current month still
  // counts as "this cycle" (you can still fund it this month).
  const nowKey = now.getFullYear() * 12 + now.getMonth();
  let dueKey = due.getFullYear() * 12 + due.getMonth();
  const maxIterations = 1000;
  for (let i = 0; i < maxIterations && dueKey < nowKey; i++) {
    due = addYears(due, 1);
    dueKey = due.getFullYear() * 12 + due.getMonth();
  }

  return format(due, "yyyy-MM-dd");
}

export function computeMonthlyNeeded(
  target: RecurrenceTarget,
  toGo: number,
  currentMonth?: string
): number {
  if (toGo <= 0) return 0;

  switch (target.type) {
    case "monthly_funding":
      return target.target_amount;
    case "target_by_date":
    case "spending": {
      // Spread the gap across months remaining when there's a deadline.
      // Without a date, "spending" is a true cap — fill it now. Recurring
      // targets pace against the rolled-forward effective deadline so the
      // monthly need stays live across cycles.
      const effectiveDate = effectiveTargetDate(target, currentMonth);
      if (!effectiveDate) return toGo;
      const now = currentMonth ? parseDateOnly(currentMonth) : new Date();
      const [dueYear, dueMonth] = effectiveDate.split("-").map(Number);
      // Include current month in the count (you can still assign this month)
      const monthsLeft =
        (dueYear - now.getFullYear()) * 12 +
        (dueMonth - (now.getMonth() + 1)) + 1;
      return monthsLeft > 0 ? Math.round((toGo / monthsLeft) * 100) / 100 : toGo;
    }
    case "savings_balance":
    default:
      return toGo;
  }
}

// Pick the "funded" basis a target is actually measuring:
//   savings_balance → running balance
//   monthly_funding → this month's assignment (recurring goal)
//   spending / target_by_date → cumulative assignment over the funding window
//   recurring dated → current balance (sinking funds refill after spend)
//
// Shared by the pill (`isUnderfunded`) and the bulk/per-category funding math
// so the filter and the auto-assign actions measure progress the same way.
export function fundedBasis(
  available: number,
  assigned: number,
  cumulativeAssigned: number,
  target: Target
): number {
  if (target.recurring) return available;
  if (target.type === "savings_balance") return available;
  if (target.type === "monthly_funding") return assigned;
  return cumulativeAssigned;
}

// "Overspending" — the amount to bring a category's `available` back up to $0.
// Matches the **Overspent** filter exactly: both round to cents first (see
// availableCents), so a break-even category at ~-1e-13 yields 0 here instead of
// a sub-cent "need" that renders an "Underfunded $0.00" row and drags the
// category into the bulk Fund-underfunded preview. Still used by the
// per-category "Reset available amount" math and as one half of the bulk
// "Fund underfunded" need (see computeCategoryUnderfunded below).
export function computeCategoryOverspending(
  category: Pick<CategoryWithBudget, "available">
): number {
  const available = availableCents(category.available);
  return available < 0 ? -available : 0;
}

// "Target deficit" — the amount to bring a category up to its monthly target
// pace, independent of any overspend. Mirrors `isUnderfunded` (the **Underfunded**
// filter predicate) so the per-category "Underfunded" row and the grid filter
// agree on the target shortfall. Overspending is NOT folded in here; the bulk
// "Fund underfunded" action layers it on via computeCategoryUnderfunded.
export function computeCategoryTargetDeficit(
  category: Pick<
    CategoryWithBudget,
    "assigned" | "available" | "cumulative_assigned" | "target"
  > & { target: Target | null }
): number {
  const { available, assigned, cumulative_assigned: cumulativeAssigned } =
    category;
  const target = category.target;
  if (!target) return 0;
  // Open-ended savings (no date) carry no monthly obligation.
  if (target.type === "savings_balance" && !target.target_date) return 0;

  // Dated target_by_date / spending: stay on the prorated monthly pace, don't
  // demand the full target_amount this month.
  const dueDate = target.target_date;
  if (dueDate && (target.type === "target_by_date" || target.type === "spending")) {
    const toGo = target.recurring
      ? target.target_amount - available
      : target.target_amount - cumulativeAssigned;
    if (toGo <= 0) return 0;
    const monthlyNeeded = computeMonthlyNeeded(target, toGo);
    return Math.max(0, monthlyNeeded - assigned);
  }

  // monthly_funding / savings_balance with date / spending without date:
  // top the measured basis up to target_amount.
  const basis = fundedBasis(available, assigned, cumulativeAssigned, target);
  return Math.max(0, target.target_amount - basis);
}

// Has the category reached its target? True when a target exists and the basis
// it's measured against (see fundedBasis) has hit target_amount. Used to suppress
// the "round up to next $10" auto-assign offer once a goal is fully funded —
// rounding up would over-fund past the target the user set.
export function isTargetMet(
  category: Pick<
    CategoryWithBudget,
    "assigned" | "available" | "cumulative_assigned" | "target"
  > & { target: Target | null }
): boolean {
  const target = category.target;
  if (!target) return false;
  const basis = fundedBasis(
    category.available,
    category.assigned,
    category.cumulative_assigned,
    target
  );
  // Cents-tolerant: floats can land a hair under after rounding elsewhere.
  return roundCents(basis - target.target_amount) >= 0;
}

// "Underfunded" as the bulk "Fund underfunded" action means it: the single
// amount that makes a category whole — both out of the red AND up to its
// monthly target pace. It's the MAX of the two needs, not the sum, so it never
// double-funds:
//   • savings_balance / recurring targets measure their deficit against
//     `available`, so a negative balance already inflates the target deficit
//     past the overspend cover → the deficit term wins.
//   • monthly_funding / dated targets measure against assignment, so the
//     deficit ignores overspend → the overspend term tops it up to ≥ 0.
//   • no-target overspent categories have zero deficit → pure overspend cover.
// Adding `max` to `assigned` lands available ≥ 0 and basis ≥ target pace in
// every case.
export function computeCategoryUnderfunded(
  category: Pick<
    CategoryWithBudget,
    "assigned" | "available" | "cumulative_assigned" | "target"
  > & { target: Target | null }
): number {
  return Math.max(
    computeCategoryOverspending(category),
    computeCategoryTargetDeficit(category)
  );
}
