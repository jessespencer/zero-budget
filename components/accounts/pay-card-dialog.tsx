"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field-group";
import { DateInput } from "@/components/shared/date-input";
import { AccountCombobox } from "@/components/shared/account-combobox";
import { parseMoneyInput } from "@/lib/db-utils";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import {
  createTransferPairWithSnapshot,
  redoTransferPair,
  undoTransferPair,
} from "@/app/(app)/transfer-plan/actions";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";

export type PayCardSourceAccount = {
  id: string;
  name: string;
  currentBalance: number;
  isPrimary: boolean;
};

type PayCardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  cardName: string;
  currentBalance: number;
  sourceAccounts: PayCardSourceAccount[];
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function pickDefaultSource(accounts: PayCardSourceAccount[]): string {
  const primary = accounts.find((a) => a.isPrimary);
  if (primary) return primary.id;
  return accounts[0]?.id ?? "";
}

export function PayCardDialog({
  open,
  onOpenChange,
  cardId,
  cardName,
  currentBalance,
  sourceAccounts,
}: PayCardDialogProps) {
  // Credit-card balances are stored negative (debt). Balance owed is the
  // absolute value when the card is in debt; a $0 or positive balance has
  // nothing to pre-fill so the user types from scratch.
  const balanceOwed = currentBalance < 0 ? Math.abs(currentBalance) : 0;

  const [fromAccountId, setFromAccountId] = useState<string>(() =>
    pickDefaultSource(sourceAccounts)
  );
  const [amount, setAmount] = useState<string>(() =>
    balanceOwed > 0 ? balanceOwed.toFixed(2) : ""
  );
  const [amountFocused, setAmountFocused] = useState(false);
  const [date, setDate] = useState<string>(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fmt = useMaskedCurrency();
  const { hidden } = useAmountsHidden();
  const undoRedo = useUndoRedo();
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setFromAccountId(pickDefaultSource(sourceAccounts));
      setAmount(balanceOwed > 0 ? balanceOwed.toFixed(2) : "");
      setDate(todayIso());
      setError(null);
    }
  }, [open, sourceAccounts, balanceOwed]);

  const parsedAmount = parseMoneyInput(amount);
  const amountValid = parsedAmount !== null && parsedAmount > 0;
  const hasSource = sourceAccounts.length > 0;
  const canSubmit =
    !hidden &&
    hasSource &&
    fromAccountId !== "" &&
    amountValid &&
    date !== "" &&
    !pending;

  const comboboxAccounts = useMemo(
    () => sourceAccounts.map((a) => ({ id: a.id, name: a.name })),
    [sourceAccounts]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Privacy lock: amounts hidden, so no payment is recorded.
    if (hidden) return;
    if (!hasSource) {
      setError("Add a checking or savings account to pay from.");
      return;
    }
    if (!fromAccountId) {
      setError("Pick an account to pay from.");
      return;
    }
    if (!amountValid || parsedAmount === null) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const snapshot = await createTransferPairWithSnapshot({
          fromAccountId,
          toAccountId: cardId,
          amount: parsedAmount,
          date,
        });
        // Card payment is a transfer underneath; reuse the transfer pair's
        // redo/undo so the global undo stack treats it like any other transfer.
        // The snapshot is mutated in place across redo cycles because each redo
        // mints fresh txn ids that the next undo needs to delete.
        const entryId = undoRedo.push({
          label: "Pay card",
          forward: async () => {
            const next = await redoTransferPair(snapshot);
            Object.assign(snapshot, next);
          },
          backward: async () => {
            await undoTransferPair(snapshot);
          },
        });
        // The card's own balance updates on screen, but the source account is
        // debited off-screen — so the toast names the source rather than the
        // amount. No figure in the copy, matching the transfer-plan toasts: the
        // amount is what the user just typed, the account is what they can't see.
        const source = sourceAccounts.find((a) => a.id === snapshot.fromAccountId);
        toast({
          message: source
            ? `Paid ${cardName} from ${source.name}`
            : `Paid ${cardName}`,
          action: { label: "Undo", onClick: () => undoRedo.undoEntry(entryId) },
        });
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not record payment.");
      }
    });
  };

  const submitLabel = pending
    ? "Saving..."
    : amountValid && parsedAmount !== null
      ? `Pay ${fmt(parsedAmount)}`
      : "Pay";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay {cardName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {error && (
            <p role="alert" id="pay-card-error" className="text-sm text-negative">
              {error}
            </p>
          )}

          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">
              {balanceOwed > 0 ? "Balance owed" : "Current balance"}
            </span>
            <span className="font-medium tabular-nums zero-amount">
              {fmt(balanceOwed > 0 ? balanceOwed : currentBalance)}
            </span>
          </div>

          <div className="rounded-xl border border-input py-6">
            <label htmlFor="pay-card-amount" className="sr-only">Amount</label>
            <input
              id="pay-card-amount"
              type="text"
              inputMode="decimal"
              placeholder={hidden ? "$••••••" : "$0.00"}
              value={
                hidden
                  ? ""
                  : amount
                    ? amountFocused
                      ? `$${amount}`
                      : `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : ""
              }
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                setError(null);
              }}
              onFocus={() => setAmountFocused(true)}
              onBlur={() => setAmountFocused(false)}
              required
              aria-required="true"
              aria-describedby={error ? "pay-card-error" : undefined}
              autoFocus
              disabled={hidden || pending}
              className="w-full text-center text-4xl font-bold tracking-tight bg-transparent outline-none placeholder:text-muted-foreground/40"
            />
          </div>

          {balanceOwed > 0 && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setAmount(balanceOwed.toFixed(2));
                  setError(null);
                }}
                disabled={hidden || pending}
                className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Full balance ({fmt(balanceOwed)})
              </button>
            </div>
          )}

          <FieldGroup label="Pay from" htmlFor="pay-card-from">
            <AccountCombobox
              value={fromAccountId}
              accounts={comboboxAccounts}
              onChange={(id) => {
                setFromAccountId(id);
                setError(null);
              }}
              placeholder={hasSource ? "Pay from" : "No accounts available"}
            />
          </FieldGroup>

          <FieldGroup label="Date" htmlFor="pay-card-date">
            <DateInput
              id="pay-card-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              required
              aria-required="true"
            />
          </FieldGroup>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={!canSubmit} aria-busy={pending}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
