"use client";

import { useMemo, useState, useTransition } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn, fieldClass } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field-group";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DateInput } from "@/components/shared/date-input";
import { parseMoneyInput } from "@/lib/db-utils";
import type { TrackedAssetHistory } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { useNetWorthUndo } from "./use-net-worth-undo";

type AssetHistoryTableProps = {
  rows: TrackedAssetHistory[];
};

type SortedRow = TrackedAssetHistory & {
  /** Change vs. the immediately-prior chronological row (older). null on the
   *  oldest row in the table because there's no earlier value to diff against. */
  change: number | null;
};

/**
 * Sort DESC (most recent first) for display while computing `change` against
 * the chronologically-prior row (older). Visually: each row says "I am N
 * dollars higher/lower than the value I replaced."
 */
function sortAndAnnotate(rows: TrackedAssetHistory[]): SortedRow[] {
  // Ascending for change computation; reverse afterwards for display.
  const asc = rows.slice().sort((a, b) => {
    if (a.recorded_at !== b.recorded_at)
      return a.recorded_at < b.recorded_at ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
  const annotated: SortedRow[] = asc.map((row, i) => ({
    ...row,
    change: i === 0 ? null : Number(row.value) - Number(asc[i - 1].value),
  }));
  // Display order: most recent first.
  return annotated.reverse();
}

export function AssetHistoryTable({ rows }: AssetHistoryTableProps) {
  const sorted = useMemo(() => sortAndAnnotate(rows), [rows]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <EmptyState variant="compact" message="No history recorded yet." />
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="grid grid-cols-[140px_140px_140px_1fr_48px] items-center gap-3 px-4 h-12 bg-background border-b border-border text-[11px] font-medium text-muted-foreground uppercase tracking-[0.04em]">
        <span>Date</span>
        <span className="text-right">Value</span>
        <span className="text-right">Change</span>
        <span>Note</span>
        <span className="sr-only">Actions</span>
      </div>
      <ul className="divide-y divide-border">
        {sorted.map((row) => (
          <HistoryRow key={row.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------

function HistoryRow({ row }: { row: SortedRow }) {
  const fmt = useMaskedCurrency();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const change = row.change;
  const changeLabel =
    change === null
      ? "—"
      : `${change >= 0 ? "+" : ""}${fmt(change)}`;

  return (
    <li className="grid grid-cols-[140px_140px_140px_1fr_48px] items-center gap-3 px-4 h-12 hover:bg-accent/30 transition-colors">
      <span className="text-base tabular-nums text-foreground">
        {formatDate(row.recorded_at)}
      </span>
      <span className="text-base tabular-nums text-right text-foreground zero-amount">
        {fmt(Number(row.value))}
      </span>
      <span
        className={cn(
          "text-base tabular-nums text-right zero-amount",
          change === null
            ? "text-muted-foreground"
            : change > 0
            ? "text-positive"
            : change < 0
            ? "text-negative"
            : "text-muted-foreground"
        )}
      >
        {changeLabel}
      </span>
      <span className="text-base text-muted-foreground truncate">
        {row.note ?? ""}
      </span>

      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for entry on ${row.recorded_at}`}
              />
            }
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} className="min-w-[160px]">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <EditHistoryRowDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        row={row}
      />
      <DeleteHistoryRowDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        rowId={row.id}
        recordedAt={row.recorded_at}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Edit dialog
//
// Routes through `pushHistoryRowUpdate` from useNetWorthUndo so the edit lands
// on the shared undo stack, then toasts with an Undo action — editing the
// newest row moves the asset's current_value in the page header, an off-screen
// number the dialog itself never shows.
// ---------------------------------------------------------------------------

function EditHistoryRowDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: TrackedAssetHistory;
}) {
  const [valueRaw, setValueRaw] = useState<string>(Number(row.value).toFixed(2));
  const [recordedAt, setRecordedAt] = useState<string>(row.recorded_at);
  const [note, setNote] = useState<string>(row.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { pushHistoryRowUpdate, undoEntry } = useNetWorthUndo();
  const { toast } = useToast();
  const { hidden } = useAmountsHidden();

  const reset = () => {
    setValueRaw(Number(row.value).toFixed(2));
    setRecordedAt(row.recorded_at);
    setNote(row.note ?? "");
    setError(null);
  };

  const handleSave = () => {
    // Privacy lock: amounts hidden, so no value change is saved.
    if (hidden) return;
    const parsed = parseMoneyInput(valueRaw);
    if (parsed === null) {
      setError("Enter a valid amount.");
      return;
    }
    if (!recordedAt) {
      setError("Pick a recorded date.");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const trimmedNote = note.trim();
        const entryId = await pushHistoryRowUpdate(row.id, {
          value: parsed,
          recorded_at: recordedAt,
          note: trimmedNote.length > 0 ? trimmedNote : null,
        });
        toast({
          message: "History entry updated",
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
        onOpenChange(false);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to update entry.";
        setError(message);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit history entry</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FieldGroup label="Value" htmlFor="edit-history-value">
            <input
              id="edit-history-value"
              className={fieldClass}
              type="text"
              inputMode="decimal"
              value={hidden ? "" : valueRaw}
              onChange={(e) => {
                setValueRaw(e.target.value);
                if (error) setError(null);
              }}
              placeholder={hidden ? "$••••••" : "0.00"}
              disabled={hidden}
            />
          </FieldGroup>

          <FieldGroup label="Recorded on" htmlFor="edit-history-date">
            <DateInput
              id="edit-history-date"
              className="text-sm"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
            />
          </FieldGroup>

          <FieldGroup label="Note (optional)" htmlFor="edit-history-note">
            <input
              id="edit-history-note"
              className={fieldClass}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </FieldGroup>

          {error ? (
            <div className="text-sm text-negative" role="status">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={hidden || isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete dialog
// ---------------------------------------------------------------------------

function DeleteHistoryRowDialog({
  open,
  onOpenChange,
  rowId,
  recordedAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowId: string;
  recordedAt: string;
}) {
  const { pushHistoryRowDelete, undoEntry } = useNetWorthUndo();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      try {
        const entryId = await pushHistoryRowDelete(rowId);
        if (entryId) {
          toast({
            message: "History entry deleted",
            action: { label: "Undo", onClick: () => undoEntry(entryId) },
          });
        }
      } catch {
        toast({
          message: "Couldn't delete the history entry.",
          variant: "error",
        });
      }
    });
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete history entry from ${formatDate(recordedAt)}?`}
      description="This will remove only this entry. The asset itself remains. Undo from the toast if you change your mind."
      confirmLabel="Delete entry"
      onConfirm={handleDelete}
    />
  );
}
