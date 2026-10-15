"use client";

import { useState, useCallback, useEffect, useRef, useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import type { RowSelectionState } from "@tanstack/react-table";
import { TransactionToolbar } from "./transaction-toolbar";
import { ToolbarIconButton } from "@/components/shared/toolbar-icon-button";
import { TransactionTable, type TransactionDraft } from "./transaction-table";
import { SelectionToolbar, type SelectionAction } from "./selection-toolbar";
import { TransferDialog, type TransferEditTarget } from "./transfer-dialog";
import { useUndoRedo } from "@/lib/use-undo-redo";
import { useToast } from "@/components/ui/toast";
import {
  updateTransaction,
  bulkUpdateTransactions,
  bulkDeleteTransactionsWithSnapshot,
  restoreTransactionSnapshots,
  deleteTransactionWithSnapshot,
  duplicateTransactions,
  getSplitsForTransaction,
  saveSplitsWithSnapshot,
  removeSplitsWithSnapshot,
  restoreSplitSnapshot,
  bulkMoveTransactionsToAccountWithSnapshot,
  restoreAccountMoveSnapshot,
  bulkRenamePayeeWithSnapshot,
  restorePayeeSnapshots,
  postPendingTransactionsWithSnapshot,
  unpostPendingTransactions,
  type SplitInput,
  type TransactionSnapshot,
  type AccountMoveSnapshot,
  type PayeeSnapshotRow,
  type PendingPostSnapshotRow,
} from "@/app/(app)/transactions/actions";
import type { TransactionWithDetails } from "@/lib/types";
import type { PayeeOption } from "@/components/shared/payee-combobox";
import { FEATURES } from "@/lib/features";
import { clientId } from "@/lib/client-id";
import { ScheduleDialog } from "@/components/schedules/schedule-dialog";
import { QuickAdd } from "@/components/transactions/quick-add";
import { CsvActions } from "@/components/transactions/csv-actions";

type TransactionsClientProps = {
  transactions: TransactionWithDetails[];
  // includes tracking accounts (260517-vxf) — is_budget_account is not used
  // as a picker filter; the field stays on the row shape for downstream uses.
  accounts: { id: string; name: string; type: string; is_budget_account: boolean }[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  payees: PayeeOption[];
  /**
   * When set, the transactions list is scoped to a single account (e.g. the
   * `/accounts/[id]` page). The account filter dropdown is hidden — switching
   * accounts there is a no-op since the page is already locked to one account.
   */
  lockedAccountId?: string;
  /**
   * When set, the transaction dialog pre-selects this account for new transactions.
   * Defaults to `lockedAccountId` so the `/accounts/[id]` page seeds the picker
   * with the page's account without any extra prop on that callsite. The user
   * can still change the picker — this is "default, not lock".
   */
  defaultAccountId?: string;
  /**
   * When true, render the 88px page header (Transactions title + Manage payees,
   * CSV import, Transfer, Quick add) inside this client. The /transactions page
   * passes this so all client-side interactivity (including the Transfer dialog
   * and its undo wiring) lives in one tree co-located with the undo stack.
   *
   * The /accounts/[id] page has its own header and leaves this off.
   */
  renderHeader?: boolean;
  earliestTransactionYear: number;
  /**
   * True when at least one transaction in scope falls outside the current
   * date filter. Drives the "Some transactions are hidden by filters" footer
   * hint — we never show the hint just because a filter is set; the filter
   * has to actually be hiding something.
   */
  hiddenCount: number;
  /**
   * The route's default filter range. /accounts/[id] passes the current month
   * so a bare URL there means "this month"; /transactions omits this so a bare
   * URL means "all dates". Used to keep the URL clean when the user is on the
   * default and to route "View all" through ?range=all when the route's
   * default is something other than "all dates".
   */
  defaultRange?: { start: string | null; end: string | null };
};

export type SplitDraftItem = {
  tempId: string;
  category_id: string;
  amount: number;
};

export type SplitDraftState = {
  items: SplitDraftItem[];
  parentAmount: number;
};

export function TransactionsClient({
  transactions,
  accounts,
  categories,
  categoryGroups,
  payees,
  lockedAccountId,
  defaultAccountId,
  renderHeader = false,
  earliestTransactionYear,
  hiddenCount,
  defaultRange,
}: TransactionsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // One navigation transition for every filter/search/reset push, so the
  // table can dim while the server fetches — "View all" used to leave stale
  // rows up for seconds with no sign anything was happening.
  const [isNavPending, startResetTransition] = useTransition();
  const hasNonEmptyDefault = Boolean(defaultRange?.start || defaultRange?.end);
  const resetFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("start");
    params.delete("end");
    params.delete("range");
    // When the route's default is something other than "all dates" (e.g.
    // /accounts/[id] defaults to this month), "View all" needs an explicit
    // override or a bare URL would just snap back to the default.
    if (hasNonEmptyDefault) params.set("range", "all");
    const next = params.toString();
    startResetTransition(() => {
      router.push(next ? `?${next}` : "?");
    });
  }, [router, searchParams, hasNonEmptyDefault]);
  const undoRedo = useUndoRedo();
  const { toast } = useToast();

  // Bulk mutations run detached from React's render so the toast lands on a
  // high-priority update (see transaction-dialog.tsx). A bare
  // `void (async () => …)()` would reject silently on a server error, leaving
  // the row list unchanged and the user assuming nothing happened. Route them
  // through this so every failure surfaces — per the system visibility rule in
  // CLAUDE.md, which calls out uncaught awaits outside dialogs specifically.
  const runMutation = useCallback(
    (fn: () => Promise<void>, failureMessage: string) => {
      void fn().catch(() => {
        toast({ message: failureMessage, variant: "error", duration: 2500 });
      });
    },
    [toast]
  );
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  // Flash the row once when an inline edit is saved (not cancelled), so the
  // eye can find it after the edit chrome collapses.
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const cancelledEditRef = useRef(false);
  const prevEditingRowIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevEditingRowIdRef.current;
    prevEditingRowIdRef.current = editingRowId;
    if (prev && editingRowId === null && !cancelledEditRef.current) {
      setFlashRowId(prev);
    }
    cancelledEditRef.current = false;
  }, [editingRowId]);
  useEffect(() => {
    if (!flashRowId) return;
    const t = window.setTimeout(() => setFlashRowId(null), 700);
    return () => window.clearTimeout(t);
  }, [flashRowId]);
  const [draft, setDraft] = useState<TransactionDraft | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitDraftState | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleInitial, setScheduleInitial] = useState<{
    accountId?: string; payee?: string; amount?: number; categoryId?: string; memo?: string;
  } | null>(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  // When set, the transfer dialog opens in edit mode for this pair.
  const [transferEditTarget, setTransferEditTarget] =
    useState<TransferEditTarget | null>(null);

  // The transfer dialog owns its own undo entry and toast now — it pushes to
  // the same module-singleton stack this page's Cmd+Z reads, so nothing is
  // lost by not duplicating it here.

  // Keep a ref to the original row so we can diff on commit
  const originalRef = useRef<TransactionWithDetails | null>(null);

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((k) => rowSelection[k]),
    [rowSelection]
  );

  // A row that leaves the view (e.g. categorized while filtered to
  // uncategorized) leaves the selection too — otherwise the header checkbox
  // stays indeterminate over nothing, and a bulk action would hit an
  // invisible row.
  useEffect(() => {
    const visible = new Set(transactions.map((t) => t.id));
    setRowSelection((prev) => {
      const kept = Object.keys(prev).filter((id) => prev[id] && visible.has(id));
      if (kept.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(kept.map((id) => [id, true]));
    });
  }, [transactions]);

  // Effective delete count: selected ids + any transfer siblings discoverable
  // in the currently-loaded transactions list (matches server-side
  // findTransferSibling's invariants: swapped accounts, mirrored amount, same
  // date). Only used for the confirm-delete dialog copy so the count reflects
  // what will actually get deleted, not just what the user clicked
  // (260518-fqy #4). If the sibling is filtered out of view, count stays
  // honest to the visible scope — the cascade still fires server-side.
  const effectiveDeleteCount = useMemo(() => {
    if (selectedIds.length === 0) return 0;
    const selectedSet = new Set(selectedIds);
    const expanded = new Set(selectedIds);
    for (const id of selectedIds) {
      const txn = transactions.find((t) => t.id === id);
      if (!txn || txn.transfer_account_id === null) continue;
      const sibling = transactions.find(
        (t) =>
          t.id !== txn.id &&
          !selectedSet.has(t.id) &&
          t.account_id === txn.transfer_account_id &&
          t.transfer_account_id === txn.account_id &&
          Number(t.amount) === -Number(txn.amount) &&
          t.date === txn.date
      );
      if (sibling) expanded.add(sibling.id);
    }
    return expanded.size;
  }, [selectedIds, transactions]);

  const selectedPayees = useMemo(
    () =>
      selectedIds.map((id) => {
        const txn = transactions.find((t) => t.id === id);
        return txn?.payee ?? null;
      }),
    [selectedIds, transactions]
  );

  // How many selected rows are still pending (approved=0). Drives the toolbar's
  // "Approve" action — shown only when there's something to post.
  const selectedPendingCount = useMemo(
    () =>
      selectedIds.filter(
        (id) => transactions.find((t) => t.id === id)?.approved === false
      ).length,
    [selectedIds, transactions]
  );

  // Transfer composition of the selection. A transfer is two linked rows; when
  // the whole selection is transfers the toolbar collapses to Approve / Edit /
  // Delete. Legs of one transfer share an unordered account pair, |amount|, and
  // date — group by that to count distinct pairs and detect a single-pair
  // selection (the only case where inline edit is offered).
  const transferSelectionInfo = useMemo(() => {
    const legs = selectedIds
      .map((id) => transactions.find((t) => t.id === id))
      .filter(
        (t): t is TransactionWithDetails => !!t && t.transfer_account_id !== null
      );
    const pairKeys = new Set(
      legs.map(
        (t) =>
          [t.account_id, t.transfer_account_id].sort().join("|") +
          `|${Math.abs(Number(t.amount))}|${t.date}`
      )
    );
    return {
      legCount: legs.length,
      pairCount: pairKeys.size,
      canEdit:
        legs.length > 0 &&
        legs.length === selectedIds.length &&
        pairKeys.size === 1,
    };
  }, [selectedIds, transactions]);

  const clearSelection = useCallback(() => setRowSelection({}), []);

  // Open the transfer dialog in edit mode for a transfer leg. Prefill is derived
  // from whichever leg we have (the negative leg is the from-side); the sibling
  // is resolved server-side, so this works even in an account-filtered view
  // where the other leg isn't loaded.
  const openTransferEdit = useCallback((row: TransactionWithDetails) => {
    if (row.transfer_account_id === null) return;
    const amt = Number(row.amount);
    const fromAccountId = amt < 0 ? row.account_id : row.transfer_account_id;
    const toAccountId = amt < 0 ? row.transfer_account_id : row.account_id;
    setTransferEditTarget({
      txnId: row.id,
      fromAccountId,
      toAccountId,
      amount: Math.abs(amt),
      date: row.date,
    });
    setTransferDialogOpen(true);
  }, []);

  const startEditing = useCallback((row: TransactionWithDetails) => {
    // Transfers can't be edited inline — one leg's amount/account is half the
    // pair. Route to the transfer dialog, which updates both legs atomically.
    if (row.transfer_account_id !== null) {
      openTransferEdit(row);
      return;
    }
    // Collapse the selection to just the editing row. Its own checkbox stays
    // checked for context; other rows drop out of the batch so the toolbar
    // doesn't reappear on commit/cancel claiming the old multi-selection.
    setRowSelection({ [row.id]: true });
    originalRef.current = row;
    setEditingRowId(row.id);
    setDraft({
      date: row.date,
      payee: row.payee ?? "",
      memo: row.memo ?? "",
      amount: Number(row.amount),
      category_id: row.category_id,
      account_id: row.account_id,
    });

    // Load existing splits for split parents
    if (row.is_split_parent) {
      getSplitsForTransaction(row.id).then((splits) => {
        setSplitDraft({
          parentAmount: Number(row.amount),
          items: splits.map((s) => ({
            tempId: clientId(),
            category_id: s.category_id ?? "",
            amount: Number(s.amount),
          })),
        });
      });
    } else {
      setSplitDraft(null);
    }
  }, [openTransferEdit]);

  const cancelEdit = useCallback(() => {
    cancelledEditRef.current = true;
    setEditingRowId(null);
    setDraft(null);
    setSplitDraft(null);
    originalRef.current = null;
  }, []);

  const commitEdit = useCallback(() => {
    const original = originalRef.current;
    if (!draft || !original) {
      cancelEdit();
      return;
    }

    // Balance gate — the single authority on whether a split may commit.
    // EditActionRow's Save button surfaces the "doesn't add up" prompt, but
    // commitEdit is also reached directly by Enter, click-outside,
    // click-another-row, and click-a-split-detail-row. Without this guard
    // those paths silently persist an under-allocated split and the budget
    // loses the unallocated remainder (same class as the /quick split loss).
    // Refuse and keep the row in edit mode so the user can rebalance or cancel.
    if (splitDraft) {
      const sumCents = splitDraft.items.reduce(
        (acc, item) => acc + Math.round(item.amount * 100),
        0
      );
      const parentCents = Math.round(splitDraft.parentAmount * 100);
      if (sumCents !== parentCents) return;
    }

    const id = original.id;

    // Handle split save
    if (splitDraft) {
      const splits: SplitInput[] = splitDraft.items
        .filter((item) => item.amount !== 0)
        .map((item) => ({
          category_id: item.category_id || null,
          amount: item.amount,
        }));

      // Also save any parent-level field changes (date, payee, memo, amount)
      const parentChanges: Record<string, unknown> = {};
      if (draft.date !== original.date) parentChanges.date = draft.date;
      if (draft.payee !== (original.payee ?? "")) parentChanges.payee = draft.payee;
      if (draft.memo !== (original.memo ?? "")) parentChanges.memo = draft.memo || null;
      if (draft.amount !== Number(original.amount)) parentChanges.amount = draft.amount;
      if (draft.account_id !== original.account_id) parentChanges.account_id = draft.account_id;

      // Capture old parent values for undo
      const oldParentValues: Record<string, unknown> = {};
      for (const key of Object.keys(parentChanges)) {
        switch (key) {
          case "date": oldParentValues.date = original.date; break;
          case "payee": oldParentValues.payee = original.payee ?? ""; break;
          case "memo": oldParentValues.memo = original.memo ?? null; break;
          case "amount": oldParentValues.amount = Number(original.amount); break;
          case "account_id": oldParentValues.account_id = original.account_id; break;
        }
      }
      const hasParentChanges = Object.keys(parentChanges).length > 0;

      setEditingRowId(null);
      setDraft(null);
      setSplitDraft(null);
      originalRef.current = null;

      // Sequence the two writes rather than firing them detached: the parent
      // amount must land BEFORE the splits so the server-side balance belt
      // (saveSplitsWithSnapshot) validates against the new total, not a stale
      // one. Both are awaited and caught so a rejected write surfaces a toast
      // instead of leaving an un-pushed undo entry and a silent divergence.
      runMutation(async () => {
        if (hasParentChanges) await updateTransaction(id, parentChanges);
        const snapshot = await saveSplitsWithSnapshot(id, splits);
        const entryId = undoRedo.push({
          label: "Edit split transaction",
          forward: async () => {
            if (hasParentChanges) await updateTransaction(id, parentChanges);
            await saveSplitsWithSnapshot(id, splits);
          },
          backward: async () => {
            // Restore the parent amount before the splits so the balance belt
            // sees a consistent (amount === split sum) state at every step.
            if (hasParentChanges) await updateTransaction(id, oldParentValues);
            await restoreSplitSnapshot(id, snapshot);
          },
        });
        toast({
          message: "Split saved",
          action: { label: "Undo", onClick: () => undoRedo.undoEntry(entryId) },
        });
      }, "Could not save split — try again");
      return;
    }

    // Handle split → single category conversion
    if (!splitDraft && original.is_split_parent && draft.category_id) {
      const parentChanges: Record<string, unknown> = {};
      if (draft.date !== original.date) parentChanges.date = draft.date;
      if (draft.payee !== (original.payee ?? "")) parentChanges.payee = draft.payee;
      if (draft.memo !== (original.memo ?? "")) parentChanges.memo = draft.memo || null;
      if (draft.amount !== Number(original.amount)) parentChanges.amount = draft.amount;
      if (draft.account_id !== original.account_id) parentChanges.account_id = draft.account_id;

      const oldParentValues: Record<string, unknown> = {};
      for (const key of Object.keys(parentChanges)) {
        switch (key) {
          case "date": oldParentValues.date = original.date; break;
          case "payee": oldParentValues.payee = original.payee ?? ""; break;
          case "memo": oldParentValues.memo = original.memo ?? null; break;
          case "amount": oldParentValues.amount = Number(original.amount); break;
          case "account_id": oldParentValues.account_id = original.account_id; break;
        }
      }
      const hasParentChanges = Object.keys(parentChanges).length > 0;
      const categoryId = draft.category_id;

      setEditingRowId(null);
      setDraft(null);
      setSplitDraft(null);
      originalRef.current = null;

      // Same sequencing as the split-save path: await + catch both writes, and
      // on undo restore the parent amount before re-inserting the splits so the
      // server-side balance belt never sees a mismatched intermediate state.
      runMutation(async () => {
        if (hasParentChanges) await updateTransaction(id, parentChanges);
        const snapshot = await removeSplitsWithSnapshot(id, categoryId);
        const entryId = undoRedo.push({
          label: "Remove splits",
          forward: async () => {
            if (hasParentChanges) await updateTransaction(id, parentChanges);
            await removeSplitsWithSnapshot(id, categoryId);
          },
          backward: async () => {
            if (hasParentChanges) await updateTransaction(id, oldParentValues);
            await restoreSplitSnapshot(id, snapshot);
          },
        });
        toast({
          message: "Splits removed",
          action: { label: "Undo", onClick: () => undoRedo.undoEntry(entryId) },
        });
      }, "Could not update — try again");
      return;
    }

    // Diff draft vs original to build partial update
    const changes: Record<string, unknown> = {};
    if (draft.date !== original.date) changes.date = draft.date;
    if (draft.payee !== (original.payee ?? "")) changes.payee = draft.payee;
    if (draft.memo !== (original.memo ?? "")) changes.memo = draft.memo || null;
    if (draft.amount !== Number(original.amount)) changes.amount = draft.amount;
    if ((draft.category_id ?? null) !== (original.category_id ?? null))
      changes.category_id = draft.category_id;
    if (draft.account_id !== original.account_id) changes.account_id = draft.account_id;

    // Clear editing state immediately for responsive UI
    setEditingRowId(null);
    setDraft(null);
    setSplitDraft(null);
    originalRef.current = null;

    // Nothing changed — skip server call
    if (Object.keys(changes).length === 0) return;

    // Build old values for undo (only changed fields)
    const oldValues: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) {
      switch (key) {
        case "date":
          oldValues.date = original.date;
          break;
        case "payee":
          oldValues.payee = original.payee ?? "";
          break;
        case "memo":
          oldValues.memo = original.memo ?? null;
          break;
        case "amount":
          oldValues.amount = Number(original.amount);
          break;
        case "category_id":
          oldValues.category_id = original.category_id ?? null;
          break;
        case "account_id":
          oldValues.account_id = original.account_id;
          break;
      }
    }

    // Await the write, THEN push the undo entry — so a rejected save never
    // leaves an "Edit transaction" entry on the stack whose Cmd+Z would write
    // stale field values over a row the server never changed.
    runMutation(async () => {
      await updateTransaction(id, changes);
      undoRedo.push({
        label: `Edit transaction`,
        forward: () => updateTransaction(id, changes),
        backward: () => updateTransaction(id, oldValues),
      });
    }, "Could not save — try again");
  }, [draft, splitDraft, cancelEdit, undoRedo, runMutation, toast]);

  // Only used when BANK_SYNC is enabled — approves + saves edits on pending transactions
  const approveEdit = useMemo(() => {
    if (!FEATURES.BANK_SYNC) return undefined;
    return () => {
      const original = originalRef.current;
      if (!draft || !original) {
        cancelEdit();
        return;
      }

      const changes: Record<string, unknown> = { approved: true };
      if (draft.date !== original.date) changes.date = draft.date;
      if (draft.payee !== (original.payee ?? "")) changes.payee = draft.payee;
      if (draft.memo !== (original.memo ?? "")) changes.memo = draft.memo || null;
      if (draft.amount !== Number(original.amount)) changes.amount = draft.amount;
      if ((draft.category_id ?? null) !== (original.category_id ?? null))
        changes.category_id = draft.category_id;
      if (draft.account_id !== original.account_id) changes.account_id = draft.account_id;

      const id = original.id;
      setEditingRowId(null);
      setDraft(null);
      originalRef.current = null;

      const oldValues: Record<string, unknown> = { approved: false };
      for (const key of Object.keys(changes)) {
        if (key === "approved") continue;
        switch (key) {
          case "date": oldValues.date = original.date; break;
          case "payee": oldValues.payee = original.payee ?? ""; break;
          case "memo": oldValues.memo = original.memo ?? null; break;
          case "amount": oldValues.amount = Number(original.amount); break;
          case "category_id": oldValues.category_id = original.category_id ?? null; break;
          case "account_id": oldValues.account_id = original.account_id; break;
        }
      }

      // Await before pushing — a failed approve must not leave an undo entry
      // whose Cmd+Z would rewrite stale values (see the plain-edit path above).
      runMutation(async () => {
        await updateTransaction(id, changes);
        undoRedo.push({
          label: `Approve transaction`,
          forward: () => updateTransaction(id, changes),
          backward: () => updateTransaction(id, oldValues),
        });
      }, "Could not approve — try again");
    };
  }, [draft, cancelEdit, undoRedo, runMutation]);

  const onEnterSplitMode = useCallback(() => {
    if (!draft || !editingRowId) return;
    const parentAmount = draft.amount;
    setSplitDraft({
      parentAmount,
      items: [
        {
          tempId: clientId(),
          category_id: draft.category_id ?? "",
          amount: parentAmount,
        },
        {
          tempId: clientId(),
          category_id: "",
          amount: 0,
        },
      ],
    });
    // Clear the parent's category since splits handle it
    setDraft({ ...draft, category_id: null });
  }, [draft, editingRowId]);

  const onExitSplitMode = useCallback((categoryId: string) => {
    if (!draft) return;
    setSplitDraft(null);
    setDraft({ ...draft, category_id: categoryId });
  }, [draft]);

  const handleSelectionAction = useCallback(
    (action: SelectionAction) => {
      const ids = [...selectedIds];
      // Category, payee, move, and duplicate don't apply to transfer legs
      // (no category, derived payee, orphan-on-duplicate). In a mixed selection
      // they act on the non-transfer rows only; the toolbar hides them entirely
      // when the selection is all transfers.
      const nonTransferIds = ids.filter(
        (id) => transactions.find((t) => t.id === id)?.transfer_account_id == null
      );
      // Keep the selection through schedule (needs the row) and editTransfer
      // (so a cancel returns to the same selection).
      if (action.type !== "schedule" && action.type !== "editTransfer") {
        clearSelection();
      }

      switch (action.type) {
        case "editTransfer": {
          const legId = ids.find(
            (id) => transactions.find((t) => t.id === id)?.transfer_account_id != null
          );
          const row = legId
            ? transactions.find((t) => t.id === legId)
            : undefined;
          if (row) openTransferEdit(row);
          break;
        }
        case "approve": {
          // Post pending (approved=0) rows: the server action applies each
          // held amount to current_balance and flips approved=1. Only the
          // pending rows in the selection are posted (the action guards on
          // approved=0), so a mixed selection does the right thing.
          const pendingIds = ids.filter(
            (id) => transactions.find((t) => t.id === id)?.approved === false
          );
          if (pendingIds.length === 0) break;
          runMutation(async () => {
            let snapshot: PendingPostSnapshotRow[] =
              await postPendingTransactionsWithSnapshot(pendingIds);
            const entryId = undoRedo.push({
              label: `Approve ${snapshot.length} transaction(s)`,
              forward: async () => {
                // Redo re-posts the same ids (undo flipped them back to
                // approved=0, so they qualify again); the new snapshot
                // replaces the prior one.
                snapshot = await postPendingTransactionsWithSnapshot(pendingIds);
              },
              backward: async () => {
                await unpostPendingTransactions(snapshot);
              },
            });
            // Approving applies each held amount to the account balance — an
            // off-screen number — so the only on-screen change is a Pending
            // badge vanishing. Toast the count (amount-free) with the Undo.
            toast({
              message: `Approved ${snapshot.length} transaction${
                snapshot.length === 1 ? "" : "s"
              }`,
              action: {
                label: "Undo",
                onClick: () => undoRedo.undoEntry(entryId),
              },
            });
          }, "Could not approve — try again");
          break;
        }

        case "delete": {
          runMutation(async () => {
            let snapshots: TransactionSnapshot[] =
              await bulkDeleteTransactionsWithSnapshot(ids);
            const entryId = undoRedo.push({
              label: `Delete ${ids.length} transaction(s)`,
              forward: async () => {
                // Redo: re-delete the same ids (restoreTransactionSnapshots
                // re-inserts at the original ids, so the snapshots stay valid).
                snapshots = await bulkDeleteTransactionsWithSnapshot(ids);
              },
              backward: async () => {
                await restoreTransactionSnapshots(snapshots);
              },
            });
            toast({
              message: `Deleted ${ids.length} transaction${
                ids.length === 1 ? "" : "s"
              }`,
              action: {
                label: "Undo",
                onClick: () => undoRedo.undoEntry(entryId),
              },
            });
          }, "Could not delete — try again");
          break;
        }

        case "categorize": {
          const targetIds = nonTransferIds;
          if (targetIds.length === 0) break;
          // Await before pushing, like every other branch of this switch: a
          // failed categorize must surface a toast and leave the undo stack
          // empty, not sit there waiting for a Cmd+Z that rewrites categories
          // the server never changed.
          runMutation(async () => {
            await bulkUpdateTransactions(targetIds, { category_id: action.categoryId });
            undoRedo.push({
              label: `Categorize ${targetIds.length} transaction(s)`,
              forward: () =>
                bulkUpdateTransactions(targetIds, { category_id: action.categoryId }),
              backward: async () => {
                // Restore individual categories
                for (const id of targetIds) {
                  const txn = transactions.find((t) => t.id === id);
                  if (txn) await updateTransaction(id, { category_id: txn.category_id });
                }
              },
            });
          }, "Could not categorize — try again");
          break;
        }

        case "moveAccount": {
          const targetIds = nonTransferIds;
          if (targetIds.length === 0) break;
          const destName =
            accounts.find((a) => a.id === action.accountId)?.name ?? "account";
          runMutation(async () => {
            let snapshot: AccountMoveSnapshot =
              await bulkMoveTransactionsToAccountWithSnapshot(targetIds, action.accountId);
            const entryId = undoRedo.push({
              label: `Move ${targetIds.length} transaction(s) to ${destName}`,
              forward: async () => {
                // Redo re-applies the same move; the new snapshot replaces the
                // prior one so the next undo reverses against current state.
                snapshot = await bulkMoveTransactionsToAccountWithSnapshot(
                  targetIds,
                  action.accountId
                );
              },
              backward: async () => {
                await restoreAccountMoveSnapshot(snapshot);
              },
            });
            // Moving shifts money between two account balances (both off-screen
            // in the sidebar) while the selection clears — toast the count and
            // destination, amount-free, with the Undo.
            toast({
              message: `Moved ${targetIds.length} transaction${
                targetIds.length === 1 ? "" : "s"
              } to ${destName}`,
              action: {
                label: "Undo",
                onClick: () => undoRedo.undoEntry(entryId),
              },
            });
          }, `Could not move to ${destName} — try again`);
          break;
        }

        case "renamePayee": {
          const targetIds = nonTransferIds;
          if (targetIds.length === 0) break;
          const newPayee = action.payee;
          runMutation(async () => {
            let snapshots: PayeeSnapshotRow[] =
              await bulkRenamePayeeWithSnapshot(targetIds, newPayee);
            const entryId = undoRedo.push({
              label: `Rename payee on ${targetIds.length} transaction(s)`,
              forward: async () => {
                // Redo re-applies the same rename; the new snapshot replaces
                // the prior one so the next undo reverses against current state.
                snapshots = await bulkRenamePayeeWithSnapshot(targetIds, newPayee);
              },
              backward: async () => {
                await restorePayeeSnapshots(snapshots);
              },
            });
            // The renamed rows may be filtered out of view once the selection
            // clears, so the rename can leave no on-screen trace — toast the
            // count with the Undo.
            toast({
              message: `Renamed payee on ${targetIds.length} transaction${
                targetIds.length === 1 ? "" : "s"
              }`,
              action: {
                label: "Undo",
                onClick: () => undoRedo.undoEntry(entryId),
              },
            });
          }, "Could not rename payee — try again");
          break;
        }

        case "duplicate": {
          if (nonTransferIds.length === 0) break;
          runMutation(async () => {
            // Undo deletes the copies rather than restoring anything, so it
            // needs the ids the server just minted.
            let dupIds = await duplicateTransactions(nonTransferIds);
            if (dupIds.length === 0) return;
            // Redo restores the copies the undo captured rather than
            // re-duplicating: a re-duplicate would read the ORIGINALS again,
            // silently discarding any edit the user made to a copy before
            // undoing, and would produce fewer rows if an original had since
            // been deleted. Falls back to duplicating only if there's no
            // capture to restore (i.e. redo without a preceding undo).
            let deleted: TransactionSnapshot[] | null = null;
            const entryId = undoRedo.push({
              label: `Duplicate ${dupIds.length} transaction${
                dupIds.length === 1 ? "" : "s"
              }`,
              forward: async () => {
                if (deleted) {
                  await restoreTransactionSnapshots(deleted);
                  deleted = null;
                } else {
                  dupIds = await duplicateTransactions(nonTransferIds);
                }
              },
              backward: async () => {
                deleted = await bulkDeleteTransactionsWithSnapshot(dupIds);
              },
            });
            toast({
              message: `Duplicated ${dupIds.length} transaction${
                dupIds.length === 1 ? "" : "s"
              }`,
              action: {
                label: "Undo",
                onClick: () => undoRedo.undoEntry(entryId),
              },
            });
          }, "Could not duplicate — try again");
          break;
        }

        case "cleared":
          if (FEATURES.RECONCILIATION) {
            bulkUpdateTransactions(ids, { cleared: 1 });
            undoRedo.push({
              label: `Clear ${ids.length} transaction(s)`,
              forward: () => bulkUpdateTransactions(ids, { cleared: 1 }),
              backward: () => bulkUpdateTransactions(ids, { cleared: 0 }),
            });
          }
          break;

        case "schedule": {
          const txn = transactions.find((t) => t.id === ids[0]);
          if (txn) {
            setScheduleInitial({
              accountId: txn.account_id,
              payee: txn.payee ?? undefined,
              amount: Number(txn.amount),
              categoryId: txn.category_id ?? undefined,
              memo: txn.memo ?? undefined,
            });
            setScheduleDialogOpen(true);
          }
          break;
        }
      }
    },
    [
      selectedIds,
      clearSelection,
      undoRedo,
      transactions,
      accounts,
      openTransferEdit,
      toast,
      runMutation,
    ]
  );

  const deleteWithUndo = useCallback(
    async (id: string) => {
      // The caller (ApprovalCell) only attaches .finally, so an unguarded
      // throw here would surface nowhere.
      let initial: TransactionSnapshot[];
      try {
        initial = await deleteTransactionWithSnapshot(id);
      } catch {
        toast({
          message: "Could not delete — try again",
          variant: "error",
          duration: 2500,
        });
        return;
      }
      if (initial.length === 0) return;
      // Array-shaped: length 1 for an ordinary row, length 2 when a transfer
      // pair cascaded (260518-fqy). Undo restores all snapshots in the array.
      let snapshots: TransactionSnapshot[] = initial;
      const entryId = undoRedo.push({
        label: snapshots.length === 2 ? "Delete transfer" : "Delete transaction",
        forward: async () => {
          // Redo: re-delete via the primary id; the cascade re-expands inside
          // the action and the fresh array (possibly still length 2) replaces
          // our handle so the next undo restores everything.
          const fresh = await deleteTransactionWithSnapshot(snapshots[0].id);
          if (fresh.length > 0) snapshots = fresh;
        },
        backward: async () => {
          await restoreTransactionSnapshots(snapshots);
        },
      });
      // Undo targets this entry by id rather than popping the stack, so it
      // still undoes this delete after the user has done something else in the
      // six seconds the toast is up.
      toast({
        message:
          snapshots.length === 2 ? "Transfer deleted" : "Transaction deleted",
        action: { label: "Undo", onClick: () => undoRedo.undoEntry(entryId) },
      });
    },
    [undoRedo, toast]
  );

  const transferAccountOptions = useMemo(
    () => accounts.map((a) => ({ id: a.id, name: a.name })),
    [accounts]
  );


  return (
    <>
      {renderHeader ? (
        <div className="flex items-center justify-between px-6 h-[88px] border-b border-border bg-accent/40">
          <h1 className="page-title">Transactions</h1>
          <div className="flex items-center gap-2">
            {/* Secondary header actions are icon-only with a tooltip; the
                labelled button is reserved for the primary (Add transaction). */}
            <ToolbarIconButton
              label="Transfer"
              variant="outline"
              className="size-[38px]"
              onClick={() => setTransferDialogOpen(true)}
            >
              <ArrowLeftRight />
            </ToolbarIconButton>
            <QuickAdd
              accounts={accounts}
              categories={categories}
              categoryGroups={categoryGroups}
              payees={payees}
            />
          </div>
        </div>
      ) : null}
      <TransactionToolbar
        // Import/export sit in the control row on /transactions and on
        // /accounts/[id] (scoped to that account there).
        actions={
          <CsvActions
            accounts={accounts}
            payees={payees}
            categories={categories}
            transactions={transactions}
            accountId={lockedAccountId}
            accountName={
              lockedAccountId
                ? accounts.find((a) => a.id === lockedAccountId)?.name
                : undefined
            }
          />
        }
        canUndo={undoRedo.canUndo}
        canRedo={undoRedo.canRedo}
        onUndo={undoRedo.undo}
        onRedo={undoRedo.redo}
        isUndoPending={undoRedo.isPending}
        earliestTransactionYear={earliestTransactionYear}
        defaultRange={defaultRange}
        categories={categories}
        startNavigation={startResetTransition}
        searchPlaceholder={
          lockedAccountId
            ? `Search ${accounts.find((a) => a.id === lockedAccountId)?.name ?? "account"}`
            : "Search transactions"
        }
      />
      <TransactionTable
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        payees={payees}
        defaultAccountId={defaultAccountId ?? lockedAccountId}
        editingRowId={editingRowId}
        flashRowId={flashRowId}
        isRefreshing={isNavPending}
        draft={draft}
        setDraft={(d) => {
          setDraft(d);
          // Keep splitDraft.parentAmount in sync when the parent amount changes
          if (d && splitDraft && d.amount !== splitDraft.parentAmount) {
            setSplitDraft({ ...splitDraft, parentAmount: d.amount });
          }
        }}
        startEditing={startEditing}
        commitEdit={commitEdit}
        cancelEdit={cancelEdit}
        approveEdit={approveEdit}
        splitDraft={splitDraft}
        setSplitDraft={setSplitDraft}
        onEnterSplitMode={onEnterSplitMode}
        onExitSplitMode={onExitSplitMode}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        deleteWithUndo={deleteWithUndo}
        hiddenCount={hiddenCount}
        onResetAllFilters={resetFilters}
        defaultRangeStart={defaultRange?.start ?? null}
      />
      {hiddenCount > 0 && transactions.length > 0 ? (
        <div className="flex items-center justify-center gap-3 py-3 text-[13px] text-muted-foreground border-t border-border/50">
          <span>Some transactions are hidden by filters.</span>
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs font-semibold border border-border rounded-md px-2.5 py-1 hover:bg-accent/30 transition-colors"
          >
            View all
          </button>
        </div>
      ) : null}
      <SelectionToolbar
        selectedCount={editingRowId ? 0 : selectedIds.length}
        effectiveDeleteCount={editingRowId ? 0 : effectiveDeleteCount}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        payees={payees}
        selectedPayees={selectedPayees}
        pendingCount={editingRowId ? 0 : selectedPendingCount}
        transferInfo={editingRowId ? undefined : transferSelectionInfo}
        onDeselect={clearSelection}
        onAction={handleSelectionAction}
      />
      <ScheduleDialog
        open={scheduleDialogOpen}
        onOpenChange={(open) => {
          setScheduleDialogOpen(open);
          if (!open) setScheduleInitial(null);
        }}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        initialValues={scheduleInitial}
      />
      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={(open) => {
          setTransferDialogOpen(open);
          if (!open) setTransferEditTarget(null);
        }}
        accounts={transferAccountOptions}
        defaultFromAccountId={lockedAccountId ?? undefined}
        editTarget={transferEditTarget}
      />
    </>
  );
}
