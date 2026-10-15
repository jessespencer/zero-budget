"use client";

import { useState, useTransition } from "react";
import { Flag, AlertTriangle } from "lucide-react";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { computeMonthlyNeeded, effectiveTargetDate } from "@/lib/target-utils";
import { isUnderfunded } from "./available-pill";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CollapsiblePanel } from "./collapsible-panel";
import { ProgressRing } from "./progress-ring";
import { colorForName } from "@/lib/chart-colors";
import { TargetForm } from "./target-form";
import {
  createTarget,
  updateTarget,
  deleteTargetWithSnapshot,
  restoreTarget,
  updateAssigned,
  type TargetInput,
} from "@/app/(app)/budget/actions";
import type { CategoryWithBudget } from "@/lib/types";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";

type TargetSectionProps = {
  category: CategoryWithBudget;
  month: string;
  onMutate?: (entry: MutationEntry) => MutationId;
  undoEntry?: (id: MutationId) => void;
};

type ViewState = "empty" | "view" | "edit";

export function TargetSection({
  category,
  month,
  onMutate,
  undoEntry,
}: TargetSectionProps) {
  const target = category.target;
  // Only "editing" is local. Empty vs summary is derived from the prop so the
  // panel follows the target as revalidation adds or removes it — undo of a
  // delete, or a panel that mounted before a create landed. Seeding it once
  // from `target` left the panel on "How much do you need?" beside a budget
  // row that showed the goal.
  const [editing, setEditing] = useState(false);
  const view: ViewState = editing ? "edit" : target ? "view" : "empty";
  const [expanded, setExpanded] = useState(true);
  const [isSaving, startTransition] = useTransition();
  const fmt = useMaskedCurrency();
  const { toast } = useToast();

  const handleCreate = () => setEditing(true);

  const handleSave = (data: TargetInput) => {
    // Flip to the summary view only once the write lands. It used to run
    // synchronously outside the transition, so a failed save still closed the
    // form as though the goal had been saved — a new target then vanished on
    // the next server render and an edit silently reverted, with no word either
    // way.
    startTransition(async () => {
      try {
        if (target) {
          await updateTarget(target.id, data);
        } else {
          await createTarget(category.id, data);
        }
        setEditing(false);
      } catch {
        toast({
          message: "Couldn't save your target. Your changes weren't saved.",
          variant: "error",
        });
      }
    });
  };

  const handleDelete = () => {
    if (!target) return;
    const targetId = target.id;
    startTransition(async () => {
      try {
        const snapshot = await deleteTargetWithSnapshot(targetId);
        // Already gone (double-fire) — nothing to acknowledge or undo.
        if (!snapshot) return;
        setEditing(false);
        const entryId = onMutate?.({
          label: `Delete ${category.name} target`,
          forward: async () => {
            await deleteTargetWithSnapshot(targetId);
          },
          backward: async () => {
            await restoreTarget(snapshot);
          },
        });
        // Destructive with no on-screen number to show it — the toast is the
        // acknowledgement, and its Undo restores every field, not a blank goal.
        toast({
          message: `Deleted the ${category.name} target.`,
          action:
            entryId && undoEntry
              ? { label: "Undo", onClick: () => undoEntry(entryId) }
              : undefined,
        });
      } catch {
        // Delete failed: the target is still there, so keep the edit view and
        // say so rather than dropping to the empty state and inviting a dupe.
        toast({
          message: "Couldn't delete the target. It's still here.",
          variant: "error",
        });
      }
    });
  };

  const handleCancel = () => {
    setEditing(false);
  };

  // Assign a new absolute amount, pushed through undo/redo. `oldAssigned` is the
  // value to restore on undo (captured in the closure so the entry is
  // self-contained). Mirrors assign-input.tsx: await the write, push the undo
  // entry only after it lands, and toast on failure — the CTA has no other tell
  // that nothing happened.
  const assignWithUndo = (
    label: string,
    newAssigned: number,
    oldAssigned: number,
  ) => {
    startTransition(async () => {
      try {
        await updateAssigned(category.id, month, newAssigned);
        onMutate?.({
          label,
          forward: async () => {
            await updateAssigned(category.id, month, newAssigned);
          },
          backward: async () => {
            await updateAssigned(category.id, month, oldAssigned);
          },
        });
      } catch {
        // No success toast — the progress ring and "To go" moving is the
        // feedback. A failure has none, so it needs one.
        toast({
          message: `Couldn't assign to ${category.name}. Your change wasn't saved.`,
          variant: "error",
        });
      }
    });
  };

  // Compute progress.
  // Funded-basis branches on target type:
  //   savings_balance → running balance (overspending lengthens the gap)
  //   monthly_funding → this month's assignment (recurring goal)
  //   spending / target_by_date → cumulative assignment (overspending is surfaced
  //     by the red Available pill, not by inflating the funding "to go")
  const balanceNeeded = target?.target_amount ?? 0;
  const assignedThisMonth = category.assigned;
  // Recurring dated targets are sinking funds — measure progress against the
  // current envelope balance (like savings_balance) so they refill each cycle.
  const fundedBasis =
    target?.recurring
      ? category.available
      : target?.type === "savings_balance"
        ? category.available
        : target?.type === "monthly_funding"
          ? assignedThisMonth
          : category.cumulative_assigned;
  const percent = balanceNeeded > 0 ? (fundedBasis / balanceNeeded) * 100 : 0;
  const toGo = Math.max(0, balanceNeeded - fundedBasis);

  // The deadline this target is actually measured against now — rolled forward
  // for recurring targets, the stored date otherwise.
  const effectiveDate = target ? effectiveTargetDate(target) : null;

  // Compute monthly suggestion when underfunded
  const monthlyNeeded = target ? computeMonthlyNeeded(target, toGo) : 0;
  const isOpenEnded = target?.type === "savings_balance" && !target.target_date;
  const underfunded = target
    ? isUnderfunded(category.available, assignedThisMonth, category.cumulative_assigned, target)
    : false;
  // Caps (Fill up to, no date) need their gap filled directly — assignedThisMonth
  // already counts toward cumulative_assigned, so subtracting it again would
  // under-fund the CTA. Refill / by-date targets ask for the per-month
  // contribution above what's already assigned.
  const deficit = !underfunded || !target ? 0
    : target.type === "spending" && !target.target_date
      ? toGo
      : Math.max(0, monthlyNeeded - assignedThisMonth);

  // Target description
  const targetDescription = target
    ? describeTarget(target.type, target.target_amount, fmt)
    : "";
  // Subtitle reflects the target's semantic, not its `frequency` field:
  //   savings_balance → "Over time" (open-ended saving)
  //   monthly_funding → "Each month" (always recurring, even when frequency=custom)
  //   spending        → "No deadline" (open-ended cap, doesn't reset)
  const targetSubtitle = target
    ? effectiveDate
      ? target.recurring
        ? `Every ${formatMonthDay(effectiveDate)}`
        : `By ${formatDate(effectiveDate)}`
      : target.type === "savings_balance"
        ? "Over time"
        : target.type === "monthly_funding"
          ? "Each month"
          : "No deadline"
    : "";

  // Context-aware labels — progress label matches the basis used to compute it.
  const totalLabel = effectiveDate
    ? `Total to assign by ${formatDate(effectiveDate)}`
    : "Balance needed";
  const progressLabel =
    target?.recurring
      ? "Current balance"
      : target?.type === "savings_balance"
        ? "Current balance"
        : target?.type === "monthly_funding"
          ? "Assigned this month"
          : "Assigned so far";

  // Icon mirrors the header status: warning when the target needs more
  // funding (deadline-style), filled flag otherwise. Skip when there is
  // no target yet — header reads as a plain "Target" card.
  const headerIcon = target ? (
    underfunded && !isOpenEnded && view !== "edit" ? (
      <AlertTriangle className="h-4 w-4 text-warning" />
    ) : (
      <Flag className="h-3.5 w-3.5 text-primary" fill="currentColor" />
    )
  ) : undefined;

  return (
    <CollapsiblePanel
      title="Target"
      icon={headerIcon}
      open={expanded}
      onToggle={() => setExpanded((e) => !e)}
    >
      {/* Empty state */}
      {view === "empty" && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            How much do you need for {category.name}?
          </p>
          <p className="text-sm text-muted-foreground">
            When you create a target, we&apos;ll let you know how much money
            to set aside to stay on track over time.
          </p>
          <Button size="sm" onClick={handleCreate}>
            Create target
          </Button>
        </div>
      )}

      {/* View state */}
      {view === "view" && target && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">{targetDescription}</p>
            <p className="text-sm text-muted-foreground">
              {targetSubtitle}
            </p>
          </div>

          <div className="h-px bg-border/50" />

          {/* Progress ring */}
          <div className="flex justify-center py-2">
            <ProgressRing percent={percent} color={colorForName(category.name)} />
          </div>

          {/* Open-ended savings — soft encouragement */}
          {isOpenEnded && toGo > 0 && (
            <div className="rounded-md bg-secondary border border-border px-3 py-3 text-sm space-y-2.5">
              <p className="text-center text-muted-foreground">
                Any amount moves you closer to your goal
              </p>
              <div className="flex flex-col gap-2">
                {[5, 10, 25].map((pct) => {
                  const amt = Math.round(toGo * (pct / 100) * 100) / 100;
                  return (
                    <Button
                      key={pct}
                      variant="outline"
                      size="sm"
                      className="w-full justify-between px-3 bg-card"
                      onClick={() =>
                        assignWithUndo(
                          `Assign ${fmt(amt)} to ${category.name}`,
                          assignedThisMonth + amt,
                          assignedThisMonth,
                        )
                      }
                    >
                      <span className="text-muted-foreground">{pct}%</span>
                      <span className="font-medium zero-amount">{fmt(amt)}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Underfunded CTA — deadline targets only */}
          {underfunded && !isOpenEnded && deficit > 0 && (
            <div className="rounded-md bg-primary/10 border border-primary/20 px-3 py-3 text-sm space-y-2.5">
              <p className="text-center">
                Assign{" "}
                <span className="font-semibold text-foreground zero-amount">
                  {fmt(deficit)} more
                </span>{" "}
                to meet your target
              </p>
              <Button
                size="default"
                className="w-full"
                onClick={() =>
                  assignWithUndo(
                    `Assign ${fmt(deficit)} to ${category.name}`,
                    assignedThisMonth + deficit,
                    assignedThisMonth,
                  )
                }
              >
                Assign
              </Button>
            </div>
          )}

          {/* Summary rows */}
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{totalLabel}</span>
              <span className="tabular-nums font-semibold zero-amount">{fmt(balanceNeeded)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{progressLabel}</span>
              <span className="tabular-nums font-semibold zero-amount">{fmt(fundedBasis)}</span>
            </div>
          </div>

          <div className="h-px bg-border/50" />

          <div className="flex justify-between text-sm font-semibold">
            <span>To go</span>
            <span className="tabular-nums zero-amount">{fmt(toGo)}</span>
          </div>

          <Button
            variant="outline"
            className="w-full bg-secondary hover:bg-secondary/80"
            size="default"
            onClick={() => setEditing(true)}
          >
            Edit target
          </Button>
        </div>
      )}

      {/* Edit state */}
      {view === "edit" && (
        <TargetForm
          target={target}
          onSave={handleSave}
          onDelete={target ? handleDelete : undefined}
          onCancel={handleCancel}
          saving={isSaving}
        />
      )}
    </CollapsiblePanel>
  );
}

function describeTarget(
  type: string,
  amount: number,
  fmt: (amount: number) => string,
): string {
  const formatted = fmt(amount);
  switch (type) {
    case "monthly_funding":
      return `Set aside ${formatted}`;
    case "savings_balance":
      return `Have a balance of ${formatted}`;
    case "target_by_date":
      return `Set aside ${formatted}`;
    case "spending":
      return `Fill up to ${formatted}`;
    default:
      return `Target: ${formatted}`;
  }
}


function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Recurring cadence reads as "Every Jan 1" — the year is implied by repetition.
function formatMonthDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
