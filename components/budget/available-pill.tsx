import { Check, Clock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Currency } from "@/components/shared/currency";
import { computeMonthlyNeeded, fundedBasis } from "@/lib/target-utils";
import { availableCents, roundCents } from "@/lib/db-utils";
import { MoveMoneyPopover } from "./move-money-popover";
import { ProgressRing } from "./progress-ring";
import { useFlashOnChange } from "@/components/shared/use-flash-on-change";
import type { Target } from "@/lib/types";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";

type AvailablePillProps = {
  available: number;
  assigned: number;
  cumulativeAssigned: number;
  target: Target | null;
  categoryId: string;
  categoryName: string;
  month: string;
  destinations: { id: string; name: string; groupName: string }[];
  onMutate: (entry: MutationEntry) => MutationId;
  undoEntry: (id: MutationId) => void;
};

type PillState = "overspent" | "underfunded" | "funded" | "saving" | "zero";

export function isUnderfunded(
  available: number,
  assigned: number,
  cumulativeAssigned: number,
  target: Target | null
): boolean {
  if (!target) return false;
  // Open-ended savings (no date) are never "underfunded" — progress is always positive
  if (target.type === "savings_balance" && !target.target_date) return false;

  // Dated target_by_date / spending: stay on the prorated monthly pace, don't
  // require the full target_amount this month. The "underfunded"
  // contract: flag only when this month's assignment is below the per-month need.
  const dueDate = target.target_date;
  if (dueDate && (target.type === "target_by_date" || target.type === "spending")) {
    // Recurring sinking funds measure "to go" against the current balance
    // (available) and pace against the rolled-forward effective deadline, so a
    // fund spent down to $0 reads underfunded again next cycle.
    const toGo = target.recurring
      ? target.target_amount - available
      : target.target_amount - cumulativeAssigned;
    if (toGo <= 0) return false; // already fully funded across the funding window
    const monthlyNeeded = computeMonthlyNeeded(target, toGo);
    return assigned < monthlyNeeded;
  }

  // monthly_funding: this month's assignment must meet target_amount.
  // savings_balance with target_date: running balance must meet target_amount.
  // spending without target_date: cumulative_assigned must meet target_amount (a cap, fill it now).
  return fundedBasis(available, assigned, cumulativeAssigned, target) < target.target_amount;
}

function getPillState(
  available: number,
  assigned: number,
  cumulativeAssigned: number,
  target: Target | null
): PillState {
  // Round to cents before the sign/zero gate: `available` is a raw sum of
  // engine floats, so a fully-spent category leaves a ±1e-13 residual that
  // slips past `=== 0` and tints a "$0.00" pill green (or red). Compare the
  // same value the user sees — shared with the Overspent filter and the rest
  // of the consumers via availableCents.
  available = availableCents(available);
  if (available < 0) return "overspent";
  if (target && isUnderfunded(available, assigned, cumulativeAssigned, target)) return "underfunded";
  if (available === 0) return "zero";
  // No target = no concept of "fully funded" — just money sitting there.
  // Open-ended savings goal in progress = same visual treatment.
  if (!target) return "saving";
  if (
    target.type === "savings_balance" &&
    !target.target_date &&
    available < target.target_amount
  ) {
    return "saving";
  }
  return "funded";
}

// Map each available-pill state onto a badge intent so the available
// column reuses the badge recipe in globals.css (color-mix 15% bg +
// 26% border + intent foreground). Keeps the available column visually
// in the same family as the target / Buffer / Uncategorized chips.
const stateBadgeClass: Record<PillState, string> = {
  overspent: "badge-negative",
  underfunded: "badge-warning",
  funded: "badge-positive",
  saving: "badge-positive",
  zero: "badge-neutral",
};

