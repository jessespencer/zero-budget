"use client";

import { PopoverTitle } from "@/components/ui/popover";
import {
  BreakdownNote,
  BreakdownRow,
  BreakdownTotal,
} from "@/components/shared/breakdown-list";
import type { TransferPlanResult } from "@/lib/transfer-engine";

type RemainingBreakdownProps = {
  result: TransferPlanResult;
  primaryAccountName: string;
};

/**
 * Line-item decomposition of the transfer plan's Remaining figure, mirroring
 * the engine (lib/transfer-engine.ts):
 *
 *   checkingActual
 *   − Σ savings transferAmount
 *   − Σ card paymentDue
 *   − Σ buffer available
 *   === remaining
 *
 * Zero-amount transfers and payments are left out. The total row shows
 * `summary.remaining` itself, so it always matches the header.
 */
export function RemainingBreakdown({ result, primaryAccountName }: RemainingBreakdownProps) {
  const { summary, savingsTransfers, creditCardPayments, buffers } = result;
  const transfers = savingsTransfers.filter((t) => Math.round(t.transferAmount * 100) > 0);
  const payments = creditCardPayments.filter((p) => Math.round(p.paymentDue * 100) > 0);
  const bufferTotal = buffers.reduce((s, b) => s + b.available, 0);

  return (
    <>
      <PopoverTitle>Remaining breakdown</PopoverTitle>

      <ul className="flex flex-col">
        <BreakdownRow
          label={`${primaryAccountName} balance`}
          amount={summary.checkingActual}
          sign="positive"
        />
        {transfers.map((t) => (
          <BreakdownRow
            key={t.accountId}
            label={`Transfer to ${t.accountName}`}
            amount={-t.transferAmount}
            sign="negative"
          />
        ))}
        {payments.map((p) => (
          <BreakdownRow
            key={p.accountId}
            label={`Pay ${p.accountName}`}
            amount={-p.paymentDue}
            sign="negative"
          />
        ))}
        {Math.round(bufferTotal * 100) !== 0 && (
          <BreakdownRow
            label={`Buffers kept in ${primaryAccountName}`}
            amount={-bufferTotal}
            sign="negative"
          />
        )}
      </ul>

      <BreakdownTotal label="Remaining" amount={summary.remaining} />

      <BreakdownNote>
        Remaining is what&apos;s left in {primaryAccountName} after this
        month&apos;s transfers, card payments, and buffers.{" "}
        {summary.remaining < 0
          ? "It's short by this much — move money in or trim a transfer."
          : "It's free to keep as a cushion or move somewhere useful."}{" "}
        Update the actual balances below if they&apos;ve changed.
      </BreakdownNote>
    </>
  );
}
