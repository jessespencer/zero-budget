"use client";

import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { colorForName, BUCKET_COLOR } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import { OPEN_ROW_CLASS } from "@/lib/row-classes";
import type { SpendingItem } from "@/app/(app)/insights/actions";
import { TruncatedText } from "@/components/shared/truncated-text";

type SpendingLegendProps = {
  items: SpendingItem[];
  label: string;
  onItemClick?: (item: SpendingItem) => void;
  /** The item last drilled into — marked with the open-row treatment. */
  activeName?: string;
};

export function SpendingLegend({ items, label, onItemClick, activeName }: SpendingLegendProps) {
  const fmt = useMaskedCurrency();
  const clickable = Boolean(onItemClick);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em] pb-2 border-b border-border/50">
        <span>{label}</span>
        <span>Total spending</span>
      </div>
      <div className="flex-1 overflow-auto divide-y divide-border/30">
        {items.map((item) => {
          const swatch = item.isBucket ? BUCKET_COLOR : colorForName(item.name);
          const inner = (
            <>
              <div className="flex items-center justify-between">
                <TruncatedText className="text-sm font-medium mr-2">{item.name}</TruncatedText>
                <span className="text-sm tabular-nums shrink-0 zero-amount">
                  {fmt(item.amount)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, item.percent)}%`,
                      backgroundColor: swatch,
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                  {item.percent < 1 ? "<1" : Math.round(item.percent)}%
                </span>
              </div>
            </>
          );

          if (!clickable) {
            return (
              <div key={item.name} className="py-2.5 space-y-1 px-2">
                {inner}
              </div>
            );
          }

          return (
            <button
              key={item.name}
              type="button"
              onClick={() => onItemClick?.(item)}
              aria-current={item.name === activeName ? "true" : undefined}
              className={cn(
                "w-full text-left py-2.5 px-2 space-y-1 rounded-md transition-colors",
                "hover:bg-accent/30 cursor-pointer",
                item.name === activeName && OPEN_ROW_CLASS,
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              )}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}
