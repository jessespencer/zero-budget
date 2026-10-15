"use client";

import { cn } from "@/lib/utils";
import { formatCurrencyParts, maskCurrencyParts } from "@/lib/format";
import { useAmountsHidden } from "./privacy-provider";
import { useFlashOnChange } from "./use-flash-on-change";

type CurrencyProps = {
  amount: number;
  className?: string;
  colorize?: boolean;
  /** Render cents at smaller size, raised to the top (superscript-style). */
  smallCents?: boolean;
  /**
   * Flash briefly when the amount changes (see useFlashOnChange). `true`
   * flashes on any change; a string is the reset scope — pass the month on
   * budget surfaces so month navigation doesn't flash everything.
   */
  flash?: boolean | string;
};

export function Currency({
  amount,
  className,
  colorize = true,
  smallCents = true,
  flash,
}: CurrencyProps) {
  const { hidden } = useAmountsHidden();
  const flashing = useFlashOnChange(
    amount,
    typeof flash === "string" ? flash : undefined
  );
  const { dollars, cents } = hidden
    ? maskCurrencyParts(amount)
    : formatCurrencyParts(amount);
  return (
    <span
      data-flash={flash ? flashing : undefined}
      className={cn(
        // `.zero-amount` marks this as a maskable money span for the
        // pre-hydration anti-flash blur (globals.css). Sign colorization is
        // kept while hidden — a negative still reads red — it just hides digits.
        "tabular-nums zero-amount",
        colorize && amount > 0 && "text-positive",
        colorize && amount < 0 && "text-negative",
        colorize && amount === 0 && "text-muted-foreground",
        className
      )}
    >
      {dollars}
      {smallCents && cents ? (
        <span className="text-[11px] leading-none ml-[1px] tracking-tight inline-block align-baseline -translate-y-[0.24em]">
          {cents}
        </span>
      ) : (
        cents
      )}
    </span>
  );
}
