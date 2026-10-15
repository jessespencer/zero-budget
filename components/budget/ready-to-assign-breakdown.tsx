"use client";

import { addMonths, format } from "date-fns";
import { PopoverTitle } from "@/components/ui/popover";
import { parseMonthKey } from "@/lib/format";
import {
  BreakdownNote,
  BreakdownRow,
  BreakdownTotal,
} from "@/components/shared/breakdown-list";

type ReadyToAssignBreakdownProps = {
  month: string; // "2026-04-01"
  readyToAssign: number;
  currentMonthIncome: number;
  currentMonthAssigned: number;
  totalIncome: number;
  totalAssigned: number;
  overspentLastMonth: number;
  openingCcDebt: number;
  futureAssigned: number;
};

/**
 * Signed-decomposition of the Ready-to-assign headline number. The engine
 * is the single source of truth — this component takes the same fields
 * `BudgetMonth` already returns and presents them as line items.
 *
 * Identity (verify at integer cents):
 *   inflowThisMonth
 *   - assignedThisMonth
 *   + priorMonthsNet
 *   - overspentPrev
 *   - openingCcDebt
 *   - displayedFuture
 *   === readyToAssign
 *
 * `displayedFuture = max(0, min(futureAssigned, curBeforeFuture))` — the
 * money assigned in *later* months that drains this month's pool (single
 * pool). It's capped at `curBeforeFuture` so the visible rows drain exactly to
 * zero when the future over-runs, and it's 0 when the current month is itself
 * over-assigned (cur < 0) so the negative stays on the current month. By
 * construction `displayedFuture === curBeforeFuture - readyToAssign` in every
 * branch, keeping the decomposition exact.
 *
 * The total row renders the `readyToAssign` *prop* (not a recomputation),
 * so even with rounding the visible total always matches the headline pill.
 */
export function ReadyToAssignBreakdown({
  month,
  readyToAssign,
  currentMonthIncome,
  currentMonthAssigned,
  totalIncome,
  totalAssigned,
  overspentLastMonth,
  openingCcDebt,
  futureAssigned,
}: ReadyToAssignBreakdownProps) {
  const inflowThisMonth = currentMonthIncome;
  const assignedThisMonth = currentMonthAssigned;
  const priorMonthsNet =
    totalIncome - currentMonthIncome - (totalAssigned - currentMonthAssigned);
  const overspentPrev = overspentLastMonth;

  // Pool the existing rows sum to, before future-month drain. The future row
  // is capped to this so the visible line items always reconcile to the total.
  const curBeforeFuture =
    totalIncome - totalAssigned - overspentLastMonth - openingCcDebt;
  const displayedFuture = Math.max(
    0,
    Math.min(futureAssigned, curBeforeFuture)
  );

  const monthDate = parseMonthKey(month);
  const monthLabel = format(monthDate, "MMMM");
  const prevMonthLabel = format(addMonths(monthDate, -1), "MMMM");

  const showFuture = Math.round(displayedFuture * 100) > 0;
  const showPriorMonths = Math.round(priorMonthsNet * 100) !== 0;
  const showOpeningCcDebt = Math.round(openingCcDebt * 100) > 0;
  const showOverspent = Math.round(overspentPrev * 100) > 0;

  return (
    <>
      <PopoverTitle>Ready to assign breakdown</PopoverTitle>

      <ul className="flex flex-col">
        <BreakdownRow
          label={`Inflow: ready to assign in ${monthLabel}`}
          amount={inflowThisMonth}
          sign="positive"
        />
        <BreakdownRow
          label={`Assigned in ${monthLabel}`}
          amount={-assignedThisMonth}
          sign="negative"
        />
        {showFuture && (
          <BreakdownRow
            label="Assigned in future months"
            amount={-displayedFuture}
            sign="negative"
          />
        )}
        {showPriorMonths && (
          <BreakdownRow
            label="Carried over from prior months"
            amount={priorMonthsNet}
            sign={priorMonthsNet >= 0 ? "positive" : "negative"}
          />
        )}
        {showOpeningCcDebt && (
          <BreakdownRow
            label="Carried CC debt"
            amount={-openingCcDebt}
            sign="negative"
          />
        )}
        {showOverspent && (
          <BreakdownRow
            label={`Overspent in ${prevMonthLabel}`}
            amount={-overspentPrev}
            sign="negative"
          />
        )}
      </ul>

      <BreakdownTotal label="Ready to assign" amount={readyToAssign} />

      {readyToAssign > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          Spread this across your categories to plan where it goes.
        </p>
      )}

      <BreakdownNote>
        Ready to assign is money that hasn&apos;t yet been assigned to a
        category. If something looks off, double-check recent transactions
        and account balances.
      </BreakdownNote>
    </>
  );
}
