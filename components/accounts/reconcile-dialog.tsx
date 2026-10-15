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
import { CategoryCombobox } from "@/components/shared/category-combobox";
import {
  reconcileAccountWithSnapshot,
  redoReconciliation,
  type ReconcileSnapshot,
} from "@/app/(app)/accounts/[id]/actions";
import { undoBalanceAdjustment } from "@/app/(app)/transfer-plan/actions";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";
import { cn } from "@/lib/utils";

type CategoryRow = { id: string; name: string; category_group_id: string };
type CategoryGroupRow = { id: string; name: string; is_income: boolean; is_system?: boolean };

type ReconcileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountName: string;
  currentBalance: number;
  categories: CategoryRow[];
  categoryGroups: CategoryGroupRow[];
};

export function ReconcileDialog({
  open,
  onOpenChange,
  accountId,
  accountName,
  currentBalance,
  categories,
  categoryGroups,
}: ReconcileDialogProps) {
  const [value, setValue] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const fmt = useMaskedCurrency();
  const { hidden } = useAmountsHidden();
  const { push: pushUndoEntry, undoEntry } = useUndoRedo();
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      // Per design: picker is required fresh every reconcile -- no default
      // category, empty amount, no stale error.
      setValue("");
      setCategoryId("");
      setError(null);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  const parsed = parseFloat(value);
  const isValidAmount = Number.isFinite(parsed);
  const diff = isValidAmount ? parsed - currentBalance : 0;
  const hasGap = isValidAmount && Math.abs(diff) >= 0.005;
  const canSubmit =
    !hidden && !pending && isValidAmount && hasGap && categoryId !== "";

  const groupedCategories = categoryGroups
    .filter((g) => !g.is_income && !g.is_system)
    .map((group) => ({
      id: group.id,
      name: group.name,
      items: categories
        .filter((c) => c.category_group_id === group.id)
        .map((c) => ({ id: c.id, name: c.name })),
    }))
    .filter((g) => g.items.length > 0);

  const handleConfirm = () => {
    // Privacy lock: amounts hidden, so no reconcile is written.
    if (hidden) return;
    if (!isValidAmount) {
      setError("Enter a number.");
      return;
    }
    if (!hasGap) {
      // No-op: actual matches tracked. Close silently.
      onOpenChange(false);
      return;
    }
    if (!categoryId) {
      setError("Pick a category.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const snapshot = await reconcileAccountWithSnapshot(
          accountId,
          parsed,
          categoryId
        );
        // A null snapshot means the actual already matched the tracked balance
        // within a cent, so the server wrote nothing. That's a real no-op, not
        // a failure — closing quietly is the honest acknowledgement. Toasting
        // "reconciled" here would claim a transaction that doesn't exist, and
        // arming Undo would offer to reverse it.
        if (snapshot) {
          // redoReconciliation returns a new snapshot (fresh txn id) each time
          // the user redoes. Capture the latest in a ref so the next backward()
          // call deletes the right txn.
          const ref: { current: ReconcileSnapshot } = { current: snapshot };
          const entryId = pushUndoEntry({
            label: "Reconcile",
            forward: async () => {
              ref.current = await redoReconciliation(ref.current);
            },
            backward: async () => {
              await undoBalanceAdjustment(ref.current);
            },
          });
          // Reconciling writes a signed transaction against the category the
          // user picked, so money leaves that envelope on /budget while the
          // dialog just closes. Name neither the amount nor the category
          // balance — privacy mode.
          toast({
            message: `${accountName} reconciled`,
            action: { label: "Undo", onClick: () => undoEntry(entryId) },
          });
        }
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reconcile.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reconcile &ldquo;{accountName}&rdquo;</DialogTitle>
          <DialogDescription>
            Enter the actual amount you have on hand. Zero will record the
            difference as a transaction against the category you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <label
              htmlFor="reconcile-current-balance"
              className="text-xs text-muted-foreground"
            >
              Current balance
            </label>
            <div
              id="reconcile-current-balance"
              className={cn(
                "tabular-nums zero-amount text-lg font-medium",
                currentBalance >= 0 ? "text-foreground" : "text-negative"
              )}
            >
              {fmt(currentBalance)}
            </div>
          </div>

          <div className="grid gap-1.5">
            <label
              htmlFor="reconcile-actual-amount"
              className="text-xs text-muted-foreground"
            >
              Actual amount
            </label>
            <Input
              id="reconcile-actual-amount"
              ref={inputRef}
              type="number"
              inputMode="decimal"
              step="0.01"
              value={hidden ? "" : value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              disabled={hidden || pending}
              className="tabular-nums"
              placeholder={hidden ? "$••••••" : "0.00"}
            />
          </div>

          {hasGap ? (
            <div className="text-sm text-muted-foreground">
              Adjustment:{" "}
              <span
                className={cn(
                  "tabular-nums zero-amount font-medium",
                  diff >= 0 ? "text-positive" : "text-negative"
                )}
              >
                {diff >= 0 ? "+" : ""}
                {fmt(diff)}
              </span>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">Category</label>
            <CategoryCombobox
              value={categoryId}
              groupedCategories={groupedCategories}
              onChange={(id) => {
                setCategoryId(id);
                setError(null);
              }}
              placeholder="Choose a category"
            />
          </div>

          {error ? (
            <div className="text-sm text-negative" role="status">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={hidden || !canSubmit}>
            Reconcile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
