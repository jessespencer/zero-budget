"use client";

import { CSVImportDialog } from "@/components/transactions/csv-import-dialog";
import {
  bulkImportTransactionsWithSnapshot,
  bulkDeleteTransactionsWithSnapshot,
  restoreTransactionSnapshots,
  type TransactionSnapshot,
} from "./actions";
import type { ParsedTransaction } from "@/lib/csv-parsers";
import { useUndoRedo } from "@/lib/use-undo-redo";
import { useToast } from "@/components/ui/toast";

type CSVImportWrapperProps = {
  accounts: { id: string; name: string }[];
  payees: { name: string; default_category_id: string | null }[];
  categories: { id: string; name: string }[];
  defaultAccountId?: string;
  trigger?: "button" | "none";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CSVImportWrapper({
  accounts,
  payees,
  categories,
  defaultAccountId,
  trigger,
  open,
  onOpenChange,
}: CSVImportWrapperProps) {
  const undoRedo = useUndoRedo();
  const { toast } = useToast();

  // One atomic call per account group. Payee-match, income fallback and the
  // categorized count all live server-side now (mirrors createTransaction), so
  // this only resolves the CSV-provided category name → id before handing off.
  const handleImport = async (
    accountId: string,
    transactions: ParsedTransaction[]
  ) => {
    const rows = transactions.map((txn) => ({
      date: txn.date,
      payee: txn.payee,
      memo: txn.memo,
      amount: txn.amount,
      // CSV-provided category (e.g. a Category column) takes precedence over
      // the server's payee-based fallback.
      category_id: txn.category
        ? categories.find(
            (c) => c.name.trim().toLowerCase() === txn.category!.trim().toLowerCase()
          )?.id
        : undefined,
    }));

    const res = await bulkImportTransactionsWithSnapshot(accountId, rows);
    return {
      imported: res.imported,
      categorized: res.categorized,
      snapshots: res.snapshots,
    };
  };

  // Fired once after every account group has imported. The import moves account
  // balances (off-screen) and lands rows the user then closes the dialog on, so
  // the acknowledgement is a toast with a single Undo for the whole import.
  const handleComplete = (snapshots: TransactionSnapshot[]) => {
    if (snapshots.length === 0) return;
    const count = snapshots.length;
    const ids = snapshots.map((s) => s.id);
    const entryId = undoRedo.push({
      label: `Import ${count} transaction${count === 1 ? "" : "s"}`,
      // Redo re-inserts the same rows at their original ids and re-applies the
      // balance; undo deletes them and reverses it.
      forward: async () => {
        await restoreTransactionSnapshots(snapshots);
      },
      backward: async () => {
        await bulkDeleteTransactionsWithSnapshot(ids);
      },
    });
    toast({
      message: `Imported ${count} transaction${count === 1 ? "" : "s"}`,
      action: { label: "Undo", onClick: () => undoRedo.undoEntry(entryId) },
    });
  };

  return (
    <CSVImportDialog
      accounts={accounts}
      payees={payees}
      categories={categories}
      onImport={handleImport}
      onComplete={handleComplete}
      defaultAccountId={defaultAccountId}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}
