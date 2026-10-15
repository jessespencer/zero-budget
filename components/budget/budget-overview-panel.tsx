"use client";

import { useState, useTransition } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseMonthKey } from "@/lib/format";
import { format } from "date-fns";
import { computeCategoryTargetDeficit } from "@/lib/target-utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SummaryRow } from "./summary-row";
import { ExpectedIncomeInput } from "./expected-income-input";
import { CollapsiblePanel } from "./collapsible-panel";
import { AutoAssignPreviewDialog } from "./auto-assign-preview-dialog";
import { CopyLastMonthDialog } from "./copy-last-month-dialog";
import {
  copyLastMonthBudgetWithSnapshot,
  getCopyLastMonthPreview,
  type CopyLastMonthMode,
  type CopyLastMonthPreview,
  fundUnderfundedWithSnapshot,
  restoreAssignedSnapshot,
} from "@/app/(app)/budget/actions";
import type { BudgetMonth, CategoryWithBudget } from "@/lib/types";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";

type BudgetOverviewPanelProps = {
  budget: BudgetMonth;
  onMutate: (entry: MutationEntry) => MutationId;
  undoEntry: (id: MutationId) => void;
  filteredCategories?: CategoryWithBudget[];
  /** Overrides the docked 420px column — the drawer passes `w-full`. */
  className?: string;
};

