"use client";

import type { ReactNode } from "react";
import { CircleMinus, CirclePlus, Info } from "lucide-react";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { cn } from "@/lib/utils";

// Building blocks for a header figure's "how is this computed" popover:
// signed line items, a total that matches the headline, and an info note.
// Used by the Ready to assign and Transfer plan Remaining breakdowns.

type BreakdownRowProps = {
  label: string;
  amount: number;
  sign: "positive" | "negative";
};

export function BreakdownRow({ label, amount, sign }: BreakdownRowProps) {
  const fmt = useMaskedCurrency();
  const Icon = sign === "positive" ? CirclePlus : CircleMinus;
  const iconClass =
    sign === "positive" ? "text-positive" : "text-muted-foreground";
  return (
    <li className="flex items-center gap-2.5 py-2 text-sm">
      <Icon className={cn("h-4 w-4 shrink-0", iconClass)} aria-hidden="true" />
      <span className="flex-1">{label}</span>
      <span className="tabular-nums zero-amount">{fmt(amount)}</span>
    </li>
  );
}

/** Divider + total row. Pass the headline value itself, not a recomputation. */
export function BreakdownTotal({ label, amount }: { label: string; amount: number }) {
  const fmt = useMaskedCurrency();
  const cents = Math.round(amount * 100);
  return (
    <>
      <div className="h-px bg-border my-2" />
      <div className="flex items-center justify-between py-2 font-semibold">
        <span>{label}</span>
        <span
          className={cn(
            "tabular-nums zero-amount",
            cents < 0 ? "text-negative" : cents === 0 ? "text-positive" : undefined
          )}
        >
          {fmt(amount)}
        </span>
      </div>
    </>
  );
}

export function BreakdownNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 mt-4 rounded-lg bg-info/10 p-3 text-xs text-info ring-1 ring-info/20">
      <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
