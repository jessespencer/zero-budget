"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ArrowLeftRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { deleteQuickTransaction } from "@/app/(app)/transactions/actions";

// Minimal sheet for transfer rows on /quick. Transfer editing is OOS in v1
// (260515-xa7), so this surfaces only a delete action. The underlying
// `deleteQuickTransaction` → `deleteTransaction` server action cascades to
// the sibling leg (260518-fqy), so a single tap removes both legs and
// reverses both balances.
//
// Styling mirrors RecentEditSheet conventions: rounded-full pill buttons,
// var(--color-negative) for destructive, min-h-11 tap targets, back-button
// header. Sheet sizes to content (no fixed height) so the small surface
// doesn't take 85dvh like the full edit sheet.

type Account = { id: string; name: string };

export type TransferRowSummary = {
  transactionId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number; // absolute, displayed as the transfer size
};

type Props = {
  open: boolean;
  row: TransferRowSummary | null;
  accountById: Map<string, Account>;
  onClose: () => void;
};

export function TransferDeleteSheet({ open, row, accountById, onClose }: Props) {
  const { toast } = useToast();
  const fmt = useMaskedCurrency();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setConfirming(false);
      onClose();
    }
  };

  async function handleDelete() {
    if (!row) return;
    setPending(true);
    try {
      await deleteQuickTransaction(row.transactionId);
      toast({ message: "Transfer deleted", variant: "success", duration: 2500 });
      setConfirming(false);
      onClose();
    } catch {
      toast({
        message: "Could not delete — try again",
        variant: "error",
        duration: 2500,
      });
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  const fromName = row ? accountById.get(row.fromAccountId)?.name ?? "Unknown" : "";
  const toName = row ? accountById.get(row.toAccountId)?.name ?? "Unknown" : "";
  const amountLabel = row ? fmt(row.amount) : "";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="flex flex-col overflow-hidden rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)]"
      >
        {/* Drag handle — consistency with RecentEditSheet */}
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted-foreground/30" />

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition active:bg-accent"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <SheetHeader className="flex-1 items-center p-0">
            <SheetTitle className="text-base font-semibold">Transfer</SheetTitle>
          </SheetHeader>
          {/* Spacer to balance the back-button width on the right */}
          <div className="h-11 w-11" aria-hidden="true" />
        </div>

        <div className="flex flex-col px-4 pb-6">
          {/* Summary row — matches the Recent list row layout for visual
              continuity from tap → sheet */}
          <div className="flex items-center justify-between gap-3 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <ArrowLeftRight
                className="h-5 w-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate text-base font-medium">
                {fromName}
                {" → "}
                {toName}
              </span>
            </div>
            <span className="text-base tabular-nums">{amountLabel}</span>
          </div>

          {/* Delete row — inline confirmation mirrors RecentEditSheet's
              pattern (pill button, --color-negative). */}
          <div className="mt-4 border-t border-border pt-6">
            {confirming ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-foreground">
                  Delete this transfer? Both legs will be removed.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={pending}
                    className="min-h-11 flex-1 rounded-full border border-border px-4 py-2 text-base font-medium transition active:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={pending}
                    className={cn(
                      "min-h-11 flex-1 rounded-full border border-transparent px-4 py-2 text-base font-medium text-white transition",
                      "bg-[var(--color-negative)] active:opacity-90 disabled:opacity-60"
                    )}
                  >
                    {pending ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={pending}
                className="min-h-11 w-full rounded-full border border-[var(--color-negative)] px-4 py-2 text-base font-medium text-[var(--color-negative)] transition active:bg-accent"
              >
                Delete transfer
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
