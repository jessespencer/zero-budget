"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Header stat strip, right side of an h-[88px] page header (budget, transfer
// plan). Hero + ledger: one large headline figure, then a hairline and a
// quiet label/value list of the figures it's computed from. No card, no
// per-cell dividers — the header band is the surface. Give the header pr-6
// so the hero's hover wash doesn't kiss the edge.

export const STAT_EYEBROW_CLASS =
  "text-xs text-muted-foreground font-medium whitespace-nowrap";

/** The hero figure. Color it via the caller (text-positive / text-negative-strong). */
export const STAT_VALUE_CLASS =
  "text-[28px] font-extrabold tabular-nums zero-amount tracking-[-0.02em] leading-none whitespace-nowrap";

/**
 * Hero chrome. Exported so the hero can be whatever element it needs to be —
 * usually a popover-trigger <button> that opens the breakdown. The negative
 * margin cancels the padding so the figure aligns with the header edge while
 * the hover wash still has room.
 */
export function statHeroClass(interactive = false) {
  return cn(
    "flex flex-col items-end justify-center gap-1.5 rounded-lg px-3 py-2 -mx-3",
    interactive &&
      "cursor-pointer transition-colors hover:bg-card focus-visible:outline-none focus-visible:bg-card"
  );
}

export function StatStrip({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("ml-auto flex items-center gap-6 shrink-0", className)}
      {...props}
    />
  );
}

/**
 * The supporting list beside the hero, preceded by a hairline. Hidden below
 * lg — the hero alone carries the header on narrow screens.
 */
export function StatLedger({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("hidden lg:flex items-center gap-6", className)} {...props}>
      <div aria-hidden="true" className="w-px self-stretch my-1 bg-border" />
      <dl className="flex flex-col gap-0.5">{children}</dl>
    </div>
  );
}

type StatCellProps = Omit<ComponentProps<"div">, "children"> & {
  label: ReactNode;
  children: ReactNode;
  /** Classes for the value (color). */
  valueClassName?: string;
  /** One-line explainer shown on hover — what the figure means. */
  hint?: string;
};

/** One ledger row: label left, value right. Goes inside `StatLedger`. */
export function StatCell({
  label,
  children,
  valueClassName,
  hint,
  className,
  ...props
}: StatCellProps) {
  const row = (
    <div
      className={cn(
        "flex items-baseline justify-between gap-6 min-w-44 text-[13px] leading-[18px]",
        hint && "cursor-help",
        className
      )}
      {...props}
    >
      <dt className="text-muted-foreground whitespace-nowrap">{label}</dt>
      <dd className={cn("font-bold tabular-nums zero-amount whitespace-nowrap", valueClassName)}>
        {children}
      </dd>
    </div>
  );
  if (!hint) return row;
  return (
    <Tooltip>
      <TooltipTrigger delay={150} render={row} />
      <TooltipContent side="bottom" className="max-w-64 text-center">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}
