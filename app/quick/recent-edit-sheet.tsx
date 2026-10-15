"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Check, ChevronDown, ChevronLeft, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { AvailableBadge } from "@/components/budget/available-badge";
import { useToast } from "@/components/ui/toast";
import {
  updateQuickTransaction,
  deleteQuickTransaction,
} from "@/app/(app)/transactions/actions";
import { parseSplitAmount } from "@/lib/quick-add-utils";
import { useAmountField } from "./use-amount-field";
import type { RecentQuickAdd } from "./quick-add-form";

// Duplicated locally rather than refactored out of `quick-add-form.tsx` so
// this file stays self-contained. The parent form passes these props in.
// includes tracking accounts (260517-vxf) — is_budget_account is not used as
// a picker filter here.
type Account = {
  id: string;
  name: string;
  type: string;
  is_budget_account: boolean;
};
type Category = { id: string; name: string; category_group_id: string };
type CategoryGroup = { id: string; name: string; is_income: boolean; is_system?: boolean };

type Props = {
  row: RecentQuickAdd | null; // null = closed
  onClose: () => void;
  accounts: Account[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  payees: string[];
  // Current-month available per category id; income/system categories absent.
  availableByCategory: Record<string, number>;
};

type Mode = "expense" | "income";
type View = "main" | "category" | "payee";

export function RecentEditSheet({
  row,
  onClose,
  accounts,
  categories,
  categoryGroups,
  payees,
  availableByCategory,
}: Props) {
  const open = row !== null;

  // 260517-vxf: tracking-only accounts are selectable in the edit sheet too.
  const accountList = accounts;

  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  // Local form state — initialized from `row` whenever the sheet opens or the
  // target row changes. The component holds nothing while closed.
  const [mode, setMode] = useState<Mode>("expense");
  // Plain dollars, no arithmetic — this sheet corrects a saved amount.
  const amountField = useAmountField({ allowMaths: false });
  const { setAmount } = amountField;
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState(false);
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});
  const [payee, setPayee] = useState("");
  // Inline always-visible memo input. Initializes from row.memo when a row
  // opens; passes memo.trim() || null into updateQuickTransaction so an
  // emptied memo clears the column server-side.
  const [memo, setMemo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [view, setView] = useState<View>("main");
  const [categorySearch, setCategorySearch] = useState("");
  const [payeeSearch, setPayeeSearch] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, setPending] = useState(false);

  const { toast } = useToast();
  const { hidden } = useAmountsHidden();
  const fmt = useMaskedCurrency();

  // Initialize state when a new row opens. The dependency on `row` resets
  // every field whenever the user taps a different Recent entry.
  useEffect(() => {
    if (!row) return;
    const initMode: Mode = row.signedAmount < 0 ? "expense" : "income";
    setMode(initMode);
    const absCents = Math.round(Math.abs(row.signedAmount) * 100);
    setAmount(row.signedAmount);
    setSelectedCategoryIds([...row.categoryIds]);
    setSplitMode(row.categoryIds.length > 1);
    // Seed from the stored per-line amounts. Never synthesize a distribution
    // here: handleSave writes whatever is in this state back over
    // transaction_splits, so a fabricated split silently replaces the real
    // one the moment the user edits an unrelated field like the payee.
    if (row.categoryIds.length >= 2 && absCents > 0) {
      const next: Record<string, string> = {};
      row.categoryIds.forEach((id, i) => {
        const stored = row.splitAmounts[i];
        next[id] = stored === undefined ? "" : stored.toFixed(2);
      });
      setSplitAmounts(next);
    } else {
      setSplitAmounts({});
    }
    setPayee(row.payee ?? "");
    setMemo(row.memo ?? "");
    setAccountId(row.accountId);
    setView("main");
    setCategorySearch("");
    setPayeeSearch("");
    setConfirmingDelete(false);
  }, [row, setAmount]);

  const amountCents = amountField.cents;
  const amountDollars = amountCents / 100;

  // Category-picker view: only render groups that contain at least one
  // matching entry. Income mode surfaces income groups first.
  const sheetGroups = useMemo(() => {
    const groups =
      mode === "income"
        ? [
            ...categoryGroups.filter((g) => g.is_income),
            ...categoryGroups.filter((g) => !g.is_income && !g.is_system),
          ]
        : categoryGroups.filter((g) => !g.is_income && !g.is_system);
    const q = categorySearch.trim().toLowerCase();
    return groups
      .map((group) => ({
        group,
        items: categories
          .filter((c) => c.category_group_id === group.id)
          .filter((c) => (q ? c.name.toLowerCase().includes(q) : true)),
      }))
      .filter((g) => g.items.length > 0);
  }, [categories, categoryGroups, mode, categorySearch]);

  const sheetPayees = useMemo(() => {
    const q = payeeSearch.trim().toLowerCase();
    if (!q) return payees;
    return payees.filter((name) => name.toLowerCase().includes(q));
  }, [payeeSearch, payees]);

  const trimmedPayeeSearch = payeeSearch.trim();
  const exactPayeeMatch =
    trimmedPayeeSearch.length > 0 &&
    payees.some(
      (name) => name.toLowerCase() === trimmedPayeeSearch.toLowerCase()
    );
  const canCreateNewPayee =
    trimmedPayeeSearch.length > 0 && !exactPayeeMatch;

  const handlePayeeSelect = (name: string) => {
    setPayee(name);
    setView("main");
  };

  const handlePayeeClear = () => {
    setPayee("");
    setView("main");
  };

  // Sync `splitAmounts` keys to `selectedCategoryIds`. Auto-distribute when
  // first entering split, otherwise preserve existing entries by id.
  useEffect(() => {
    setSplitAmounts((prev) => {
      const prevKeys = Object.keys(prev);
      const idSet = new Set(selectedCategoryIds);
      const sameKeySet =
        prevKeys.length === idSet.size && prevKeys.every((k) => idSet.has(k));
      if (sameKeySet) return prev;

      if (selectedCategoryIds.length < 2) {
        return prevKeys.length > 0 ? {} : prev;
      }

      const wasEmpty = prevKeys.length < 2;
      if (wasEmpty && amountCents > 0) {
        const n = selectedCategoryIds.length;
        const base = Math.trunc(amountCents / n);
        const remainder = amountCents - base * n;
        const next: Record<string, string> = {};
        selectedCategoryIds.forEach((id, i) => {
          const cents = i === n - 1 ? base + remainder : base;
          next[id] = (cents / 100).toFixed(2);
        });
        return next;
      }

      const next: Record<string, string> = {};
      for (const id of selectedCategoryIds) {
        next[id] = prev[id] ?? "";
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategoryIds]);

  const splitSumCents = useMemo(() => {
    if (selectedCategoryIds.length < 2) return 0;
    return selectedCategoryIds.reduce(
      (acc, id) =>
        acc + Math.round(parseSplitAmount(splitAmounts[id] ?? "") * 100),
      0
    );
  }, [selectedCategoryIds, splitAmounts]);

  const splitRemainingCents =
    selectedCategoryIds.length >= 2 ? amountCents - splitSumCents : 0;
  const isSplitBalanced =
    selectedCategoryIds.length < 2 || splitRemainingCents === 0;

  const handleSplitAmountChange = (id: string, raw: string) => {
    setSplitAmounts((prev) => ({ ...prev, [id]: raw }));
  };

  const balanceSplits = () => {
    if (selectedCategoryIds.length < 2 || amountCents === 0) return;
    const remainCents = amountCents - splitSumCents;
    if (remainCents === 0) return;

    const next = { ...splitAmounts };
    const emptyIds = selectedCategoryIds.filter(
      (id) => Math.round(parseSplitAmount(next[id] ?? "") * 100) === 0
    );
    if (emptyIds.length > 0) {
      const base = Math.trunc(remainCents / emptyIds.length);
      let distributed = 0;
      emptyIds.forEach((id, i) => {
        const cents =
          i === emptyIds.length - 1 ? remainCents - distributed : base;
        distributed += base;
        next[id] = (cents / 100).toFixed(2);
      });
    } else {
      const lastId = selectedCategoryIds[selectedCategoryIds.length - 1];
      const lastCents = Math.round(parseSplitAmount(next[lastId] ?? "") * 100);
      next[lastId] = ((lastCents + remainCents) / 100).toFixed(2);
    }
    setSplitAmounts(next);
  };

  const handleSheetRowTap = (id: string) => {
    if (splitMode) {
      setSelectedCategoryIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    } else {
      setSelectedCategoryIds([id]);
      setView("main");
    }
  };

  const showToast = (message: string, variant: "success" | "error") => {
    toast({ message, variant, duration: 2500 });
  };

  const canSave =
    !hidden &&
    !pending &&
    amountCents > 0 &&
    !!accountId &&
    selectedCategoryIds.length > 0 &&
    (selectedCategoryIds.length < 2 || isSplitBalanced);

  async function handleSave() {
    // Privacy lock: amounts hidden, changes are not saved.
    if (hidden) return;
    if (!row || !canSave) return;
    setPending(true);
    try {
      const signed = mode === "income" ? amountDollars : -amountDollars;
      const isSplit = selectedCategoryIds.length >= 2;
      const splits = isSplit
        ? selectedCategoryIds.map((id) => {
            const magnitude = parseSplitAmount(splitAmounts[id] ?? "");
            return {
              category_id: id,
              amount: mode === "income" ? magnitude : -magnitude,
            };
          })
        : undefined;
      const result = await updateQuickTransaction({
        id: row.transactionId,
        amount: signed,
        account_id: accountId,
        category_id: isSplit ? null : selectedCategoryIds[0],
        splits,
        payee: payee.trim(),
        // Empty string → null clears the memo; non-empty → set.
        memo: memo.trim() || null,
        wasSplitParent: row.isSplitParent,
      });
      if (!result.ok) {
        showToast(
          `Splits must total ${result.expected.toFixed(2)} — got ${result.got.toFixed(2)}`,
          "error"
        );
        return;
      }
      showToast("Saved", "success");
      onClose();
    } catch {
      showToast("Could not save — try again", "error");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!row) return;
    setPending(true);
    try {
      await deleteQuickTransaction(row.transactionId);
      showToast("Deleted", "success");
      onClose();
    } catch {
      showToast("Could not delete — try again", "error");
      setConfirmingDelete(false);
    } finally {
      setPending(false);
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="flex flex-col overflow-hidden rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)] data-[side=bottom]:h-[85dvh]"
      >
        {/* Drag handle */}
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted-foreground/30" />

        {view === "main" ? (
          <>
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
                <SheetTitle className="text-base font-semibold">
                  Edit transaction
                </SheetTitle>
              </SheetHeader>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className={cn(
                  "min-h-11 rounded-full border px-4 py-2 text-base font-medium transition",
                  canSave
                    ? "border-transparent bg-primary text-primary-foreground active:opacity-80"
                    : "border-border text-muted-foreground/40"
                )}
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-6">
              {/* Mode (expense/income) */}
              <div
                role="tablist"
                aria-label="Transaction type"
                className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
              >
                {(["expense", "income"] as const).map((m) => {
                  const active = mode === m;
                  return (
                    <button
                      key={m}
                      role="tab"
                      aria-selected={active}
                      type="button"
                      onClick={() => setMode(m)}
                      className={cn(
                        "h-11 rounded-lg text-sm font-medium transition",
                        active
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground"
                      )}
                    >
                      {m === "expense" ? "− Expense" : "+ Income"}
                    </button>
                  );
                })}
              </div>

              {/* Amount */}
              <label className="mt-6 flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Amount
                </span>
                <div className="relative">
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-2xl text-muted-foreground"
                    aria-hidden="true"
                  >
                    $
                  </span>
                  <Input
                    ref={amountField.inputRef}
                    value={hidden ? "" : amountField.text}
                    onChange={amountField.onChange}
                    onSelect={amountField.onSelect}
                    inputMode="decimal"
                    placeholder={hidden ? "$••••••" : "0.00"}
                    autoComplete="off"
                    enterKeyHint="done"
                    disabled={hidden}
                    className="h-16 pl-9 text-4xl tabular-nums"
                  />
                </div>
              </label>

              {/* Category trigger */}
              <button
                type="button"
                onClick={() => {
                  setCategorySearch("");
                  setSplitMode(selectedCategoryIds.length > 1);
                  setView("category");
                }}
                className="mt-6 flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-4 text-left transition active:bg-accent"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {selectedCategoryIds.length > 1 ? "Split across" : "Category"}
                  </span>
                  <span className="mt-1 truncate text-base font-medium">
                    {selectedCategoryIds.length === 0
                      ? "Tap to choose"
                      : selectedCategoryIds.length === 1
                      ? categoryById.get(selectedCategoryIds[0])?.name ??
                        "Tap to choose"
                      : `${selectedCategoryIds.length} categories`}
                  </span>
                </span>
                <ChevronDown
                  className="h-5 w-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>

              {/* Split amounts */}
              {selectedCategoryIds.length >= 2 && (
                <div className="mt-6 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      Split amounts
                    </span>
                    <button
                      type="button"
                      onClick={balanceSplits}
                      disabled={hidden || amountCents === 0 || splitRemainingCents === 0}
                      className={cn(
                        "min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition active:bg-accent",
                        amountCents === 0 || splitRemainingCents === 0
                          ? "border-border text-muted-foreground/40"
                          : "border-border text-foreground"
                      )}
                    >
                      Balance
                    </button>
                  </div>
                  <ul className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
                    {selectedCategoryIds.map((id, idx) => {
                      const cat = categoryById.get(id);
                      return (
                        <li
                          key={id}
                          className={cn(
                            "flex items-center gap-3 px-4 py-3",
                            idx !== 0 && "border-t border-border"
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-base font-medium">
                            {cat?.name ?? "Uncategorized"}
                          </span>
                          <div className="relative w-32">
                            <span
                              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                              aria-hidden="true"
                            >
                              $
                            </span>
                            <Input
                              value={hidden ? "" : splitAmounts[id] ?? ""}
                              onChange={(e) =>
                                handleSplitAmountChange(id, e.target.value)
                              }
                              inputMode="decimal"
                              pattern="[0-9.]*"
                              placeholder={hidden ? "$••••••" : "0.00"}
                              autoComplete="off"
                              disabled={hidden}
                              aria-label={`Amount for ${cat?.name ?? "category"}`}
                              className="h-11 pl-7 text-right text-base tabular-nums"
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Allocated{" "}
                      <span className="tabular-nums text-foreground">
                        {fmt(splitSumCents / 100)}
                      </span>{" "}
                      of{" "}
                      <span className="tabular-nums text-foreground">
                        {fmt(amountCents / 100)}
                      </span>
                    </span>
                    {isSplitBalanced ? (
                      <span className="font-medium text-[var(--color-positive)]">
                        Balanced
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          splitRemainingCents > 0
                            ? "text-[var(--color-info)]"
                            : "text-[var(--color-negative)]"
                        )}
                      >
                        {splitRemainingCents > 0 ? "Remaining " : "Over by "}
                        {fmt(Math.abs(splitRemainingCents) / 100)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Payee — same trigger + bottom-sheet picker as the main
                  /quick form, with view-swap (not a nested Sheet) to keep
                  the outer sheet shell mounted. */}
              <div className="mt-6">
                <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
                  Payee
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPayeeSearch("");
                    setView("payee");
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-4 text-left transition active:bg-accent"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      Payee
                    </span>
                    <span
                      className={cn(
                        "mt-1 truncate text-base",
                        payee
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {payee || "Tap to add (optional)"}
                    </span>
                  </span>
                  <ChevronDown
                    className="h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </div>

              {/* Memo — inline always-visible single-line input. Initialized
                  from row.memo on open; emptied memo clears the column. */}
              <label className="mt-6 flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Memo
                </span>
                <Input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  inputMode="text"
                  placeholder="Memo (optional)"
                  autoComplete="off"
                  enterKeyHint="done"
                  className="h-12 text-base"
                />
              </label>

              {/* Account chips */}
              <div className="mt-6">
                <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
                  Account
                </div>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                  {accountList.map((a) => {
                    const selected = a.id === accountId;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setAccountId(a.id)}
                        className={cn(
                          "min-h-11 shrink-0 rounded-full border px-5 py-3 text-base font-medium transition",
                          selected
                            ? "border-transparent bg-primary text-primary-foreground"
                            : "border-border bg-card active:bg-accent"
                        )}
                      >
                        {a.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Delete row — inline confirmation rather than window.confirm
                  so the sheet stays in control of the interaction. */}
              <div className="mt-8 border-t border-border pt-6">
                {confirmingDelete ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-foreground">
                      Delete this transaction?
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        disabled={pending}
                        className="min-h-11 flex-1 rounded-full border border-border px-4 py-2 text-base font-medium transition active:bg-accent"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={pending}
                        className="min-h-11 flex-1 rounded-full border border-transparent bg-[var(--color-negative)] px-4 py-2 text-base font-medium text-white transition active:opacity-90 disabled:opacity-60"
                      >
                        {pending ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={pending}
                    className="min-h-11 w-full rounded-full border border-[var(--color-negative)] px-4 py-2 text-base font-medium text-[var(--color-negative)] transition active:bg-accent"
                  >
                    Delete transaction
                  </button>
                )}
              </div>
            </div>
          </>
        ) : view === "category" ? (
          // Category picker view — inline (not a nested Sheet) so the bottom
          // sheet shell stays mounted and just swaps content. Mirrors the
          // create form's category sheet behavior.
          <>
            <div className="flex items-center justify-between px-4 pb-2 pt-2">
              <button
                type="button"
                onClick={() => setView("main")}
                className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition active:bg-accent"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <SheetHeader className="flex-1 items-center p-0">
                <SheetTitle className="text-base font-semibold">
                  {splitMode ? "Split across" : "Category"}
                </SheetTitle>
              </SheetHeader>
              <button
                type="button"
                onClick={() => {
                  if (splitMode) {
                    setView("main");
                  } else {
                    setSplitMode(true);
                  }
                }}
                className={cn(
                  "rounded-full border px-4 py-2 text-base font-medium transition active:bg-accent",
                  splitMode
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border text-foreground"
                )}
              >
                {splitMode
                  ? `Done${
                      selectedCategoryIds.length > 0
                        ? ` (${selectedCategoryIds.length})`
                        : ""
                    }`
                  : "Split"}
              </button>
            </div>

            {/* Search */}
            <div className="px-4 pb-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="Search categories"
                  autoComplete="off"
                  enterKeyHint="search"
                  className="h-11 rounded-full pl-10"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-8">
              {sheetGroups.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No matching categories.
                </p>
              ) : (
                sheetGroups.map(({ group, items }) => (
                  <section key={group.id} className="mb-4">
                    <h3 className="px-1 py-2 text-sm font-extrabold text-foreground">
                      {group.name}
                    </h3>
                    <ul className="overflow-hidden rounded-xl border border-border bg-card">
                      {items.map((c, idx) => {
                        const selected = selectedCategoryIds.includes(c.id);
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => handleSheetRowTap(c.id)}
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-3.5 text-left text-base transition active:bg-accent",
                                idx !== 0 && "border-t border-border"
                              )}
                            >
                              {splitMode && (
                                <span
                                  className={cn(
                                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                                    selected
                                      ? "border-transparent bg-primary text-primary-foreground"
                                      : "border-muted-foreground/40"
                                  )}
                                  aria-hidden="true"
                                >
                                  {selected && <Check className="h-3.5 w-3.5" />}
                                </span>
                              )}
                              <span className="min-w-0 flex-1 truncate">
                                {c.name}
                              </span>
                              {availableByCategory[c.id] !== undefined && (
                                <AvailableBadge
                                  available={availableByCategory[c.id]}
                                />
                              )}
                              {!splitMode && selected && (
                                <Check
                                  className="h-5 w-5 shrink-0 text-primary"
                                  aria-label="Selected"
                                />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}
            </div>
          </>
        ) : (
          // Payee picker view — same shell as the category view; mirrors the
          // create form's payee sheet (search + "Add <name>" row for new
          // payees that don't yet exist).
          <>
            <div className="flex items-center justify-between px-4 pb-2 pt-2">
              <button
                type="button"
                onClick={() => setView("main")}
                className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition active:bg-accent"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <SheetHeader className="flex-1 items-center p-0">
                <SheetTitle className="text-base font-semibold">
                  Payee
                </SheetTitle>
              </SheetHeader>
              {payee ? (
                <button
                  type="button"
                  onClick={handlePayeeClear}
                  className="rounded-full border border-border px-4 py-2 text-base font-medium text-foreground transition active:bg-accent"
                >
                  Clear
                </button>
              ) : (
                <div className="w-10" aria-hidden="true" />
              )}
            </div>

            {/* Search */}
            <div className="px-4 pb-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={payeeSearch}
                  onChange={(e) => setPayeeSearch(e.target.value)}
                  placeholder="Search or add a payee"
                  autoComplete="off"
                  enterKeyHint="search"
                  className="h-11 rounded-full pl-10"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-8">
              {sheetPayees.length === 0 && !canCreateNewPayee ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No payees yet. Type a name above to add one.
                </p>
              ) : (
                <>
                  {canCreateNewPayee && (
                    <ul className="mb-4 overflow-hidden rounded-xl border border-border bg-card">
                      <li>
                        <button
                          type="button"
                          onClick={() => handlePayeeSelect(trimmedPayeeSearch)}
                          className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-base transition active:bg-accent"
                        >
                          <Plus
                            className="h-5 w-5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            Add &ldquo;{trimmedPayeeSearch}&rdquo;
                          </span>
                        </button>
                      </li>
                    </ul>
                  )}
                  {sheetPayees.length > 0 && (
                    <ul className="overflow-hidden rounded-xl border border-border bg-card">
                      {sheetPayees.map((name, idx) => {
                        const selected = payee === name;
                        return (
                          <li key={name}>
                            <button
                              type="button"
                              onClick={() => handlePayeeSelect(name)}
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-3.5 text-left text-base transition active:bg-accent",
                                idx !== 0 && "border-t border-border"
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {name}
                              </span>
                              {selected && (
                                <Check
                                  className="h-5 w-5 shrink-0 text-primary"
                                  aria-label="Selected"
                                />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
