"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { transactionsToCsv } from "@/lib/csv-export";
import { exportAllTransactionsCsv } from "@/app/(app)/transactions/actions";
import type { TransactionWithDetails } from "@/lib/types";

type ExportCsvDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The currently-loaded filtered/searched/sorted rows held by the client. */
  currentViewRows: TransactionWithDetails[];
  /** Human label of the visible date range (parent computes); null when empty. */
  dateRangeLabel: string | null;
  /**
   * When set, "All history" exports only this account's transactions (the
   * per-account export on /accounts/[id]). `accountName` drives copy + filename.
   */
  accountId?: string;
  accountName?: string;
};

/** Lowercase-and-hyphenate an account name for use in a download filename. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Build the Blob, trigger a temporary <a download>, then revoke the object URL. */
function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Two-scope CSV export chooser (260611-hv3). The user picks between exporting the
 * loaded current view (serialized client-side, no server round-trip) and exporting
 * all history (fetched uncapped via the exportAllTransactionsCsv server action).
 */
export function ExportCsvDialog({
  open,
  onOpenChange,
  currentViewRows,
  dateRangeLabel,
  accountId,
  accountName,
}: ExportCsvDialogProps) {
  const [isExporting, setIsExporting] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const currentViewEmpty = currentViewRows.length === 0;

  const currentViewHelper =
    dateRangeLabel ?? `All loaded rows · ${currentViewRows.length} rows`;

  function handleExportCurrentView() {
    if (currentViewEmpty) return;
    const csv = transactionsToCsv(currentViewRows);
    downloadCsv(csv, `zero-transactions-${today}.csv`);
    onOpenChange(false);
  }

  async function handleExportAllHistory() {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const csv = await exportAllTransactionsCsv(accountId);
      const scope = accountId && accountName ? slugify(accountName) : "all";
      downloadCsv(csv, `zero-transactions-${scope}-${today}.csv`);
      onOpenChange(false);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export transactions</DialogTitle>
          <DialogDescription>
            Choose what to export as an import-compatible CSV.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">Current view</span>
              <span className="text-xs text-muted-foreground">
                {currentViewHelper}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCurrentView}
              disabled={currentViewEmpty}
            >
              Export
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">All history</span>
              <span className="text-xs text-muted-foreground">
                {accountId
                  ? `Every ${accountName ?? "account"} transaction, ignoring filters`
                  : "Every transaction, ignoring filters"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportAllHistory}
              disabled={isExporting}
            >
              {isExporting ? "Exporting…" : "Export"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
