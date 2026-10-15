"use client";

import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Currency } from "@/components/shared/currency";
import { availableCents } from "@/lib/db-utils";

// Non-interactive counterpart to AvailablePill (available-pill.tsx). That
// component is a MoveMoneyPopover trigger with target-aware states; this one
// renders only the three states derivable from the available number alone —
// the same subset getPillState resolves to with a null target. Keep the
// intent mapping in sync with stateBadgeClass there.
export function AvailableBadge({
  available,
  className,
}: {
  available: number;
  className?: string;
}) {
  const cents = availableCents(available);
  const intent =
    cents < 0 ? "badge-negative" : cents === 0 ? "badge-neutral" : "badge-positive";
  return (
    <span
      className={cn(
        "badge",
        intent,
        // Same footprint as the budget page's available pill: 14px numerals,
        // tighter left inset when the overspent triangle is present.
        cents < 0 ? "pl-1.5" : "pl-2.5",
        "shrink-0 pr-2.5 py-0.5 text-[14px] tabular-nums",
        className
      )}
    >
      {cents < 0 && <TriangleAlert className="h-[13px] w-[13px]" />}
      <Currency amount={available} colorize={false} smallCents={false} />
    </span>
  );
}