export function AvailablePill({
  available,
  assigned,
  cumulativeAssigned,
  target,
  categoryId,
  categoryName,
  month,
  destinations,
  onMutate,
  undoEntry,
}: AvailablePillProps) {
  const state = getPillState(available, assigned, cumulativeAssigned, target);
  // Move-money destinations are often off-screen when the source changes;
  // the flash marks both ends of the move once the user scrolls to them.
  const flash = useFlashOnChange(available, month);

  // Overall progress toward the *whole* goal (not this month's pace), on the
  // same basis isUnderfunded measures. Drives the ring vs. check split so a
  // goal that's merely on-pace this month no longer reads as "complete".
  const hasGoal = !!target && target.target_amount > 0;
  const goalBasis = target
    ? fundedBasis(available, assigned, cumulativeAssigned, target)
    : 0;
  const goalPercent =
    hasGoal && target ? (goalBasis / target.target_amount) * 100 : 0;
  const goalComplete =
    !hasGoal || (target ? roundCents(goalBasis) >= roundCents(target.target_amount) : true);

  // A ring showing real % toward the goal, inheriting the badge's intent color
  // (currentColor) so 25%-done doesn't render alarming red. Resolves to the
  // solid check only when the goal is actually reached.
  const progressRing = (
    <ProgressRing
      percent={goalPercent}
      size={13}
      strokeWidth={2}
      color="currentColor"
      // Tint the track with the badge's intent color (not neutral muted) so the
      // ring reads as "partly full" against the tinted pill in both themes,
      // instead of the arc floating as a lone crescent.
      trackClassName="text-current opacity-25"
      showLabel={false}
    />
  );

  // Filled check: a solid disc in the pill's own intent color with the check
  // knocked out in the surface color — reads far more emphatically than the
  // outline CircleCheck (lucide ships no solid variant). Reserved for a goal
  // that's genuinely complete.
  const checkDisc = (
    <span className="inline-flex h-[13px] w-[13px] items-center justify-center rounded-full bg-current">
      <Check className="h-[9px] w-[9px] text-background" strokeWidth={3.5} />
    </span>
  );

  const icon =
    // Overspent (available < 0) — a warning triangle reads as "this went red".
    state === "overspent" ? <TriangleAlert className="h-[13px] w-[13px]" /> :
    state === "funded" ? (goalComplete ? checkDisc : progressRing) :
    state === "underfunded" ? (
      // lucide's Clock circle fills only ~20/24 of its box. Keep the box 13px
      // (so every icon measures identically) and scale the glyph so the drawn
      // circle lands at ~12px — a hair under the disc/ring so the open outline
      // stops reading optically heavier than the solid disc. scale 1.1 →
      // 13 × (20/24) × 1.1 ≈ 12px.
      <Clock className="h-[13px] w-[13px] scale-[1.1]" />
    ) :
    // Open-ended savings goal in progress — show the ring. No-target money stays icon-less.
    state === "saving" && hasGoal ? progressRing :
    null;

  // The pill is the popover trigger. Rendering as a <button> rather than a
  // <span> keeps the popover anchored to a focusable element (keyboard
  // operable, focus-visible ring) without changing the visual treatment.
  const pillButton = (
    <button
      type="button"
      data-flash={flash}
      data-flash-ring
      aria-label={`Move money from ${categoryName}`}
      className={cn(
        // .badge owns radius / color-mix bg / border / intent fg.
        // Tailwind utilities below override the badge defaults (padding,
        // font-size) for the larger available-pill footprint.
        "badge",
        stateBadgeClass[state],
        // With an icon, the left inset matches the icon's top/bottom inset:
        // py-0.5 (2px) plus the ~1.9px the 13px icon is centered within the
        // 14px/1.2 line box ≈ 4px. With no icon, the number needs a normal
        // horizontal inset (symmetric with pr-2.5) so it isn't jammed left.
        // The triangle-alert glyph sits flush to its box's left edge (unlike the
        // circular icons), so the overspent badge needs a touch more left inset.
        state === "overspent" ? "pl-1.5" : icon ? "pl-1" : "pl-2.5",
        "pr-2.5 py-0.5 text-[14px] tabular-nums translate-x-2.5",
        "hover:brightness-90 transition-[filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer"
      )}
    >
      {icon}
      <Currency amount={available} colorize={false} smallCents={false} />
    </button>
  );

  const popoverProps = {
    sourceCategoryId: categoryId,
    sourceCategoryName: categoryName,
    sourceAvailable: available,
    month,
    destinations,
    onMutate,
    undoEntry,
  };

  return <MoveMoneyPopover {...popoverProps}>{pillButton}</MoveMoneyPopover>;
}