export function BudgetOverviewPanel({ budget, onMutate, undoEntry, filteredCategories, className }: BudgetOverviewPanelProps) {
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [targetsOpen, setTargetsOpen] = useState(true);
  const [autoAssignOpen, setAutoAssignOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyPreview, setCopyPreview] = useState<CopyLastMonthPreview | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const monthDate = parseMonthKey(budget.month);
  const monthName = format(monthDate, "MMMM");

  // Derived values — scoped to filtered categories when a filter is active
  const allCategories = budget.groups.flatMap((g) => g.categories);
  const scopedCategories = filteredCategories ?? allCategories;
  const isFiltered = !!filteredCategories;

  const currentMonthAssigned = scopedCategories.reduce(
    (sum, c) => sum + c.assigned,
    0
  );
  const currentMonthActivity = scopedCategories.reduce(
    (sum, c) => sum + c.activity,
    0
  );
  const currentMonthAvailable = scopedCategories.reduce(
    (sum, c) => sum + c.available,
    0
  );
  // Sum of every envelope's available balance (the "you have $X sitting in
  // categories" number). Always the full, unfiltered
  // total — a fact about the whole budget, independent of any grid filter.
  const totalInEnvelopes = allCategories.reduce((sum, c) => sum + c.available, 0);
  // Left over = available - assigned - activity (the cumulative balance before this month)
  const leftOverFromLastMonth = isFiltered
    ? currentMonthAvailable - currentMonthAssigned - currentMonthActivity
    : budget.readyToAssign + currentMonthAssigned;

  // Monthly target obligations — the "cost to be me" for this month. Reuses the
  // canonical per-category deficit math (the same computeCategoryTargetDeficit
  // the Underfunded filter and Fund-underfunded action use), so this total
  // agrees with them and correctly accounts for recurring targets and money
  // already assigned — instead of the hand-rolled to-go it used to sum.
  // Exception: open-ended savings goals (savings_balance, no date) carry no
  // monthly obligation in that math, but this "cost to be me" view still counts
  // their full remaining gap, so we add it back explicitly.
  const monthlyTargetTotal = scopedCategories.reduce((sum, cat) => {
    const target = cat.target;
    if (!target) return sum;
    if (target.type === "savings_balance" && !target.target_date) {
      return sum + Math.max(0, target.target_amount - cat.available);
    }
    return sum + computeCategoryTargetDeficit(cat);
  }, 0);

  const runCopyLastMonth = (mode: CopyLastMonthMode) => {
    startTransition(async () => {
      try {
        const snapshot = await copyLastMonthBudgetWithSnapshot(budget.month, mode);
        // `null` is the legitimate no-op — say which kind rather than leaving
        // it indistinguishable from a silent failure.
        if (!snapshot) {
          toast({
            message:
              mode === "fill-empty"
                ? "Nothing to fill — every category last month funded already has an amount."
                : "Nothing to copy — last month has no assignments.",
          });
          return;
        }
        const entryId = onMutate({
          label:
            mode === "fill-empty"
              ? "Fill empty categories from last month"
              : "Copy last month's budget",
          forward: async () => {
            await copyLastMonthBudgetWithSnapshot(budget.month, mode);
          },
          backward: async () => {
            await restoreAssignedSnapshot(budget.month, snapshot);
          },
        });
        // Writes assigned across many categories, mostly off-screen —
        // acknowledge it and offer Undo for *this* action.
        toast({
          message:
            mode === "fill-empty"
              ? `Filled ${snapshot.length} empty ${snapshot.length === 1 ? "category" : "categories"} from last month.`
              : `Copied last month's budget into ${snapshot.length} categories.`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        toast({
          message: "Couldn't copy last month's budget. Nothing was changed.",
          variant: "error",
        });
      }
    });
  };

  // Mid-month, a straight copy would overwrite work already assigned. Check
  // first: ask only when something would actually be replaced, otherwise copy.
  const handleCopyLastMonth = () => {
    startTransition(async () => {
      try {
        const preview = await getCopyLastMonthPreview(budget.month);
        if (preview.overwriteCount > 0) {
          setCopyPreview(preview);
          setCopyDialogOpen(true);
        } else {
          runCopyLastMonth("replace");
        }
      } catch {
        toast({
          message: "Couldn't copy last month's budget. Nothing was changed.",
          variant: "error",
        });
      }
    });
  };

  const handleFundUnderfundedConfirm = () => {
    startTransition(async () => {
      try {
        const snapshot = await fundUnderfundedWithSnapshot(budget.month);
        if (!snapshot) return;
        const entryId = onMutate({
          label: "Fund underfunded categories",
          forward: async () => {
            await fundUnderfundedWithSnapshot(budget.month);
          },
          backward: async () => {
            await restoreAssignedSnapshot(budget.month, snapshot);
          },
        });
        toast({
          message: `Funded ${snapshot.length} categories.`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        toast({
          message: "Couldn't fund the categories. Nothing was changed.",
          variant: "error",
        });
      } finally {
        // Close the dialog whatever happened — it used to sit open on failure
        // (the close ran after the await, which the throw skipped), so the flow
        // hung with the button re-enabled and no message.
        setPreviewOpen(false);
      }
    });
  };

  return (
    <div className={cn("flex flex-col h-full w-[420px] shrink-0 border-l border-border bg-background animate-in fade-in duration-150", className)}>
      {/* Header — title only, no underline. <div> not <h1>: the budget
          page already owns the canonical h1 (see budget-header.tsx). */}
      <div className="flex items-center px-6 pt-6 pb-4">
        <div className="page-title text-foreground">{monthName}</div>
      </div>

      {/* py-1 gives the active card's 1px box-shadow ring room to render
          inside this scroll container's overflow-auto bounds. */}
      <div className="flex-1 px-6 py-1 pb-6 space-y-5 overflow-auto">
        {/* Summary section — the one active card */}
        <CollapsiblePanel
          title={`${monthName}'s summary`}
          open={summaryOpen}
          active
          onToggle={() => setSummaryOpen(!summaryOpen)}
        >
          <SummaryRow flash={budget.month}
            label={isFiltered ? "Carry-forward" : "Left over from last month"}
            value={leftOverFromLastMonth}
          />
          <SummaryRow flash={budget.month}
            label={`Assigned in ${monthName}`}
            value={currentMonthAssigned}
          />
          <SummaryRow flash={budget.month}
            label="Activity"
            value={currentMonthActivity}
            muted={currentMonthActivity === 0}
          />
          <div className="h-px bg-border/50" />
          {isFiltered ? (
            <SummaryRow flash={budget.month}
              label="Available"
              value={currentMonthAvailable}
              className={cn(
                "font-semibold",
                currentMonthAvailable < 0 && "text-negative-strong"
              )}
            />
          ) : (
            <>
              {/* "Ready to assign" = money not yet handed to any envelope (can
                  go negative when over-assigned). Distinct from the envelope
                  total below — same word "Available" used to conflate them. */}
              <SummaryRow flash={budget.month}
                label="Ready to assign"
                value={budget.readyToAssign}
                className={cn(
                  "font-semibold",
                  budget.readyToAssign > 0 && "text-warning",
                  budget.readyToAssign < 0 && "text-negative-strong",
                  budget.readyToAssign === 0 && "text-positive"
                )}
              />
              <SummaryRow flash={budget.month}
                label="Total in envelopes"
                value={totalInEnvelopes}
                className="font-semibold"
              />
            </>
          )}
        </CollapsiblePanel>

        {/* Targets section */}
        <CollapsiblePanel
          title="Cost to be me"
          open={targetsOpen}
          onToggle={() => setTargetsOpen(!targetsOpen)}
        >
          <SummaryRow flash={budget.month}
            label={`${monthName}'s targets`}
            value={monthlyTargetTotal}
          />
          <ExpectedIncomeInput
            month={budget.month}
            forecast={budget.expectedIncome}
            received={budget.currentMonthIncome}
            onMutate={onMutate}
          />
        </CollapsiblePanel>

        {/* Auto-assign section — one primary (Fund underfunded); the rest
            secondary. Per the surface-ladder rule: one loud action per group.
            Fund underfunded covers both overspending and target pace. */}
        <CollapsiblePanel
          title="Auto-assign"
          icon={<Zap className="h-4 w-4 text-primary" fill="currentColor" />}
          open={autoAssignOpen}
          onToggle={() => setAutoAssignOpen(!autoAssignOpen)}
        >
          <Button
            size="default"
            className="w-full"
            disabled={isPending}
            onClick={() => setPreviewOpen(true)}
          >
            Fund underfunded
          </Button>
          <Button
            variant="outline"
            size="default"
            className="w-full bg-secondary hover:bg-secondary/80"
            disabled={isPending}
            onClick={handleCopyLastMonth}
          >
            Copy last month&apos;s budget
          </Button>
        </CollapsiblePanel>
      </div>

      <CopyLastMonthDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        preview={copyPreview}
        onChoose={runCopyLastMonth}
      />

      <AutoAssignPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        month={budget.month}
        onConfirm={handleFundUnderfundedConfirm}
        pending={isPending}
      />
    </div>
  );
}
