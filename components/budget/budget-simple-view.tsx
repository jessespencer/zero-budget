"use client";

import { ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Currency } from "@/components/shared/currency";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { availableCents } from "@/lib/db-utils";
import { fundedBasis } from "@/lib/target-utils";
import { isUnderfunded } from "./available-pill";
import { CategoryIcon, splitLeadingEmoji } from "./category-icon";
import { OPEN_ROW_CLASS } from "@/lib/row-classes";
import type { CategoryGroupWithCategories, CategoryWithBudget } from "@/lib/types";

type Tone = "negative" | "warning" | "positive" | "neutral";

const toneText: Record<Tone, string> = {
  negative: "text-negative",
  warning: "text-warning",
  positive: "text-positive",
  neutral: "text-muted-foreground",
};

const toneBar: Record<Tone, string> = {
  negative: "bg-negative",
  warning: "bg-warning",
  positive: "bg-positive",
  neutral: "bg-muted-foreground/40",
};

function toneFor(category: CategoryWithBudget): Tone {
  // Cents, not the engine's raw float — same gate as the grid's pill and the
  // Overspent filter, so a break-even category doesn't flash red here.
  const available = availableCents(category.available);
  if (available < 0) return "negative";
  if (
    isUnderfunded(available, category.assigned, category.cumulative_assigned, category.target)
  ) {
    return "warning";
  }
  return available > 0 ? "positive" : "neutral";
}

type SimpleGroup = {
  group: CategoryGroupWithCategories;
  categories: CategoryWithBudget[];
};

type BudgetSimpleViewProps = {
  groups: SimpleGroup[];
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (groupId: string, altKey: boolean) => void;
  onSelectCategory: (id: string) => void;
  selectedCategoryId: string | null;
  month: string;
  className?: string;
};

/**
 * Read-first budget layout: each group is a card, each category a row with its
 * available amount and (when it has a target) progress toward it. No inputs —
 * tapping a row opens the category detail panel, which is where editing lives.
 * Shares the grid's expanded-groups state and `data-budget-group*` hooks, so
 * the pre-hydration collapse script in budget/page.tsx covers this view too.
 */
export function BudgetSimpleView({
  groups,
  expandedGroups,
  onToggleGroup,
  onSelectCategory,
  selectedCategoryId,
  month,
  className,
}: BudgetSimpleViewProps) {
  return (
    // Content column matches the transfer plan's max-w-2xl (42rem); the max
    // width adds back the side padding so the cards themselves land at 42rem.
    <div className={cn("flex flex-col gap-4 p-4 md:p-6 pb-12 max-w-[calc(42rem+2rem)] md:max-w-[calc(42rem+3rem)] mx-auto w-full", className)}>
      {groups.map(({ group, categories }) => {
        const expanded = expandedGroups[group.id] ?? true;
        return (
          <section
            key={group.id}
            data-budget-group={group.id}
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            <button
              type="button"
              onClick={(e) => onToggleGroup(group.id, e.altKey)}
              aria-expanded={expanded}
              className="w-full flex items-center justify-between gap-3 px-4 h-16 bg-accent/40 text-left cursor-pointer"
            >
              <span className="flex items-center gap-2 min-w-0">
                <ChevronRight
                  data-budget-group-chevron
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 shrink-0 text-foreground/50 transition-transform duration-150",
                    expanded && "rotate-90"
                  )}
                  strokeWidth={2}
                />
                <h3 className="text-lg font-extrabold text-foreground truncate">
                  {group.name}
                </h3>
              </span>
              <Currency
                flash={month}
                amount={group.groupAvailable}
                colorize={false}
                smallCents={false}
                className="text-lg font-extrabold shrink-0"
              />
            </button>
            {expanded && (
              <ul data-budget-group-children className="divide-y divide-border">
                {categories.map((category) => (
                  <SimpleCategoryRow
                    key={category.id}
                    category={category}
                    groupName={group.name}
                    selected={category.id === selectedCategoryId}
                    month={month}
                    onSelect={onSelectCategory}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SimpleCategoryRow({
  category,
  groupName,
  selected,
  onSelect,
  month,
}: {
  category: CategoryWithBudget;
  groupName: string;
  selected: boolean;
  month: string;
  onSelect: (id: string) => void;
}) {
  const fmt = useMaskedCurrency();
  const tone = toneFor(category);
  const { label } = splitLeadingEmoji(category.name);
  const { target } = category;
  const available = availableCents(category.available);

  const basis = target
    ? fundedBasis(available, category.assigned, category.cumulative_assigned, target)
    : 0;
  const hasGoal = !!target && target.target_amount > 0;
  const percent = hasGoal && target ? Math.min(Math.max(basis / target.target_amount, 0), 1) : 0;

  let detail: string;
  if (available < 0) {
    detail = `Overspent by ${fmt(-available)}`;
  } else if (hasGoal && target) {
    detail = `${fmt(basis)} of ${fmt(target.target_amount)}`;
    if (target.target_date) {
      // Month precision only — build a local date so no timezone shifts it.
      const [y, m] = target.target_date.split("-").map(Number);
      detail += ` · by ${format(new Date(y, m - 1, 1), "MMM yyyy")}`;
    }
  } else if (category.activity < 0) {
    detail = `Spent ${fmt(-category.activity)} this month`;
  } else {
    detail = "Nothing spent this month";
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(category.id)}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/30 transition-colors cursor-pointer",
          selected && OPEN_ROW_CLASS
        )}
      >
        <CategoryIcon name={category.name} groupName={groupName} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium text-foreground truncate">{label}</div>
          <div
            className={cn(
              "text-[13px] truncate zero-amount",
              tone === "negative" || tone === "warning" ? toneText[tone] : "text-muted-foreground"
            )}
          >
            {detail}
          </div>
          {hasGoal && (
            <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden" aria-hidden="true">
              <div
                // Width eases so an assign visibly fills the bar.
                className={cn("h-full rounded-full transition-[width] duration-500 ease-out", toneBar[tone])}
                style={{ width: `${percent * 100}%` }}
              />
            </div>
          )}
        </div>
        <Currency
          flash={month}
          amount={available}
          colorize={false}
          smallCents={false}
          className={cn("text-[15px] font-semibold shrink-0", toneText[tone])}
        />
      </button>
    </li>
  );
}
