"use client";

import { useState, useTransition } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CollapsiblePanel } from "./collapsible-panel";
import {
  useMaskedCurrency,
  useMaskedCurrencyWhole,
} from "@/components/shared/use-masked-currency";
import { roundCents, roundUpToTen } from "@/lib/db-utils";
import { computeCategoryUnderfunded, isTargetMet } from "@/lib/target-utils";
import {
  setCategoryAssignedWithSnapshot,
  updateAssigned,
} from "@/app/(app)/budget/actions";
import type { CategoryWithBudget } from "@/lib/types";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";

type Props = {
  category: CategoryWithBudget;
  month: string;
  onMutate: (entry: MutationEntry) => MutationId;
  undoEntry: (id: MutationId) => void;
};

type Row = {
  label: string;
  newAssigned: number;
};

const ROW_BUTTON_CLASS =
  "w-full justify-between text-[13px] font-normal tabular-nums bg-secondary hover:bg-secondary/80";

export function CategoryAutoAssignSection({
  category,
  month,
  onMutate,
  undoEntry,
}: Props) {
  const [open, setOpen] = useState(true);
  const [isPending, startTransition] = useTransition();
  const fmt = useMaskedCurrency();
  const fmtWhole = useMaskedCurrencyWhole();
  const { toast } = useToast();

  // Precomputed server-side by the budget engine and threaded down as a prop —
  // no per-click fetch, so the suggestions render instantly on category open.
  const metrics = category.autoAssign;

  // Derived from current props so it stays correct after assigning more to
  // the category (no refetch needed). The "make whole" amount — MAX of the
  // overspend cover and the target-pace deficit — so this per-row offer matches
  // the bulk "Fund underfunded" CTA exactly (computeCategoryUnderfunded). A
  // no-target overspent category still surfaces an offer here (pure overspend
  // cover); a category on-pace and in the black shows nothing.
  const underfunded = computeCategoryUnderfunded(category);

  // Lift the running balance (available) up to the next whole $10. Hide when
  // already on a $10 mark, never offer "round up to $0" for zero/negative
  // balances (that's what Underfunded is for), and suppress once the category's
  // target is fully met — rounding up would over-fund past the goal.
  const roundedUp = roundUpToTen(category.available);
  const roundUpDelta = roundCents(roundedUp - category.available);
  const showRoundUp =
    roundedUp > category.available &&
    roundedUp > 0 &&
    !isTargetMet(category);

  const applyAssigned = (newAssigned: number, label: string) => {
    startTransition(async () => {
      try {
        // `previous` is read from the DB inside the action, so undo restores
        // the real prior value rather than a stale closure over the prop.
        const { previous } = await setCategoryAssignedWithSnapshot(
          category.id,
          month,
          newAssigned,
        );
        const entryId = onMutate({
          label,
          forward: async () => {
            await updateAssigned(category.id, month, newAssigned);
          },
          backward: async () => {
            await updateAssigned(category.id, month, previous);
          },
        });
        // The category grid is off to the side here; auto-assign moves money
        // with no number changing at the point of action, so acknowledge it —
        // and undo *this* row, not whatever is on top of the stack.
        toast({
          message: `Assigned to ${category.name}.`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        toast({
          message: `Couldn't assign to ${category.name}. Your change wasn't saved.`,
          variant: "error",
        });
      }
    });
  };

  const renderRow = (row: Row, displayValue: number) => {
    const isNoop = row.newAssigned === category.assigned;
    return (
      <Button
        key={row.label}
        variant="outline"
        size="sm"
        className={ROW_BUTTON_CLASS}
        disabled={isPending || isNoop}
        onClick={() => applyAssigned(row.newAssigned, row.label)}
      >
        <span className="font-medium">{row.label}</span>
        <span className="zero-amount">{fmt(displayValue)}</span>
      </Button>
    );
  };

  return (
    <CollapsiblePanel
      title="Auto-assign"
      icon={<Zap className="h-3.5 w-3.5 text-primary" fill="currentColor" />}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      {underfunded > 0 && (
        <>
          {renderRow(
            {
              label: "Underfunded",
              newAssigned: category.assigned + underfunded,
            },
            underfunded,
          )}
          <div className="py-2">
            <div className="h-px bg-border/50" />
          </div>
        </>
      )}
      {showRoundUp && (
        <>
          {renderRow(
            {
              label: `Round up to ${fmtWhole(roundedUp)}`,
              // Lands available exactly on roundedUp — same shape as the
              // "Reset available amount" row (assigned - available), plus target.
              newAssigned: roundCents(
                category.assigned - category.available + roundedUp,
              ),
            },
            roundUpDelta,
          )}
          <div className="py-2">
            <div className="h-px bg-border/50" />
          </div>
        </>
      )}
      {renderRow(
        { label: "Assigned last month", newAssigned: metrics.assignedLastMonth },
        metrics.assignedLastMonth,
      )}
      {renderRow(
        { label: "Spent last month", newAssigned: metrics.spentLastMonth },
        metrics.spentLastMonth,
      )}
      {renderRow(
        { label: "Average assigned", newAssigned: metrics.averageAssigned },
        metrics.averageAssigned,
      )}
      {renderRow(
        { label: "Average spent", newAssigned: metrics.averageSpent },
        metrics.averageSpent,
      )}
      <div className="py-2">
        <div className="h-px bg-border/50" />
      </div>
      {renderRow(
        {
          label: "Reset available amount",
          newAssigned: category.assigned - category.available,
        },
        0,
      )}
      {renderRow({ label: "Reset assigned amount", newAssigned: 0 }, 0)}
    </CollapsiblePanel>
  );
}
