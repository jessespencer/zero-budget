"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  undoBalanceAdjustment,
  updateAccountBalanceWithSnapshot,
} from "@/app/(app)/transfer-plan/actions";
import type { BalanceAdjustmentSnapshot } from "@/lib/balance";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";
import { cn } from "@/lib/utils";

type AdjustBalanceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountName: string;
  currentBalance: number;
  isDebt: boolean;
};

export function AdjustBalanceDialog({
  open,
  onOpenChange,
  accountId,
  accountName,
  currentBalance,
  isDebt,
}: AdjustBalanceDialogProps) {
  // Credit cards: prefill the positive "amount owed" so the user edits a
  // friendly number, not the negative stored value. Everything else: raw.
  const initialValue = (isDebt ? Math.abs(currentBalance) : currentBalance).toFixed(2);
  const [value, setValue] = useState<string>(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const fmt = useMaskedCurrency();
  const { hidden } = useAmountsHidden();
  const { push: pushUndoEntry, undoEntry } = useUndoRedo();
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setValue((isDebt ? Math.abs(currentBalance) : currentBalance).toFixed(2));
      setError(null);
      // Focus + select after dialog mount animation
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, currentBalance, isDebt]);

  const parsed = parseFloat(value);
  const isValid = Number.isFinite(parsed);
  // For credit cards, the user types positive "amount owed" but the stored
  // balance is negative. The effective new balance is -|parsed|, so the
  // displayed adjustment diff is computed against that to mirror what the
  // server will actually write.
  const effectiveNewBalance = isValid
    ? isDebt
      ? -Math.abs(parsed)
      : parsed
    : currentBalance;
  const diff = effectiveNewBalance - currentBalance;
  const willChange = isValid && Math.abs(diff) >= 0.005;

  // Sentiment for the diff label:
  //   - Non-debt: positive diff is good (balance up) → text-positive.
  //   - Debt: positive diff means LESS owed (e.g. -5000 from -8000 is +3000)
  //     which is good for the user → text-positive. Negative diff means more
  //     owed → text-negative. The math works out the same as non-debt because
  //     a less-negative balance produces a positive diff.
  const diffIsPositive = diff >= 0;

  const handleConfirm = () => {
    // Privacy lock: amounts hidden, so no adjustment is written.
    if (hidden) return;
    if (!isValid) {
      setError("Enter a number.");
      return;
    }
    if (!willChange) {
      onOpenChange(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        // Pass `parsed` as-typed; the server negates for credit cards. Single
        // source of truth for the sign rule lives in the action.
        const snapshot = await updateAccountBalanceWithSnapshot(
          accountId,
          parsed
        );
        // Each redo mints a fresh synthetic txn, so the next backward() has to
        // delete the newest one, not the original. Same ref idiom as Reconcile.
        const ref: { current: BalanceAdjustmentSnapshot } = { current: snapshot };
        const entryId = pushUndoEntry({
          label: "Adjust balance",
          forward: async () => {
            ref.current = await updateAccountBalanceWithSnapshot(
              accountId,
              parsed
            );
          },
          backward: async () => {
            await undoBalanceAdjustment(ref.current);
          },
        });
        // Adjusting writes a real "Balance adjustment" transaction against
        // Ready to assign, a number that lives on /budget rather than here. The
        // sidebar renders AccountMenu's pencil variant on every page, so this
        // fires from /insights or /schedules too — neither renders undo buttons
        // nor mounts a Cmd+Z handler, which makes the toast the only affordance
        // there. No amount in the copy: it would be the one unmasked figure on
        // screen in privacy mode.
        toast({
          message: `Balance adjusted for ${accountName}`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not adjust balance.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Adjust balance for &ldquo;{accountName}&rdquo;</DialogTitle>
          <DialogDescription>
            {isDebt
              ? "What you currently owe on this card. An adjustment transaction will be created automatically to reconcile the difference."
              : "An adjustment transaction will be created automatically to reconcile the difference."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <label htmlFor="current-balance" className="text-xs text-muted-foreground">
              Current balance
            </label>
            <div
              id="current-balance"
              className={cn(
                "tabular-nums zero-amount text-lg font-medium",
                currentBalance >= 0 ? "text-foreground" : "text-negative"
              )}
            >
              {fmt(currentBalance)}
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="new-balance" className="text-xs text-muted-foreground">
              {isDebt ? "Amount owed" : "New balance"}
            </label>
            <Input
              id="new-balance"
              ref={inputRef}
              type="number"
              inputMode="decimal"
              step="0.01"
              value={hidden ? "" : value}
              placeholder={hidden ? "$••••••" : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !pending) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              disabled={hidden || pending}
              className="tabular-nums"
            />
          </div>

          {willChange ? (
            <div className="text-sm text-muted-foreground">
              Adjustment transaction:{" "}
              <span
                className={cn(
                  "tabular-nums zero-amount font-medium",
                  diffIsPositive ? "text-positive" : "text-negative"
                )}
              >
                {diffIsPositive ? "+" : ""}
                {fmt(diff)}
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="text-sm text-negative" role="status">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={hidden || pending || !isValid}>
            {willChange ? "Adjust balance" : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
