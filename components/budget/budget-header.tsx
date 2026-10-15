"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { MonthSelector } from "@/components/shared/month-selector";
import { useFlashOnChange } from "@/components/shared/use-flash-on-change";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  STAT_EYEBROW_CLASS,
  STAT_VALUE_CLASS,
  StatCell,
  StatLedger,
  StatStrip,
  statHeroClass,
} from "@/components/shared/stat-strip";
import { ReadyToAssignBreakdown } from "./ready-to-assign-breakdown";

type BudgetHeaderProps = {
  readyToAssign: number;
  creditCardDebt: number;
  // Breakdown fields surfaced in the Ready-to-assign popover (Task 2 wires
  // them through to `<ReadyToAssignBreakdown />`). Sourced from the budget
  // engine so the popover math is single-sourced.
  month: string;
  currentMonthIncome: number;
  currentMonthAssigned: number;
  // Sum of this month's category activity (negative = net spending). Shown
  // as "Spent" in the stat strip.
  currentMonthActivity: number;
  totalIncome: number;
  totalAssigned: number;
  overspentLastMonth: number;
  openingCcDebt: number;
  futureAssigned: number;
};

// Celebratory copy for the zero state — everything assigned. Picked
// once per mount so the message is stable while you're on the page (won't
// flip as you nudge things around zero) and rotates on refresh.
const ZERO_HEADLINES = [
  "Zero. All of it working.",
  "Right on Zero.",
  "Welcome to Zero.",
  "Zero by design.",
  "All of it, right where you meant it.",
];

export function BudgetHeader({
  readyToAssign,
  creditCardDebt,
  month,
  currentMonthIncome,
  currentMonthAssigned,
  currentMonthActivity,
  totalIncome,
  totalAssigned,
  overspentLastMonth,
  openingCcDebt,
  futureAssigned,
}: BudgetHeaderProps) {
  // Classify at integer-cent precision. The budget engine returns a float
  // sum, so true "zero" can arrive as ±0.0000000003 from float drift and
  // strict === 0 would mis-route it into the negative branch (rendering
  // a red -$0.00 even though the user landed perfectly on zero).
  const cents = Math.round(readyToAssign * 100);
  const isZero = cents === 0;
  // Nothing in and nothing assigned is a $0 balance, not a finished budget —
  // a brand-new install shouldn't open on a celebration.
  const isEmpty =
    isZero && Math.round(totalIncome * 100) === 0 && Math.round(totalAssigned * 100) === 0;
  const flash = useFlashOnChange(readyToAssign, month);
  const isNegative = cents < 0;
  const fmt = useMaskedCurrency();

  // Lazy init: pick once per mount. SSR will pick a (different) random
  // headline than the client; suppressHydrationWarning is set on the
  // rendering span so React keeps the client's pick without warning.
  const [zeroHeadline] = useState(
    () => ZERO_HEADLINES[Math.floor(Math.random() * ZERO_HEADLINES.length)]
  );

  return (
    <div className="relative flex items-center gap-6 pl-6 pr-6 h-[88px] border-b border-border bg-accent/40">
      {/* Canonical page heading. Visually hidden — the visible "May 2026"
          label inside MonthSelector serves as the contextual title; the SR
          rotor picks this up so /budget shows "Budget" alongside the other
          primary routes (260511-jlp). */}
      <h1 className="sr-only">Budget</h1>
      <MonthSelector />
      <StatStrip>
        {isEmpty ? (
          <div
            role="status"
            aria-label={`Ready to assign: ${fmt(readyToAssign)}`}
            className={statHeroClass()}
          >
            <span className={STAT_EYEBROW_CLASS}>Ready to assign</span>
            <span className={cn(STAT_VALUE_CLASS, "text-muted-foreground")}>
              {fmt(readyToAssign)}
            </span>
          </div>
        ) : isZero ? (
          // Zero state: non-interactive. Same status role + "Ready to
          // assign: …" label as the non-zero amount, so the figure is
          // announced (and locatable) in every state rather than only as a
          // rotating headline.
          <div
            role="status"
            aria-label={`Ready to assign: ${fmt(readyToAssign)}`}
            data-flash={flash}
            data-flash-ring
            className={cn(statHeroClass(), "animate-in fade-in duration-200")}
          >
            <span className={STAT_EYEBROW_CLASS}>Ready to assign</span>
            <span className="flex items-center gap-1.5 text-lg font-extrabold leading-none tracking-[-0.01em] whitespace-nowrap text-positive">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                <Check
                  className="h-2.5 w-2.5 text-primary-foreground"
                  strokeWidth={3.5}
                  aria-hidden="true"
                />
              </span>
              <span suppressHydrationWarning>{zeroHeadline}</span>
            </span>
          </div>
        ) : (
          // Non-zero: the cell is a button that opens the breakdown popover.
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  data-flash={flash}
                  data-flash-ring
                  className={statHeroClass(true)}
                >
                  <span className={STAT_EYEBROW_CLASS}>
                    {isNegative ? "Over-assigned" : "Ready to assign"}
                  </span>
                  {/* Polite live region: when assigning money or undoing,
                      the dollar amount changes and SR users hear the new
                      value without losing context. aria-atomic="true" so
                      the entire amount reads, not just the changed digit.
                      The live region is also the button's accessible name,
                      so no additional aria-label on the button is needed. */}
                  <span
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    aria-label={`Ready to assign: ${fmt(readyToAssign)}`}
                    className={cn(
                      STAT_VALUE_CLASS,
                      isNegative ? "text-negative-strong" : "text-positive"
                    )}
                  >
                    {fmt(readyToAssign)}
                  </span>
                </button>
              }
            />
            <PopoverContent
              align="end"
              side="bottom"
              sideOffset={8}
              className="w-[28rem]"
            >
              <ReadyToAssignBreakdown
                month={month}
                readyToAssign={readyToAssign}
                currentMonthIncome={currentMonthIncome}
                currentMonthAssigned={currentMonthAssigned}
                totalIncome={totalIncome}
                totalAssigned={totalAssigned}
                overspentLastMonth={overspentLastMonth}
                openingCcDebt={openingCcDebt}
                futureAssigned={futureAssigned}
              />
            </PopoverContent>
          </Popover>
        )}
        <StatLedger>
          <StatCell
            label="Assigned"
            hint="Total assigned to categories this month."
          >
            {fmt(currentMonthAssigned)}
          </StatCell>
          {/* Activity is signed negative for spending; flip it so the strip
              reads "Spent $X". A refund-heavy month shows a negative spend. */}
          <StatCell
            label="Spent"
            hint="Net spending across categories this month, after refunds."
          >
            {fmt(-currentMonthActivity)}
          </StatCell>
          {/* Only when SUM(active credit_card.current_balance) < 0; shown
              unsigned — the "debt" label conveys the sign. */}
          {creditCardDebt < 0 && (
            <StatCell
              label="Card debt"
              hint="Combined balance owed on your open credit cards."
              valueClassName="text-negative-strong"
            >
              {fmt(Math.abs(creditCardDebt))}
            </StatCell>
          )}
        </StatLedger>
      </StatStrip>
    </div>
  );
}
