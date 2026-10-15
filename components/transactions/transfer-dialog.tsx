"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { fieldClass } from "@/lib/utils";
import { parseMoneyInput } from "@/lib/db-utils";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import {
  createTransferPairWithSnapshot,
  updateTransferPairWithSnapshot,
  undoTransferPair,
  redoTransferPair,
  undoTransferPairEdit,
  redoTransferPairEdit,
  type TransferPairSnapshot,
  type TransferPairEditSnapshot,
} from "@/app/(app)/transfer-plan/actions";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";

type AccountOption = { id: string; name: string };

// When present, the dialog edits an existing transfer instead of creating one.
// `txnId` is any one leg of the pair — the sibling is resolved server-side.
export type TransferEditTarget = {
  txnId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
};

type TransferDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountOption[];
  defaultFromAccountId?: string;
  defaultToAccountId?: string;
  defaultAmount?: number;
  // Fires after the write lands, for callers that need to react to it. The undo
  // entry and the toast are NOT the caller's job — the dialog owns both, so
  // every one of its three call sites behaves the same. Optional for that
  // reason: most callers now pass nothing.
  onConfirmed?: (snapshot: TransferPairSnapshot) => void;
  // Set to edit an existing transfer. When set, the create path is bypassed and
  // `onEdited` fires instead of `onConfirmed`.
  editTarget?: TransferEditTarget | null;
  onEdited?: (snapshot: TransferPairEditSnapshot) => void;
  // What the money movement is called in the toast and the undo label. The
  // transfer plan records credit-card payments through this same dialog, and
  // "Payment recorded" is what the user just clicked.
  noun?: "Transfer" | "Payment";
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransferDialog({
  open,
  onOpenChange,
  accounts,
  defaultFromAccountId,
  defaultToAccountId,
  defaultAmount,
  onConfirmed,
  editTarget,
  onEdited,
  noun = "Transfer",
}: TransferDialogProps) {
  const isEdit = !!editTarget;
  const { toast } = useToast();
  const { push: pushUndoEntry, undoEntry } = useUndoRedo();
  const [fromAccountId, setFromAccountId] = useState<string>(defaultFromAccountId ?? "");
  const [toAccountId, setToAccountId] = useState<string>(defaultToAccountId ?? "");
  const [amount, setAmount] = useState<string>(
    defaultAmount !== undefined ? defaultAmount.toFixed(2) : ""
  );
  const [amountFocused, setAmountFocused] = useState(false);
  const [date, setDate] = useState<string>(todayIso());
  // Create-only. An edit rewrites accounts/amount/date in place and leaves the
  // legs' memo alone, so the field is hidden there rather than shown blank.
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amountInputRef = useRef<HTMLInputElement>(null);
  const { hidden } = useAmountsHidden();

  // Reset when (re)opened so a previous session doesn't leak in. In edit mode
  // seed from the target pair; otherwise use the create defaults.
  useEffect(() => {
    if (open) {
      setFromAccountId(editTarget?.fromAccountId ?? defaultFromAccountId ?? "");
      setToAccountId(editTarget?.toAccountId ?? defaultToAccountId ?? "");
      setAmount(
        editTarget !== undefined && editTarget !== null
          ? editTarget.amount.toFixed(2)
          : defaultAmount !== undefined
            ? defaultAmount.toFixed(2)
            : ""
      );
      setDate(editTarget?.date ?? todayIso());
      setNote("");
      setError(null);
      if (editTarget || defaultAmount !== undefined) {
        requestAnimationFrame(() => {
          amountInputRef.current?.focus();
          amountInputRef.current?.select();
        });
      }
    }
  }, [open, editTarget, defaultFromAccountId, defaultToAccountId, defaultAmount]);

  const parsedAmount = parseMoneyInput(amount);
  const amountValid = parsedAmount !== null && parsedAmount > 0;
  const accountsChosen = fromAccountId !== "" && toAccountId !== "";
  const sameAccount = accountsChosen && fromAccountId === toAccountId;
  const canSubmit =
    !hidden && accountsChosen && !sameAccount && amountValid && date !== "" && !pending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Privacy lock: amounts hidden, so no transfer is recorded.
    if (hidden) return;
    if (!accountsChosen) {
      setError("Pick a from and to account.");
      return;
    }
    if (sameAccount) {
      setError("From and to accounts must be different.");
      return;
    }
    if (!amountValid || parsedAmount === null) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        // Two real transactions are written and two balances move, and on most
        // of the screens this dialog opens from, nothing visible changes:
        // QuickAdd lives in the sidebar on every page, and the transfer plan
        // derives from typed actual balances a transfer doesn't touch. So the
        // toast is the acknowledgement, and on some routes it's the only undo
        // affordance there is — undoEntry(id) rather than undo(), which would
        // pop whatever landed on top inside the toast's six seconds.
        //
        // No amount in the copy: it would be the one unmasked figure on screen
        // in privacy mode.
        if (editTarget) {
          const snapshot = await updateTransferPairWithSnapshot({
            txnId: editTarget.txnId,
            fromAccountId,
            toAccountId,
            amount: parsedAmount,
            date,
          });
          const entryId = pushUndoEntry({
            label: `Edit ${noun.toLowerCase()}`,
            forward: async () => {
              await redoTransferPairEdit(snapshot);
            },
            backward: async () => {
              await undoTransferPairEdit(snapshot);
            },
          });
          onEdited?.(snapshot);
          toast({
            message: `${noun} updated`,
            action: { label: "Undo", onClick: () => undoEntry(entryId) },
          });
        } else {
          const snapshot = await createTransferPairWithSnapshot({
            fromAccountId,
            toAccountId,
            amount: parsedAmount,
            date,
            memo: note,
          });
          // Each redo writes a fresh pair, so the next backward() has to target
          // the newest ids rather than the originals. Same ref idiom the
          // accounts dialogs use for their synthetic transactions.
          const ref: { current: TransferPairSnapshot } = { current: snapshot };
          const entryId = pushUndoEntry({
            label: `Record ${noun.toLowerCase()}`,
            forward: async () => {
              ref.current = await redoTransferPair(ref.current);
            },
            backward: async () => {
              await undoTransferPair(ref.current);
            },
          });
          onConfirmed?.(snapshot);
          toast({
            message: `${noun} recorded`,
            action: { label: "Undo", onClick: () => undoEntry(entryId) },
          });
        }
        onOpenChange(false);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : isEdit
              ? "Could not update transfer."
              : "Could not record transfer."
        );
      }
    });
  };

  const errorMessage = sameAccount
    ? "From and to accounts must be different."
    : error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit transfer" : "Record transfer"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {errorMessage && (
            <p role="alert" id="transfer-error" className="text-sm text-negative">
              {errorMessage}
            </p>
          )}

          <div className="rounded-xl border border-input py-6">
            <label htmlFor="transfer-amount" className="sr-only">Amount</label>
            <input
              id="transfer-amount"
              ref={amountInputRef}
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
              aria-describedby={errorMessage ? "transfer-error" : undefined}
              autoFocus
              disabled={hidden || pending}
              className="w-full text-center text-4xl font-bold tracking-tight bg-transparent outline-none placeholder:text-muted-foreground/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label="From" htmlFor="transfer-from-account">
              <AccountCombobox
                value={fromAccountId}
                accounts={accounts}
                onChange={(id) => {
                  setFromAccountId(id);
                  setError(null);
                }}
                placeholder="From account"
              />
            </FieldGroup>
            <FieldGroup label="To" htmlFor="transfer-to-account">
              <AccountCombobox
                value={toAccountId}
                accounts={accounts}
                onChange={(id) => {
                  setToAccountId(id);
                  setError(null);
                }}
                placeholder="To account"
              />
            </FieldGroup>
          </div>

          <FieldGroup label="Date" htmlFor="transfer-date">
            <DateInput
              id="transfer-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              required
              aria-required="true"
            />
          </FieldGroup>

          {!isEdit && (
            <div>
              <label htmlFor="transfer-note" className="sr-only">Note</label>
              <input
                id="transfer-note"
                placeholder="Add a note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={pending}
                className={fieldClass}
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
            <Button type="button" variant="ghost" size="lg" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={!canSubmit} aria-busy={pending}>
              {pending ? "Saving..." : isEdit ? "Save changes" : "Record transfer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
