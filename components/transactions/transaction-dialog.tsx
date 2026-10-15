"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createTransaction,
  updateTransaction,
  deleteTransactionWithSnapshot,
  restoreTransactionSnapshots,
  ensureDefaultAccount,
} from "@/app/(app)/transactions/actions";
import { PayeeCombobox, type PayeeOption } from "@/components/shared/payee-combobox";
import { CategoryCombobox } from "@/components/shared/category-combobox";
import { AccountCombobox } from "@/components/shared/account-combobox";
import { DateInput } from "@/components/shared/date-input";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";
import type { TransactionWithDetails } from "@/lib/types";
import { fieldClass } from "@/lib/utils";
import { parseMoneyInput } from "@/lib/db-utils";
import { useAmountsHidden } from "@/components/shared/privacy-provider";

type TransactionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // includes tracking accounts (260517-vxf) — is_budget_account is not used
  // as a picker filter; the field stays on the row shape for downstream uses.
  accounts: { id: string; name: string; type: string; is_budget_account: boolean }[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  payees: PayeeOption[];
  defaultAccountId?: string;
  defaultCategoryId?: string;
  transaction?: TransactionWithDetails | null;
  onMutated?: () => void;
};

export function TransactionDialog({
  open,
  onOpenChange,
  accounts,
  categories,
  categoryGroups,
  payees,
  defaultAccountId,
  defaultCategoryId,
  onMutated,
  transaction,
}: TransactionDialogProps) {
  const isEdit = !!transaction;
  const txnAmount = transaction ? Number(transaction.amount) : 0;

  const [isPending, startTransition] = useTransition();
  const [isExpense, setIsExpense] = useState(true);
  const [createAnother, setCreateAnother] = useState(false);
  const { toast } = useToast();
  const undoRedo = useUndoRedo();
  const { hidden } = useAmountsHidden();

  const [amount, setAmount] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [payee, setPayee] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");

  const incomeGroupIds = new Set(categoryGroups.filter((g) => g.is_income).map((g) => g.id));
  const firstIncomeCategory = categories.find((c) => incomeGroupIds.has(c.category_group_id));

  // Pre-fill when editing or when dialog opens
  useEffect(() => {
    if (open && transaction) {
      setIsExpense(txnAmount < 0);
      setAmount(String(Math.abs(txnAmount)));
      setDate(transaction.date);
      setPayee(transaction.payee || "");
      setCategoryId(transaction.category_id || "");
      setAccountId(transaction.account_id);
      setMemo(transaction.memo || "");
      setError("");
    } else if (open && !transaction) {
      setIsExpense(true);
      resetForm(undefined, defaultCategoryId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id, defaultAccountId, defaultCategoryId]);

  const handleToggleIncome = () => {
    // Income mode allows any category (Ready to assign for inflows; expense
    // categories for refunds/returns). Preserve current selection; only fill
    // in Ready to assign when nothing is selected yet.
    if (!categoryId && firstIncomeCategory) {
      setCategoryId(firstIncomeCategory.id);
    }
    setIsExpense(false);
  };

  const handleToggleExpense = () => {
    // Expense mode rejects income-only categories (you can't expense to
    // Ready to assign). Expense categories carry over freely.
    const currentGroupId = categories.find((c) => c.id === categoryId)?.category_group_id ?? "";
    if (categoryId && incomeGroupIds.has(currentGroupId)) {
      setCategoryId("");
    }
    setIsExpense(true);
  };

  const resetForm = (
    seedAccountId: string = defaultAccountId ?? accounts[0]?.id ?? "",
    seedCategoryId: string = ""
  ) => {
    setAmount("");
    setDate(todayStr());
    setPayee("");
    // Pre-fill the category only when it resolves to a non-income (expense) category.
    // Income mode starts blank so handleToggleIncome can fill in the first income
    // category, matching today's behavior. Stale ids fall through to "".
    const seedCat = seedCategoryId
      ? categories.find((c) => c.id === seedCategoryId)
      : undefined;
    const isExpenseCategory =
      !!seedCat && !incomeGroupIds.has(seedCat.category_group_id);
    setCategoryId(isExpenseCategory ? seedCategoryId : "");
    setAccountId(seedAccountId);
    setMemo("");
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Privacy lock: amounts hidden, so the transaction isn't saved.
    if (hidden) return;
    const numAmount = parseMoneyInput(amount);
    if (!numAmount) {
      setError("Enter a valid amount.");
      return;
    }
    setError("");

    const signedAmount = isExpense ? -Math.abs(numAmount) : Math.abs(numAmount);

    startTransition(async () => {
      try {
        if (isEdit && transaction) {
          const updates: Record<string, unknown> = {};
          if (date !== transaction.date) updates.date = date;
          if (payee !== (transaction.payee || "")) updates.payee = payee;
          if ((categoryId || null) !== (transaction.category_id || null)) updates.category_id = categoryId || null;
          if (memo !== (transaction.memo || "")) updates.memo = memo || null;
          if (signedAmount !== txnAmount) updates.amount = signedAmount;
          if (accountId !== transaction.account_id) updates.account_id = accountId;

          if (Object.keys(updates).length > 0) {
            await updateTransaction(transaction.id, updates);
          }
          onOpenChange(false);
        } else {
          const resolvedAccountId = accountId || await ensureDefaultAccount();

          await createTransaction({
            date,
            payee,
            memo,
            amount: signedAmount,
            account_id: resolvedAccountId,
            category_id: categoryId || undefined,
          });

          if (createAnother) {
            const keepDate = date;
            resetForm();
            setDate(keepDate);
            if (!isExpense && firstIncomeCategory) {
              setCategoryId(firstIncomeCategory.id);
            }
          } else {
            resetForm();
            onOpenChange(false);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  };

  const handleDelete = () => {
    if (!transaction) return;
    // Run the delete + toast OUTSIDE startTransition. The previous wrapper
    // deferred the setToasts update through React's transition lane, and
    // because the dialog also closed in the same flush, the queued toast
    // never reached the ToastProvider's render (260518-fqy #2 v2). The
    // toast and dialog-close are user-visible feedback — they belong in a
    // synchronous, high-priority update, not a transition.
    const txnId = transaction.id;
    void (async () => {
      try {
        let snapshots = await deleteTransactionWithSnapshot(txnId);
        if (snapshots.length === 0) {
          onOpenChange(false);
          return;
        }
        // length === 2 ⇒ transfer pair cascaded; length === 1 ⇒ ordinary.
        const message =
          snapshots.length === 2 ? "Transfer deleted" : "Transaction deleted";
        // Push a real undo entry (mirrors deleteWithUndo in the table client).
        // Before, the toast's Undo called restoreTransactionSnapshots directly:
        // Cmd+Z did nothing and Redo never armed. Now the entry lives on the
        // stack, the toast targets it by id so it stays correct after a later
        // action, and undoEntry moves it to the redo side so Cmd+Shift+Z works.
        const entryId = undoRedo.push({
          label: snapshots.length === 2 ? "Delete transfer" : "Delete transaction",
          forward: async () => {
            // Redo: re-delete via the primary id; the cascade re-expands and
            // the fresh array replaces our handle for the next undo.
            const fresh = await deleteTransactionWithSnapshot(snapshots[0].id);
            if (fresh.length > 0) snapshots = fresh;
            onMutated?.();
          },
          backward: async () => {
            await restoreTransactionSnapshots(snapshots);
            onMutated?.();
          },
        });
        toast({
          message,
          action: { label: "Undo", onClick: () => undoRedo.undoEntry(entryId) },
        });
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete");
      }
    })();
  };

  const groupedCategories = categoryGroups
    .filter((g) => !g.is_income && !g.is_system)
    .map((group) => ({
      ...group,
      items: categories.filter((c) => c.category_group_id === group.id),
    }))
    .filter((g) => g.items.length > 0);

  const incomeCategories = categoryGroups
    .filter((g) => g.is_income)
    .flatMap((g) => categories.filter((c) => c.category_group_id === g.id));

  const title = isEdit
    ? "Edit transaction"
    : isExpense
      ? "Add expense"
      : "Add income";

  const submitLabel = isEdit
    ? "Save"
    : isExpense
      ? "Add expense"
      : "Add income";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {/* Expense/Income toggle */}
          <div className="relative flex p-1 rounded-xl border border-input dark:bg-input" role="group" aria-label="Transaction type">
            {/* Sliding indicator */}
            <div
              className={`absolute top-1 bottom-1 w-[calc(50%-0.25rem)] rounded-lg bg-primary/15 shadow-sm ring-1 ring-primary/25 transition-transform duration-200 ease-in-out ${
                isExpense ? "translate-x-0" : "translate-x-[100%]"
              }`}
            />
            <button
              type="button"
              onClick={handleToggleExpense}
              aria-pressed={isExpense}
              className={`relative z-10 flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors duration-200 ${
                isExpense ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              Expense
            </button>
            <button
              type="button"
              onClick={handleToggleIncome}
              aria-pressed={!isExpense}
              className={`relative z-10 flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors duration-200 ${
                !isExpense ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              Income
            </button>
          </div>

          {error && (
            <p role="alert" id="txn-error" className="text-sm text-negative">{error}</p>
          )}

          <div className="rounded-xl border border-input py-6">
            <label htmlFor="txn-amount" className="sr-only">Amount</label>
            <input
              id="txn-amount"
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
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onFocus={() => setAmountFocused(true)}
              onBlur={() => setAmountFocused(false)}
              required
              aria-required="true"
              aria-describedby={error ? "txn-error" : undefined}
              autoFocus
              disabled={hidden}
              className="w-full text-center text-4xl font-bold tracking-tight bg-transparent outline-none placeholder:text-muted-foreground/40"
            />
          </div>

          <div className="grid grid-cols-[140px_1fr] gap-3">
            <div>
              <label htmlFor="txn-date" className="sr-only">Date</label>
              <DateInput
                id="txn-date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                aria-required="true"
              />
            </div>
            <PayeeCombobox
              value={payee}
              payees={payees}
              placeholder={isExpense ? "Where did you spend this money?" : "Where did this money come from?"}
              onChange={(name, defaultCategoryId) => {
                setPayee(name);
                if (defaultCategoryId && !categoryId) {
                  setCategoryId(defaultCategoryId);
                }
              }}
            />
          </div>

          <AccountCombobox
            value={accountId}
            accounts={accounts}
            onChange={setAccountId}
            placeholder="Choose an account"
          />

          <CategoryCombobox
            value={categoryId}
            groupedCategories={groupedCategories}
            incomeCategories={!isExpense ? incomeCategories : []}
            onChange={setCategoryId}
          />

          <div>
            <label htmlFor="txn-memo" className="sr-only">Note</label>
            <input
              id="txn-memo"
              placeholder="Add a note (optional)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            {!isEdit ? (
              <label className="flex items-center gap-2.5 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={createAnother}
                  onChange={(e) => setCreateAnother(e.target.checked)}
                  className="rounded accent-primary"
                />
                Create another transaction
              </label>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={handleDelete}
                disabled={isPending}
                className="text-negative hover:text-negative hover:bg-negative/10"
              >
                Delete
              </Button>
            )}

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={hidden || isPending} aria-busy={isPending}>
                {isPending ? "Saving..." : submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
