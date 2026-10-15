import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { availableCents } from "@/lib/db-utils";
import { isUnderfunded } from "./available-pill";
import type { CategoryWithBudget } from "@/lib/types";

export type BudgetFilter =
  | "all"
  | "overspent"
  | "underfunded"
  | "overfunded"
  | "money_available";

type BudgetFilterBarProps = {
  // Page actions (add group, undo/redo, view, overview) pinned to the right
  // of the filters, so the budget has one control row instead of two.
  actions?: ReactNode;
  // Stand-in for `actions` when the bar is narrow (Overview docked, small
  // windows): typically a single overflow menu holding the same actions.
  compactActions?: ReactNode;
  categories: CategoryWithBudget[];
  activeFilter: BudgetFilter;
  onFilterChange: (filter: BudgetFilter) => void;
};

export function matchesFilter(
  category: CategoryWithBudget,
  filter: BudgetFilter
): boolean {
  // Compare the cents the user sees, not the engine's raw float — see
  // availableCents. A break-even category sits at ~-1e-13 and would otherwise
  // stay pinned in Overspent behind a $0.00 pill.
  const available = availableCents(category.available);
  switch (filter) {
    case "all":
      return true;
    case "overspent":
      return available < 0;
    case "underfunded":
      return isUnderfunded(available, category.assigned, category.cumulative_assigned, category.target);
    case "overfunded":
      return (
        category.target !== null &&
        available > category.target.target_amount
      );
    case "money_available":
      return available > 0;
  }
}

type FilterDef = {
  key: BudgetFilter;
  label: string;
  showCount?: boolean;
  variant?: "default" | "negative";
};

const filters: FilterDef[] = [
  { key: "all", label: "All" },
  { key: "overspent", label: "Overspent", showCount: true, variant: "negative" },
  { key: "underfunded", label: "Underfunded" },
  { key: "overfunded", label: "Overfunded" },
  { key: "money_available", label: "Money available" },
];

export function BudgetFilterBar({
  actions,
  compactActions,
  categories,
  activeFilter,
  onFilterChange,
}: BudgetFilterBarProps) {
  return (
    // 55px = 38px chips + 8px above and below + 1px border, so the space
    // around the chips matches the 8px gap between them. budget-table's
    // sticky column-header offset (top-[55px]) depends on this height.
    // @container: below 56rem (the ~894px of content the full row needs) the chips shrink and the actions fold into
    // compactActions, so everything stays on one row without scrolling.
    <div className="@container flex items-center gap-3 pl-2 pr-3 h-[55px] border-b border-border/50 bg-background sticky top-0 z-20">
      {/* Chips scroll on their own when the column is narrow (Overview
          docked), so the actions on the right never get pushed off-screen. */}
      <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
      {filters.map((f) => {
        const count = f.showCount
          ? categories.filter((c) => matchesFilter(c, f.key)).length
          : 0;
        const isActive = activeFilter === f.key;

        // Skip showing overspent pill if count is 0
        if (f.showCount && count === 0 && !isActive) return null;

        return (
          <button
            key={f.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onFilterChange(isActive && f.key !== "all" ? "all" : f.key)}
            className={cn(
              // font-bold, not font-action: chips keep the heavier weight that
              // reads well at this size after buttons were softened to 600.
              "inline-flex items-center gap-1.5 rounded-pill font-bold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              "px-3.5 py-1.5 text-[13px] @[56rem]:px-5 @[56rem]:py-2 @[56rem]:text-sm",
              isActive
                ? f.variant === "negative"
                  ? "bg-negative/15 text-negative ring-1 ring-negative/30"
                  : "surface-brand"
                : f.variant === "negative"
                  ? "bg-negative/10 text-negative hover:bg-negative/15"
                  : "surface-card"
            )}
          >
            {f.showCount && count > 0 && (
              <TriangleAlert className="h-3.5 w-3.5" />
            )}
            {f.showCount && count > 0 ? `${count} ${f.label}` : f.label}
          </button>
        );
      })}
      </div>
      {actions && (
        <div className="ml-auto hidden @[56rem]:flex items-center gap-1 shrink-0">
          {actions}
        </div>
      )}
      {compactActions && (
        <div className="ml-auto flex @[56rem]:hidden items-center shrink-0">
          {compactActions}
        </div>
      )}
    </div>
  );
}
