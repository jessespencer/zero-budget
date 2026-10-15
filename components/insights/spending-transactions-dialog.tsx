"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Currency } from "@/components/shared/currency";
import { formatDate, formatMonthYear } from "@/lib/format";
import type { SpendingTransaction } from "@/app/(app)/insights/actions";
import { cn } from "@/lib/utils";

export type SpendingDialogSelection = {
  categoryName: string;       // "Groceries" or "Everything else"
  isBucket: boolean;          // when true, render the extra Category column
  monthKey: string;
  totalAmount: number;        // sum from the SpendingItem — used in subtitle
  rows: SpendingTransaction[]; // preloaded server-side in getSpendingData
};

type SpendingTransactionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: SpendingDialogSelection | null;
};

export function SpendingTransactionsDialog({
  open,
  onOpenChange,
  selection,
}: SpendingTransactionsDialogProps) {
  if (!selection) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl" />
      </Dialog>
    );
  }

  const month = formatMonthYear(selection.monthKey);
  const count = selection.rows.length;
  const countLabel = `${count} ${count === 1 ? "transaction" : "transactions"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{selection.categoryName}</DialogTitle>
          <DialogDescription className="text-sm flex items-center gap-1.5">
            <span>{month}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>{countLabel}</span>
            <span className="text-muted-foreground/50">·</span>
            <Currency
              amount={-Math.abs(selection.totalAmount)}
              className="font-semibold"
            />
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
          {count === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No transactions in {month} for {selection.categoryName}.
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {selection.rows.map((r) => (
                <SpendingRow
                  key={r.id}
                  row={r}
                  showCategory={selection.isBucket}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type SpendingRowProps = {
  row: SpendingTransaction;
  showCategory: boolean;
};

function SpendingRow({ row, showCategory }: SpendingRowProps) {
  return (
    <div className="flex items-center gap-6 py-2.5">
      <div className="text-sm tabular-nums w-[88px] shrink-0 text-muted-foreground">
        {formatDate(row.date)}
      </div>
      <div
        className={cn(
          "text-sm text-muted-foreground truncate shrink-0",
          showCategory ? "w-[88px]" : "w-[120px]"
        )}
      >
        {row.accountName}
      </div>
      {showCategory && (
        <div className="text-sm text-muted-foreground truncate w-[128px] shrink-0">
          {row.categoryName}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {row.payee ?? "—"}
        </div>
        {row.memo ? (
          <div className="text-xs text-muted-foreground truncate">
            {row.memo}
          </div>
        ) : null}
      </div>
      <div className="text-sm font-semibold tabular-nums w-[92px] text-right shrink-0">
        <Currency amount={row.amount} smallCents={false} />
      </div>
    </div>
  );
}
