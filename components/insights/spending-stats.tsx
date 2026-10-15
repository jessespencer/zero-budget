"use client";

import { cn } from "@/lib/utils";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import type { SpendingData } from "@/app/(app)/insights/actions";

type SpendingStatsProps = {
  spending: SpendingData;
};

export function SpendingStats({ spending }: SpendingStatsProps) {
  const fmt = useMaskedCurrency();
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        <StatItem
          label="Average monthly spending"
          value={fmt(spending.totalSpending)}
          valueIsAmount
        />
        <StatItem
          label="Average daily spending"
          value={fmt(spending.avgDaily)}
          valueIsAmount
        />
        <StatItem
          label="Most frequent category"
          value={spending.mostFrequentCategory?.name ?? "—"}
          sub={
            spending.mostFrequentCategory
              ? `${spending.mostFrequentCategory.count} transactions`
              : undefined
          }
        />
        <StatItem
          label="Largest outflow"
          value={spending.largestOutflow?.payee ?? "—"}
          sub={
            spending.largestOutflow
              ? fmt(spending.largestOutflow.amount)
              : undefined
          }
          subIsAmount
        />
      </div>
    </div>
  );
}

function StatItem({
  label,
  value,
  sub,
  valueIsAmount,
  subIsAmount,
}: {
  label: string;
  value: string;
  sub?: string;
  valueIsAmount?: boolean;
  subIsAmount?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold mt-0.5", valueIsAmount && "zero-amount")}>
        {value}
      </p>
      {sub && (
        <p
          className={cn(
            "text-sm text-muted-foreground mt-0.5",
            subIsAmount && "zero-amount"
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
