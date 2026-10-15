"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ArrowLeftRight, Check, ChevronDown, ChevronLeft, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { splitLeadingEmoji } from "@/lib/emoji";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { useToast } from "@/components/ui/toast";
import {
  createQuickTransaction,
  createQuickSplitTransaction,
  createQuickTransfer,
} from "@/app/(app)/transactions/actions";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { AvailableBadge } from "@/components/budget/available-badge";
import {
  AMOUNT_OPERATOR_GLYPHS,
  parseSplitAmount,
  relativeTime,
} from "@/lib/quick-add-utils";
import { useAmountField } from "./use-amount-field";
import type { AmountOperator } from "@/lib/amount-expression";
import { Currency } from "@/components/shared/currency";
import { RecentEditSheet } from "./recent-edit-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import {
  TransferDeleteSheet,
  type TransferRowSummary,
} from "./transfer-delete-sheet";

// Touch keys for amount maths — a phone's number pad has no operators.
const OPERATOR_KEYS: { op: AmountOperator; label: string }[] = [
  { op: "+", label: "Add" },
  { op: "-", label: "Subtract" },
  { op: "*", label: "Multiply" },
  { op: "/", label: "Divide" },
];

// includes tracking accounts (260517-vxf) — is_budget_account remains on the
// row shape but is no longer used as a picker filter here.
type Account = { id: string; name: string; type: string; is_budget_account: boolean };
type Category = { id: string; name: string; category_group_id: string };
type CategoryGroup = { id: string; name: string; is_income: boolean; is_system?: boolean };

export type RecentQuickAdd = {
  transactionId: string;
  payee: string;
  // Optional free-form note attached to the transaction. Surfaced by the
  // Recent edit sheet so the user can edit it without round-tripping through
  // the desktop. null when no memo was recorded.
  memo: string | null;
  amount: number;
  // Signed value (negative=expense, positive=income). Lets the edit sheet
  // recover the original mode without a second round-trip.
  signedAmount: number;
  // [] = uncategorized, [id] = single category, [id, id, ...] = split.
  categoryIds: string[];
  // Real per-line magnitudes from `transaction_splits`, aligned index-for-index
  // with categoryIds; [] for non-splits. The edit sheet MUST seed from these —
  // it previously invented an even split and wrote it back on save, destroying
  // the user's actual allocation.
  splitAmounts: number[];
  accountId: string;
  // True when the underlying transaction is currently a split parent. Used
  // by the edit sheet to decide whether to call `removeSplits` on demote.
  isSplitParent: boolean;
  // Present only for transfer outflow rows; carries the destination account
  // id so Recent can render "<from> → <to>". Undefined for non-transfers.
  transferToAccountId?: string;
  createdAt: number;
};

