"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InsightsSectionHeader } from "./insights-section-header";
import { SpendingDonutChart } from "./spending-donut-chart";
import { SpendingLegend } from "./spending-legend";
import { SpendingStats } from "./spending-stats";
import {
  SpendingTransactionsDialog,
  type SpendingDialogSelection,
} from "./spending-transactions-dialog";
import {
  formatMonthYear,
  getMonthKey,
  nextMonth,
  prevMonth,
} from "@/lib/format";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { EmptyState } from "@/components/shared/empty-state";
import type { SpendingData, SpendingItem } from "@/app/(app)/insights/actions";

type SpendingBreakdownProps = {
  spending: SpendingData;
  month: string;
};

export function SpendingBreakdown({ spending, month }: SpendingBreakdownProps) {
  const fmt = useMaskedCurrency();
  const [groupBy, setGroupBy] = useState<"categories" | "groups">("categories");
  const [dialogSelection, setDialogSelection] =
    useState<SpendingDialogSelection | null>(null);
  // The legend row last drilled into stays marked after the dialog closes,
  // so you can see where you were. Keyed by month + grouping so it resets
  // with the data it points at.
  const [lastViewed, setLastViewed] = useState<{ name: string; key: string } | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const items = groupBy === "categories" ? spending.byCategory : spending.byGroup;
  const label = groupBy === "categories" ? "Categories" : "Groups";
  const currentMonth = getMonthKey();
  const isCurrentMonth = month === currentMonth;

  // Single handler shared by donut + legend. Drilldown only applies to the
  // Categories tab — Groups would need a different query path (multi-category
  // by group), which is out of scope here. Transactions are resolved
  // synchronously from `spending.transactionsByCategory`, which is preloaded
  // server-side in getSpendingData — no async fetch, no loading state.
  const handleItemClick = useCallback(
    (item: SpendingItem) => {
      if (groupBy !== "categories") return;
      const names = item.categoryNames ?? [item.name];
      const preloaded = spending.transactionsByCategory;
      // Bucket: concat each category's rows, then re-sort (date DESC, amt ASC).
      const rows = names.flatMap((n) => preloaded[n] ?? []);
      if (names.length > 1) {
        rows.sort((a, b) => {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return a.amount - b.amount;
        });
      }
      setLastViewed({ name: item.name, key: `${month}|${groupBy}` });
      setDialogSelection({
        categoryName: item.name,
        isBucket: item.isBucket ?? false,
        monthKey: month,
        totalAmount: item.amount,
        rows,
      });
    },
    [groupBy, month, spending.transactionsByCategory]
  );

  const drilldownEnabled = groupBy === "categories";

  const navigateMonth = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === currentMonth) {
      params.delete("spendingMonth");
    } else {
      params.set("spendingMonth", next);
    }
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?");
  };

  return (
    <div className="flex flex-col gap-4">
      <InsightsSectionHeader
        title="Spending breakdown"
        subtitle="Where your money went, by category or group."
        calendarControl={
          <div className="flex items-center gap-2">
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous month"
                className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:text-muted-foreground/40"
                onClick={() => navigateMonth(prevMonth(month))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="min-w-[88px] text-center text-sm font-medium tabular-nums">
                {formatMonthYear(month)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next month"
                className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:text-muted-foreground/40"
                disabled={isCurrentMonth}
                onClick={() => navigateMonth(nextMonth(month))}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {/* Always rendered so the row width is stable across months —
                conditionally mounting this button visibly nudged the chevron. */}
            <Button
              variant="outline"
              size="sm"
              className={cn("text-xs", isCurrentMonth && "invisible pointer-events-none")}
              aria-hidden={isCurrentMonth}
              tabIndex={isCurrentMonth ? -1 : 0}
              onClick={() => navigateMonth(currentMonth)}
            >
              This month
            </Button>
          </div>
        }
        controls={
          <Tabs
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as "categories" | "groups")}
          >
            <TabsList>
              <TabsTrigger value="categories">Categories</TabsTrigger>
              <TabsTrigger value="groups">Groups</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* Left column: donut chart stacked above the stats card */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Donut chart card */}
          <div className="rounded-xl border border-border bg-card p-5 flex flex-col min-h-0 overflow-hidden lg:h-[700px]">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs text-muted-foreground">Total spending</p>
                <p className="text-2xl font-bold tabular-nums zero-amount">
                  {fmt(spending.totalSpending)}
                </p>
              </div>
            </div>
            {items.length > 0 ? (
              <SpendingDonutChart
                data={items}
                totalSpending={spending.totalSpending}
                onSliceClick={drilldownEnabled ? handleItemClick : undefined}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={Receipt}
                  message={`No spending in ${formatMonthYear(month)}.`}
                />
              </div>
            )}
          </div>

          {/* Stats card — aligned under the chart */}
          <SpendingStats spending={spending} />
        </div>

        {/* Legend table — spans the full height of the chart + stats column */}
        <div className="rounded-xl border border-border bg-card p-5 flex flex-col min-h-0 overflow-hidden">
          <SpendingLegend
            items={items}
            label={label}
            onItemClick={drilldownEnabled ? handleItemClick : undefined}
            activeName={
              lastViewed?.key === `${month}|${groupBy}` ? lastViewed.name : undefined
            }
          />
        </div>
      </div>

      <SpendingTransactionsDialog
        open={dialogSelection !== null}
        onOpenChange={(open) => {
          if (!open) setDialogSelection(null);
        }}
        selection={dialogSelection}
      />
    </div>
  );
}
