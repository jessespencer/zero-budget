"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Download, FileUp } from "lucide-react";
import { CSVImportWrapper } from "@/app/(app)/transactions/csv-import-wrapper";
import { ExportCsvDialog } from "@/components/transactions/export-csv-dialog";
import { ToolbarIconButton } from "@/components/shared/toolbar-icon-button";
import type { TransactionWithDetails } from "@/lib/types";

type CsvActionsProps = {
  accounts: { id: string; name: string }[];
  payees: { name: string; default_category_id: string | null }[];
  categories: { id: string; name: string }[];
  /** The page's server-fetched (URL-filtered) rows — the export's "current view". */
  transactions: TransactionWithDetails[];
  /** On /accounts/[id]: preselects the import account and scopes "All history". */
  accountId?: string;
  accountName?: string;
};

/**
 * Import + export CSV as two icon buttons that own their dialogs. The icons
 * differ in silhouette, not just arrow direction — a document (FileUp) for
 * import vs a tray (Download) for export — because mirrored up/down arrows
 * side by side were too easy to confuse.
 */
export function CsvActions({
  accounts,
  payees,
  categories,
  transactions,
  accountId,
  accountName,
}: CsvActionsProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // "Oct 2026 · 42 rows" — shown in the export dialog so the user knows what
  // "Current view" covers. `transactions` is already filtered and sorted.
  const dateRangeLabel = useMemo<string | null>(() => {
    if (transactions.length === 0) return null;
    let min = transactions[0].date;
    let max = transactions[0].date;
    for (const t of transactions) {
      if (t.date < min) min = t.date;
      if (t.date > max) max = t.date;
    }
    const minLabel = format(parseISO(min), "MMM yyyy");
    const maxLabel = format(parseISO(max), "MMM yyyy");
    const range = minLabel === maxLabel ? minLabel : `${minLabel} – ${maxLabel}`;
    return `${range} · ${transactions.length} rows`;
  }, [transactions]);

  return (
    <>
      <ToolbarIconButton label="Import CSV" onClick={() => setImportOpen(true)}>
        <FileUp />
      </ToolbarIconButton>
      <ToolbarIconButton label="Export CSV" onClick={() => setExportOpen(true)}>
        <Download />
      </ToolbarIconButton>
      <CSVImportWrapper
        accounts={accounts}
        payees={payees}
        categories={categories}
        defaultAccountId={accountId}
        trigger="none"
        open={importOpen}
        onOpenChange={setImportOpen}
      />
      <ExportCsvDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        currentViewRows={transactions}
        dateRangeLabel={dateRangeLabel}
        accountId={accountId}
        accountName={accountName}
      />
    </>
  );
}