type Props = {
  accounts: Account[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  topCategoryIds: string[];
  topIncomeCategoryIds: string[];
  recentQuickAdds: RecentQuickAdd[];
  payees: string[];
  // Current-month available per category id (budget-engine cumulative).
  // Income/system categories are absent — the picker shows no badge for them.
  availableByCategory: Record<string, number>;
};

type Mode = "expense" | "income" | "transfer";

// Optimistic-buffer entry for the Recent list. Lives in localStorage only
// while in-flight ("pending") or after an error ("failed"). Successful saves
// are dropped from this buffer — the server's `recentQuickAdds` prop surfaces
// them on the next render after `revalidatePath("/quick")`.
type RecentSubmission = {
  id: string;
  payee: string;
  amount: number;
  // [] = uncategorized, [id] = single category, [id, id, ...] = split.
  categoryIds: string[];
  accountId: string;
  time: number;
  status: "pending" | "failed";
};

const LS_LAST_ACCOUNT = "zero.quick.lastAccount";
const LS_RECENT = "zero.quick.recent";
const RECENT_LIMIT = 5;

export function QuickAddForm({
  accounts,
  categories,
  categoryGroups,
  topCategoryIds,
  topIncomeCategoryIds,
  recentQuickAdds,
  payees,
  availableByCategory,
}: Props) {
  const router = useRouter();
  // 260517-vxf: tracking-only accounts are valid quick-add targets — they
  // appear in the picker alongside budget accounts. The parent page already
  // filters archived rows.
  const accountList = accounts;

  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const topExpenseCategories = useMemo(
    () =>
      topCategoryIds
        .map((id) => categoryById.get(id))
        .filter((c): c is Category => c !== undefined),
    [topCategoryIds, categoryById]
  );

  const topIncomeCategories = useMemo(
    () =>
      topIncomeCategoryIds
        .map((id) => categoryById.get(id))
        .filter((c): c is Category => c !== undefined),
    [topIncomeCategoryIds, categoryById]
  );

  // Plain dollars plus arithmetic typed inside the field (`45 + 12.50`).
  // `amountCents` is always the evaluated total, so everything downstream
  // (validation, split distribution, submit) is unaware an expression was
  // involved.
  const amountField = useAmountField({ allowMaths: true });
  const amountInputRef = amountField.inputRef;
  const hasAmountMaths = amountField.hasMaths;
  const amountCents = amountField.cents;
  const amountDollars = amountCents / 100;
  const resetAmount = amountField.reset;
  const [payee, setPayee] = useState("");
  // Optional free-form note. Inline-always input below the payee row; reset
  // on submit and on every mode switch. Transfers write it to both legs.
  const [memo, setMemo] = useState("");
  const [accountId, setAccountId] = useState<string>(accountList[0]?.id ?? "");
  // Transfer destination — only used in mode === "transfer". Cleared on
  // every mode switch so the user always makes an explicit pick.
  const [toAccountId, setToAccountId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("expense");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(
    topCategoryIds[0] ? [topCategoryIds[0]] : []
  );
  const [splitMode, setSplitMode] = useState(false);
  // Per-category split amounts, keyed by category id, stored as raw input
  // strings so partial typing ("12.", "") survives. Empty / non-numeric is
  // treated as 0.00 by parseSplitAmount below.
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});
  const [categorySearch, setCategorySearch] = useState("");
  const [payeeSheetOpen, setPayeeSheetOpen] = useState(false);
  const [payeeSearch, setPayeeSearch] = useState("");

  const sheetPayees = useMemo(() => {
    const q = payeeSearch.trim().toLowerCase();
    if (!q) return payees;
    return payees.filter((name) => name.toLowerCase().includes(q));
  }, [payeeSearch, payees]);

  const trimmedSearch = payeeSearch.trim();
  const exactMatch =
    trimmedSearch.length > 0 &&
    payees.some((name) => name.toLowerCase() === trimmedSearch.toLowerCase());
  // Show an "Add" row only when the user typed something that isn't already
  // a payee — that's how new names get captured without leaving the sheet.
  const canCreateNewPayee = trimmedSearch.length > 0 && !exactMatch;

  const openPayeeSheet = () => {
    setPayeeSearch("");
    setPayeeSheetOpen(true);
  };

  const handlePayeeSelect = (name: string) => {
    setPayee(name);
    setPayeeSheetOpen(false);
  };

  const handlePayeeClear = () => {
    setPayee("");
    setPayeeSheetOpen(false);
  };
  // Optimistic buffer for in-flight / failed submits only. The visible Recent
  // list is computed by merging this with the server-sourced `recentQuickAdds`
  // prop in `displayedRecent` below.
  const [optimistic, setOptimistic] = useState<RecentSubmission[]>([]);
  const [pending, setPending] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  // Non-null while the edit sheet is open. Tapping a saved Recent row sets
  // this; the sheet's onClose clears it. Optimistic rows aren't editable
  // (they have no DB id yet).
  const [editingRow, setEditingRow] = useState<RecentQuickAdd | null>(null);
  // Non-null while the transfer-action sheet is open. Tapping a saved
  // transfer row in Recent sets this; the sheet's onClose clears it.
  // Editing transfers is OOS in v1; the sheet exposes delete only
  // (260518-fqy #10).
  const [editingTransfer, setEditingTransfer] = useState<TransferRowSummary | null>(null);
  const { toast } = useToast();
  const { hidden } = useAmountsHidden();
  const fmt = useMaskedCurrency();

  // Top tiles change with the mode so income tiles surface paycheck/etc.
  const visibleTopCategories = mode === "income" ? topIncomeCategories : topExpenseCategories;
  // Category groups shown inside the picker sheet.
  // - Expense mode: only non-income groups (you can't expense to Ready to
  //   assign / income-only groups).
  // - Income mode: every group, with income groups first then non-income —
  //   matches the desktop transaction dialog's CategoryCombobox so refunds
  //   and reimbursements can be posted back to any envelope.
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

  const handleModeChange = (newMode: Mode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setSplitMode(false);
    if (newMode === "transfer") {
      // Clear category/payee/memo/split context from the previous mode; force
      // the user to pick a "To" account explicitly each time.
      setSelectedCategoryIds([]);
      setSplitAmounts({});
      setPayee("");
      setMemo("");
      setToAccountId("");
    } else {
      const defaults = newMode === "income" ? topIncomeCategoryIds : topCategoryIds;
      setSelectedCategoryIds(defaults[0] ? [defaults[0]] : []);
      setToAccountId("");
    }
  };

  const handleTileClick = (id: string) => {
    // Tile tap always sets a single selection (and exits split-from-sheet).
    setSelectedCategoryIds([id]);
  };

  const handleSheetRowTap = (id: string) => {
    if (splitMode) {
      setSelectedCategoryIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    } else {
      setSelectedCategoryIds([id]);
      setCategorySheetOpen(false);
    }
  };

  const openCategorySheet = () => {
    setCategorySearch("");
    setSplitMode(selectedCategoryIds.length > 1);
    setCategorySheetOpen(true);
  };

  // Sync `splitAmounts` with `selectedCategoryIds`. Auto-distribute when first
  // entering split (no prior amounts), preserve existing entries on incremental
  // changes, and clear when dropping below 2. Intentionally NOT in deps for
  // `amount` — auto-distribute fires on selection change, not on each keystroke
  // of the parent amount input.
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
      if (wasEmpty) {
        if (amountCents > 0) {
          const totalCents = amountCents;
          const n = selectedCategoryIds.length;
          const base = Math.trunc(totalCents / n);
          const remainder = totalCents - base * n;
          const next: Record<string, string> = {};
          selectedCategoryIds.forEach((id, i) => {
            const cents = i === n - 1 ? base + remainder : base;
            next[id] = (cents / 100).toFixed(2);
          });
          return next;
        }
        const next: Record<string, string> = {};
        for (const id of selectedCategoryIds) next[id] = "";
        return next;
      }

      // Incremental: keep existing entries by id, default new ids to "".
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

  const parsedAmountCents = amountCents;

  const splitRemainingCents =
    selectedCategoryIds.length >= 2 ? parsedAmountCents - splitSumCents : 0;
  const isSplitBalanced =
    selectedCategoryIds.length < 2 || splitRemainingCents === 0;

  const handleSplitAmountChange = (id: string, raw: string) => {
    setSplitAmounts((prev) => ({ ...prev, [id]: raw }));
  };

  const balanceSplits = () => {
    if (selectedCategoryIds.length < 2 || parsedAmountCents === 0) return;
    const remainCents = parsedAmountCents - splitSumCents;
    if (remainCents === 0) return;

    const next = { ...splitAmounts };
    const emptyIds = selectedCategoryIds.filter(
      (id) => Math.round(parseSplitAmount(next[id] ?? "") * 100) === 0
    );
    if (emptyIds.length > 0) {
      const base = Math.trunc(remainCents / emptyIds.length);
      let distributed = 0;
      emptyIds.forEach((id, i) => {
        const cents = i === emptyIds.length - 1 ? remainCents - distributed : base;
        distributed += base;
        next[id] = (cents / 100).toFixed(2);
      });
    } else {
      // All rows filled — append remainder to the last selected category.
      const lastId = selectedCategoryIds[selectedCategoryIds.length - 1];
      const lastCents = Math.round(parseSplitAmount(next[lastId] ?? "") * 100);
      next[lastId] = ((lastCents + remainCents) / 100).toFixed(2);
    }
    setSplitAmounts(next);
  };
  // Initialize to 0 (deterministic) so SSR + client first render match.
  // The interval effect below sets the real timestamp on mount.
  const [nowTick, setNowTick] = useState<number>(0);


  // Hydrate localStorage state on mount (avoids SSR mismatch). We only keep
  // pending entries in LS — successful saves live on the server and surface
  // via the `recentQuickAdds` prop; failed saves are dropped (the error toast
  // is the only failure signal).
  useEffect(() => {
    try {
      const lastAccount = localStorage.getItem(LS_LAST_ACCOUNT);
      if (lastAccount && accountList.some((a) => a.id === lastAccount)) {
        setAccountId(lastAccount);
      }
      const rawRecent = localStorage.getItem(LS_RECENT);
      if (rawRecent) {
        const parsed = JSON.parse(rawRecent) as unknown;
        if (Array.isArray(parsed)) {
          // Defensive filter: drop anything that isn't a recognized in-flight
          // entry. This also retires legacy "saved" / "failed" rows from
          // earlier versions in one pass.
          const kept = parsed
            .filter(
              (r): r is RecentSubmission =>
                !!r &&
                typeof r === "object" &&
                typeof (r as RecentSubmission).id === "string" &&
                (r as RecentSubmission).status === "pending"
            )
            .slice(0, RECENT_LIMIT);
          setOptimistic(kept);
          if (kept.length !== parsed.length) persistOptimistic(kept);
        }
      }
    } catch {
      // ignore localStorage failures (private mode, etc.)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the tab regains focus, ask Next to re-fetch server data so foreign
  // deletes (desktop transactions page, another device) are reflected.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  // Refresh "Xs ago" labels. Sync immediately on mount so the initial
  // `nowTick: 0` (used to satisfy hydration) is replaced before paint.
  useEffect(() => {
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const showToast = useCallback(
    (message: string, variant: "success" | "error") => {
      toast({ message, variant, duration: 2500 });
    },
    [toast]
  );

  const persistOptimistic = useCallback((entries: RecentSubmission[]) => {
    try {
      if (entries.length === 0) {
        localStorage.removeItem(LS_RECENT);
      } else {
        localStorage.setItem(LS_RECENT, JSON.stringify(entries));
      }
    } catch {
      // ignore
    }
  }, []);

  const handleAccountSelect = (id: string) => {
    setAccountId(id);
    try {
      localStorage.setItem(LS_LAST_ACCOUNT, id);
    } catch {
      // ignore
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    // Privacy lock: amounts are hidden, so no save can happen.
    if (hidden) return;

    const parsed = amountDollars;
    if (parsed <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }

    // Transfer mode — separate flow: no category/payee, no optimistic
    // buffer entry (the buffer's RecentSubmission shape carries category
    // info that's meaningless for transfers; the server revalidate is
    // fast enough to surface the new transfer row on the next render).
    if (mode === "transfer") {
      if (!accountId) {
        showToast("Pick a from account", "error");
        return;
      }
      if (!toAccountId) {
        showToast("Pick a to account", "error");
        return;
      }
      if (accountId === toAccountId) {
        showToast("Pick a different to account", "error");
        return;
      }

      const transferMemo = memo.trim() || undefined;
      showToast("Saved", "success");
      resetAmount();
      setToAccountId("");
      setMemo("");
      amountInputRef.current?.blur();
      setPending(true);
      try {
        await createQuickTransfer({
          fromAccountId: accountId,
          toAccountId,
          amount: parsed,
          memo: transferMemo,
        });
      } catch {
        showToast("Could not save — try again", "error");
      } finally {
        setPending(false);
      }
      return;
    }

    if (!accountId || selectedCategoryIds.length === 0) {
      showToast("Pick an account and category", "error");
      return;
    }

    const isSplit = selectedCategoryIds.length > 1;
    if (isSplit && !isSplitBalanced) {
      const dir = splitRemainingCents > 0 ? "remaining" : "over by";
      const magnitude = Math.abs(splitRemainingCents / 100).toFixed(2);
      showToast(`Splits don't add up — $${magnitude} ${dir}`, "error");
      return;
    }

    // Sign convention: expense is stored as negative; income is positive.
    // createTransaction's existing semantics handle the balance direction.
    const signed = mode === "income" ? Math.abs(parsed) : -Math.abs(parsed);

    const submittedPayee = payee.trim();
    // Trim memo at submit time; empty → undefined so the server-side
    // wrapper passes undefined into createTransaction and the column stays
    // NULL.
    const submittedMemo = memo.trim() || undefined;
    const entry: RecentSubmission = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      payee: submittedPayee,
      amount: parsed,
      categoryIds: [...selectedCategoryIds],
      accountId,
      time: Date.now(),
      status: "pending",
    };

    // Optimistic UI: toast + prepend pending entry + reset amount/payee/memo
    // + persist
    showToast("Saved", "success");
    resetAmount();
    setPayee("");
    setMemo("");
    amountInputRef.current?.blur();
    setOptimistic((prev) => {
      const next = [entry, ...prev].slice(0, RECENT_LIMIT);
      persistOptimistic(next);
      return next;
    });
    try {
      localStorage.setItem(LS_LAST_ACCOUNT, accountId);
    } catch {
      // ignore
    }

    setPending(true);
    try {
      if (isSplit) {
        const signedSplits = selectedCategoryIds.map((id) => {
          const magnitude = parseSplitAmount(splitAmounts[id] ?? "");
          return {
            category_id: id,
            amount: mode === "income" ? magnitude : -magnitude,
          };
        });
        const result = await createQuickSplitTransaction({
          total_amount: signed,
          account_id: accountId,
          splits: signedSplits,
          payee: submittedPayee,
          memo: submittedMemo,
        });
        if (!result.ok) {
          // The form's submit-disable guards against sum_mismatch, but the
          // Result shape lets us surface the specific reason if a race or
          // future caller hits it (e.g. memo edits revisiting state).
          const message =
            result.error === "sum_mismatch"
              ? `Splits must total ${result.expected.toFixed(2)} — got ${result.got.toFixed(2)}`
              : "Need at least 2 categories to split";
          showToast(message, "error");
          setOptimistic((prev) => {
            const next = prev.filter((r) => r.id !== entry.id);
            persistOptimistic(next);
            return next;
          });
          return;
        }
      } else {
        await createQuickTransaction({
          amount: signed,
          account_id: accountId,
          category_id: selectedCategoryIds[0],
          payee: submittedPayee,
          memo: submittedMemo,
        });
      }
      // Success: drop the optimistic entry — the server-revalidated
      // recentQuickAdds prop will surface the saved row on next render.
      setOptimistic((prev) => {
        const next = prev.filter((r) => r.id !== entry.id);
        persistOptimistic(next);
        return next;
      });
      // After a successful split, collapse selection back to a single default
      // category so the user starts fresh for the next entry. (The sync effect
      // clears splitAmounts when selection drops below 2.)
      if (isSplit) {
        const defaults = mode === "income" ? topIncomeCategoryIds : topCategoryIds;
        setSelectedCategoryIds(defaults[0] ? [defaults[0]] : []);
        setSplitMode(false);
      }
    } catch {
      showToast("Could not save — try again", "error");
      setOptimistic((prev) => {
        const next = prev.filter((r) => r.id !== entry.id);
        persistOptimistic(next);
        return next;
      });
    } finally {
      setPending(false);
    }
  }

  const submitDisabled =
    hidden ||
    pending ||
    amountCents <= 0 ||
    !accountId ||
    (mode === "transfer"
      ? !toAccountId || accountId === toAccountId
      : selectedCategoryIds.length === 0 ||
        (selectedCategoryIds.length >= 2 && !isSplitBalanced));

  // Merge the optimistic buffer with the server-rendered list. Optimistic
  // entries always render first (they're newer than the latest server
  // snapshot until the next refresh resolves), then server entries follow in
  // the order the SQL query returned them (created_at DESC). We deliberately
  // do NOT re-sort by Date.parse(created_at): older rows seeded with SQLite's
  // datetime('now') default lack a "Z" and get interpreted as local time,
  // which can push them into the future and rank them above genuinely newer
  // ISO-UTC inserts.
  type DisplayEntry = {
    key: string;
    payee: string;
    amount: number;
    categoryIds: string[];
    accountId: string;
    time: number;
    status: "pending" | "saved" | "failed";
    // Original server record, present only for saved entries. The edit sheet
    // needs the signed amount + isSplitParent flag, which the optimistic
    // buffer doesn't carry (it doesn't have a DB id yet either).
    serverRow?: RecentQuickAdd;
  };
  const displayedRecent = useMemo<DisplayEntry[]>(() => {
    const opt: DisplayEntry[] = optimistic.map((r) => ({
      key: `opt:${r.id}`,
      payee: r.payee,
      amount: r.amount,
      categoryIds: r.categoryIds,
      accountId: r.accountId,
      time: r.time,
      status: r.status,
    }));
    const server: DisplayEntry[] = recentQuickAdds.map((r) => ({
      key: `srv:${r.transactionId}`,
      payee: r.payee,
      amount: r.amount,
      categoryIds: r.categoryIds,
      accountId: r.accountId,
      time: r.createdAt,
      status: "saved",
      serverRow: r,
    }));
    return [...opt, ...server].slice(0, RECENT_LIMIT);
  }, [optimistic, recentQuickAdds]);

  // Render-format the category names on a Recent entry:
  //   [] → "Uncategorized"
  //   ["A"] → "A"
  //   ["A", "B"] → "A + B"
  //   ["A", "B", "C", ...] → "A + B + N more"
  const formatCategoriesLabel = (categoryIds: string[]): string => {
    if (categoryIds.length === 0) return "Uncategorized";
    const names = categoryIds.map(
      (id) => categoryById.get(id)?.name ?? "Uncategorized"
    );
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} + ${names[1]}`;
    return `${names[0]} + ${names[1]} + ${names.length - 2} more`;
  };

  // Memo — inline always-visible single-line input. No bottom sheet
  // (free-form text, nothing to pick from); resets on submit and on every mode
  // switch. Sits under the payee normally, and under the "To" row for a
  // transfer, where it's written to both legs.
  const memoField = (
    <label className="flex flex-col gap-2">
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
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="text-2xl font-extrabold tracking-tight">Quick add</h1>

      {/* Expense / Income / Transfer segmented control */}
      <div
        role="tablist"
        aria-label="Transaction type"
        className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
      >
        {(["expense", "income", "transfer"] as const).map((m) => {
          const active = mode === m;
          const label =
            m === "expense"
              ? "− Expense"
              : m === "income"
                ? "+ Income"
                : "↔ Transfer";
          return (
            <button
              key={m}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => handleModeChange(m)}
              className={cn(
                "h-11 rounded-lg text-sm font-medium transition",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        {/* Amount input with dollar prefix. Maths is typed in the field itself
            (`45.00 + 12.50`); the running total sits beside the label. */}
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Amount
              </span>
              {!hidden && hasAmountMaths && (
                <span
                  data-testid="amount-total"
                  className="text-base font-semibold tabular-nums"
                >
                  = <Currency amount={amountDollars} colorize={false} smallCents={false} />
                </span>
              )}
            </span>
            <div className="relative">
              <span
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-2xl text-muted-foreground"
                aria-hidden="true"
              >
                $
              </span>
              <Input
                ref={amountInputRef}
                value={hidden ? "" : amountField.text}
                onChange={amountField.onChange}
                onSelect={amountField.onSelect}
                inputMode="decimal"
                placeholder={hidden ? "$••••••" : "0.00"}
                autoFocus
                autoComplete="off"
                enterKeyHint="done"
                disabled={hidden}
                className={cn(
                  "h-16 pl-9 tabular-nums",
                  // An expression needs the room; a plain amount keeps the big digits.
                  hasAmountMaths ? "text-2xl" : "text-4xl"
                )}
              />
            </div>
          </label>
          {/* A phone's number pad can't type operators, so touch screens get
              keys for them. With a keyboard it's typing only. */}
          {!hidden && (
            <div className="hidden grid-cols-4 gap-2 pointer-coarse:grid">
              {OPERATOR_KEYS.map(({ op, label }) => (
                <button
                  key={op}
                  type="button"
                  aria-label={label}
                  // Keep focus (and the phone keyboard) on the amount input.
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => amountField.press([op])}
                  className="h-10 rounded-lg border border-border bg-card text-xl text-muted-foreground transition hover:bg-accent/30 active:bg-accent"
                >
                  {AMOUNT_OPERATOR_GLYPHS[op]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Category, Split, and Payee blocks are hidden in transfer mode —
            transfers have no category or payee. */}
        {mode !== "transfer" && (
        <>
        {/* Category picker block — tiles + All-categories trigger
            are visually one unit (16px apart, matching tile-to-tile gap). */}
        <div className="flex flex-col gap-4">
          {visibleTopCategories.length > 0 && (
            <div>
              <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
                Category
              </div>
              <div className="grid grid-cols-3 gap-4">
                {visibleTopCategories.map((c) => {
                  const onlyThisSelected =
                    selectedCategoryIds.length === 1 && selectedCategoryIds[0] === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleTileClick(c.id)}
                      className={cn(
                        "flex h-20 flex-col items-center justify-center gap-1 rounded-xl border bg-card px-2 text-center text-sm font-medium transition active:bg-accent",
                        onlyThisSelected
                          ? "ring-2 ring-primary border-transparent"
                          : "border-border"
                      )}
                    >
                      {/* Emoji stacked above the name: inline it sat flush
                          against the text and two-line names wrapped under it. */}
                      {(() => {
                        const { emoji, label } = splitLeadingEmoji(c.name);
                        return (
                          <>
                            {emoji && (
                              <span aria-hidden="true" className="text-xl leading-none">
                                {emoji}
                              </span>
                            )}
                            <span className="line-clamp-2 leading-tight">{label}</span>
                          </>
                        );
                      })()}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* All categories — opens bottom sheet */}
          <button
            type="button"
            onClick={openCategorySheet}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-4 text-left transition active:bg-accent"
          >
            <span className="flex min-w-0 flex-col">
              {/* With tiles above, the section header already says
                  "Category" — this label names what the button opens. */}
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {selectedCategoryIds.length > 1
                  ? "Split across"
                  : visibleTopCategories.length > 0
                    ? "All categories"
                    : "Category"}
              </span>
              <span className="mt-1 truncate text-base font-medium">
                {selectedCategoryIds.length === 0
                  ? "Tap to choose"
                  : selectedCategoryIds.length === 1
                  ? categoryById.get(selectedCategoryIds[0])?.name ?? "Tap to choose"
                  : `${selectedCategoryIds.length} categories`}
              </span>
            </span>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>

        {/* Split amounts — one row per selected category when in split mode */}
        {selectedCategoryIds.length >= 2 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Split amounts
              </span>
              <button
                type="button"
                onClick={balanceSplits}
                disabled={hidden || parsedAmountCents === 0 || splitRemainingCents === 0}
                className={cn(
                  "min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition active:bg-accent",
                  parsedAmountCents === 0 || splitRemainingCents === 0
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
                        onChange={(e) => handleSplitAmountChange(id, e.target.value)}
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
                  {fmt(parsedAmountCents / 100)}
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

        {/* Payee — trigger button + bottom sheet (same pattern as Category).
            Tap to open a searchable list; sheet supports typing a brand-new
            payee that doesn't yet exist. Optional field — Save works with
            payee empty. */}
        <div>
          <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
            Payee
          </div>
          <button
            type="button"
            onClick={openPayeeSheet}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-4 text-left transition active:bg-accent"
          >
            {/* No inner "Payee" label — the section header above names it. */}
            <span className="flex min-w-0 flex-col">
              <span
                className={cn(
                  "truncate text-base",
                  payee ? "font-medium text-foreground" : "text-muted-foreground"
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

        {memoField}
        </>
        )}

        {/* Account chips — relabeled "From" in transfer mode, "Account"
            otherwise. Selected account uses the same brand treatment in
            both modes. */}
        <div>
          <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
            {mode === "transfer" ? "From" : "Account"}
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {accountList.map((a) => {
              const selected = a.id === accountId;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handleAccountSelect(a.id)}
                  className={cn(
                    "shrink-0 min-h-11 rounded-full border px-5 py-3 text-base font-medium transition",
                    selected
                      ? "bg-primary text-primary-foreground border-transparent"
                      : "border-border bg-card active:bg-accent"
                  )}
                >
                  {a.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* "To" chip row — only in transfer mode. Filters out the currently
            selected From account so same-account transfers can't be picked.
            Same chip styling as the From row above. */}
        {mode === "transfer" && (
          <div>
            <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
              To
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {accountList
                .filter((a) => a.id !== accountId)
                .map((a) => {
                  const selected = a.id === toAccountId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setToAccountId(a.id)}
                      className={cn(
                        "shrink-0 min-h-11 rounded-full border px-5 py-3 text-base font-medium transition",
                        selected
                          ? "bg-primary text-primary-foreground border-transparent"
                          : "border-border bg-card active:bg-accent"
                      )}
                    >
                      {a.name}
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {mode === "transfer" && memoField}

        <Button
          type="submit"
          size="lg"
          disabled={submitDisabled}
          className="h-14 w-full text-lg"
        >
          {mode === "transfer"
            ? pending
              ? "Transferring…"
              : "Transfer"
            : pending
              ? "Saving…"
              : "Save"}
        </Button>
      </form>

      {/* Recent list */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
          Recent
        </h2>
        {displayedRecent.length === 0 ? (
          <EmptyState
            variant="compact"
            message="Transactions you add here will show up in this list."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {displayedRecent.map((r) => {
              const acct = accountById.get(r.accountId);
              // Transfer rows are flagged via the server-side
              // `transferToAccountId` field. They render differently (icon
              // + "<from> → <to>" label, no category) and are NOT editable
              // — mirrors the splits-not-editable v1 pattern.
              const isTransfer = !!r.serverRow?.transferToAccountId;
              const body = isTransfer ? (
                <>
                  <div className="flex min-w-0 items-center gap-3">
                    <ArrowLeftRight
                      className="h-5 w-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-base font-medium">
                        {acct?.name ?? "Unknown account"}
                        {" → "}
                        {accountById.get(r.serverRow!.transferToAccountId!)?.name ??
                          "Unknown account"}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {relativeTime(r.time, nowTick)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-base tabular-nums">{fmt(r.amount)}</span>
                    <StatusBadge status={r.status} />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-base font-medium">
                      {formatCategoriesLabel(r.categoryIds)}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {r.payee ? `${r.payee} · ` : ""}
                      {acct?.name ?? "Unknown account"} · {relativeTime(r.time, nowTick)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-base tabular-nums">{fmt(r.amount)}</span>
                    <StatusBadge status={r.status} />
                  </div>
                </>
              );
              // Saved non-transfer rows are interactive: tapping opens the
              // full edit sheet pre-filled with the server record.
              // Saved transfer rows open a minimal delete-only sheet —
              // transfer editing is OOS in v1, but delete works (260518-fqy
              // #10). Optimistic (pending/failed) rows have no DB id and
              // stay non-interactive.
              if (r.status === "saved" && r.serverRow && !isTransfer) {
                const serverRow = r.serverRow;
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => setEditingRow(serverRow)}
                      className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left transition active:bg-accent"
                    >
                      {body}
                    </button>
                  </li>
                );
              }
              if (r.status === "saved" && r.serverRow && isTransfer) {
                const serverRow = r.serverRow;
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingTransfer({
                          transactionId: serverRow.transactionId,
                          fromAccountId: r.accountId,
                          toAccountId: serverRow.transferToAccountId!,
                          amount: Math.abs(r.amount),
                        })
                      }
                      className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left transition active:bg-accent"
                    >
                      {body}
                    </button>
                  </li>
                );
              }
              return (
                <li
                  key={r.key}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
                >
                  {body}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Bottom-sheet category picker */}
      <Sheet open={categorySheetOpen} onOpenChange={setCategorySheetOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="flex flex-col overflow-hidden rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)] data-[side=bottom]:h-[85dvh]"
        >
          {/* Drag handle */}
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted-foreground/30"
          />

          {/* Header: back · Category · Split/Done */}
          <div className="flex items-center justify-between px-4 pb-2 pt-2">
            <button
              type="button"
              onClick={() => setCategorySheetOpen(false)}
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
                  // Done: just close. Selection is already up to date.
                  setCategorySheetOpen(false);
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
                ? `Done${selectedCategoryIds.length > 0 ? ` (${selectedCategoryIds.length})` : ""}`
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
                              "flex w-full items-center gap-3 px-4 py-4 text-left text-base transition active:bg-accent",
                              idx !== 0 && "border-t border-border"
                            )}
                          >
                            {splitMode && (
                              <span
                                className={cn(
                                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                                  selected
                                    ? "bg-primary border-transparent text-primary-foreground"
                                    : "border-muted-foreground/40"
                                )}
                                aria-hidden="true"
                              >
                                {selected && <Check className="h-3.5 w-3.5" />}
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            {availableByCategory[c.id] !== undefined && (
                              <AvailableBadge available={availableByCategory[c.id]} />
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
        </SheetContent>
      </Sheet>

      {/* Bottom-sheet payee picker */}
      <Sheet open={payeeSheetOpen} onOpenChange={setPayeeSheetOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="flex flex-col overflow-hidden rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)] data-[side=bottom]:h-[85dvh]"
        >
          {/* Drag handle */}
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted-foreground/30"
          />

          {/* Header: back · Payee · Clear */}
          <div className="flex items-center justify-between px-4 pb-2 pt-2">
            <button
              type="button"
              onClick={() => setPayeeSheetOpen(false)}
              className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition active:bg-accent"
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <SheetHeader className="flex-1 items-center p-0">
              <SheetTitle className="text-base font-semibold">Payee</SheetTitle>
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
                aria-label="Search payees"
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
                        onClick={() => handlePayeeSelect(trimmedSearch)}
                        className="flex w-full items-center gap-3 px-4 py-4 text-left text-base transition active:bg-accent"
                      >
                        <Plus className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">
                          Add &ldquo;{trimmedSearch}&rdquo;
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
                              "flex w-full items-center gap-3 px-4 py-4 text-left text-base transition active:bg-accent",
                              idx !== 0 && "border-t border-border"
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{name}</span>
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
        </SheetContent>
      </Sheet>

      {/* Bottom-sheet edit-recent. Mounted once; opens when `editingRow` is
          non-null. Saved/deleted updates are propagated via revalidatePath
          on the server actions — the Recent list re-renders from fresh
          props after the round-trip. */}
      <RecentEditSheet
        row={editingRow}
        onClose={() => setEditingRow(null)}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        payees={payees}
        availableByCategory={availableByCategory}
      />

      <TransferDeleteSheet
        open={editingTransfer !== null}
        row={editingTransfer}
        accountById={accountById}
        onClose={() => setEditingTransfer(null)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: "pending" | "saved" | "failed" }) {
  if (status === "pending") {
    return (
      <span
        aria-label="Pending"
        className="inline-block h-2 w-2 rounded-full bg-muted-foreground"
      />
    );
  }
  if (status === "saved") {
    return (
      <span
        aria-label="Saved"
        className="text-[var(--color-positive)]"
        title="Saved"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      aria-label="Failed"
      className="text-[var(--color-negative)]"
      title="Failed"
    >
      ✗
    </span>
  );
}
