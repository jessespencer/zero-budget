"use client";

import { useEffect, useState, useTransition } from "react";
import { cn, tableHeaderRow } from "@/lib/utils";
import { OPEN_TABLE_ROW_CLASS } from "@/lib/row-classes";
import { formatDate } from "@/lib/format";
import { Currency } from "@/components/shared/currency";
import {
  getScheduleStatus,
  formatFrequency,
  getStatusProps,
} from "@/lib/schedule-utils";
import {
  deleteScheduleWithSnapshot,
  restoreScheduleSnapshot,
  postScheduleTransaction,
  skipScheduleDate,
  completeSchedule,
  restartSchedule,
} from "@/app/(app)/schedules/actions";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ScheduleDialog } from "./schedule-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  CircleCheck,
  Clock,
  MoreHorizontal,
  Star,
} from "lucide-react";
import type { ScheduledTransactionWithDetails, ScheduleStatus } from "@/lib/types";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table";
import { useMemo } from "react";

type ScheduleTableProps = {
  schedules: ScheduledTransactionWithDetails[];
  accounts: { id: string; name: string; type: string; is_budget_account: boolean }[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
};

const columnHelper = createColumnHelper<ScheduledTransactionWithDetails>();

function buildColumns(): ColumnDef<ScheduledTransactionWithDetails, unknown>[] {
  return [
    columnHelper.display({
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = getScheduleStatus(row.original, row.original.has_paid_transaction);
        return <StatusBadge status={status} />;
      },
    }) as ColumnDef<ScheduledTransactionWithDetails, unknown>,

    columnHelper.accessor((row) => row.name || row.payee, {
      id: "name",
      header: "Name",
      cell: (info) => {
        const val = info.getValue();
        return val || <span className="text-muted-foreground italic">Unnamed</span>;
      },
    }) as ColumnDef<ScheduledTransactionWithDetails, unknown>,

    columnHelper.accessor("category_name", {
      id: "category",
      header: "Category",
      cell: (info) => {
        const val = info.getValue();
        return val || <span className="text-muted-foreground italic">Uncategorized</span>;
      },
    }) as ColumnDef<ScheduledTransactionWithDetails, unknown>,

    columnHelper.accessor("account_name", {
      id: "account",
      header: "Account",
    }) as ColumnDef<ScheduledTransactionWithDetails, unknown>,

    columnHelper.display({
      id: "frequency",
      header: "Frequency",
      cell: ({ row }) => {
        const isRecurring = row.original.frequency !== "once";
        return (
          <span className="inline-flex items-center gap-1.5">
            {isRecurring && <CalendarClock className="h-3.5 w-3.5 text-muted-foreground/40" />}
            {formatFrequency(row.original)}
          </span>
        );
      },
    }) as ColumnDef<ScheduledTransactionWithDetails, unknown>,

    columnHelper.accessor("next_date", {
      id: "nextDate",
      header: "Next date",
      cell: (info) => {
        return info.row.original.completed ? "—" : formatDate(info.getValue());
      },
    }) as ColumnDef<ScheduledTransactionWithDetails, unknown>,

    columnHelper.accessor("amount", {
      id: "amount",
      header: "Amount",
      cell: (info) => {
        const amount = Number(info.getValue());
        return <Currency amount={amount} colorize={false} />;
      },
    }) as ColumnDef<ScheduledTransactionWithDetails, unknown>,

    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <ScheduleActionsCell schedule={row.original} />,
    }) as ColumnDef<ScheduledTransactionWithDetails, unknown>,
  ];
}

function cellClass(columnId: string) {
  if (columnId === "status") return "h-12 pl-6 pr-3 align-middle whitespace-nowrap";
  if (columnId === "name") return "h-12 px-4 align-middle text-left text-foreground font-medium whitespace-nowrap";
  if (columnId === "category") return "h-12 px-4 align-middle text-left text-foreground/80 font-medium whitespace-nowrap";
  if (columnId === "account" || columnId === "frequency")
    return "h-12 px-4 align-middle text-left text-[14px] text-muted-foreground font-medium whitespace-nowrap";
  if (columnId === "nextDate") return "h-12 px-4 align-middle text-left text-[14px] text-muted-foreground tabular-nums font-medium whitespace-nowrap";
  if (columnId === "amount") return "h-12 pl-3 pr-6 align-middle text-right tabular-nums font-medium whitespace-nowrap";
  if (columnId === "actions") return "h-12 px-1 align-middle whitespace-nowrap";
  return "h-12 px-4 align-middle text-left font-medium whitespace-nowrap";
}

function headerClass(columnId: string) {
  if (columnId === "status") return "h-12 pl-6 pr-3 text-left align-middle w-[100px]";
  if (columnId === "nextDate") return "h-12 px-4 text-left align-middle w-[120px]";
  if (columnId === "amount") return "h-12 pl-3 pr-6 text-right align-middle w-[120px]";
  if (columnId === "actions") return "h-12 align-middle w-[48px]";
  return "h-12 px-4 text-left align-middle";
}

export function ScheduleTable({
  schedules,
  accounts,
  categories,
  categoryGroups,
}: ScheduleTableProps) {
  // Open state is separate from the schedule so the dialog keeps rendering it
  // through its exit animation — nulling the schedule on close flipped the
  // closing dialog to the empty "Add schedule" form mid-fade.
  const [editOpen, setEditOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] =
    useState<ScheduledTransactionWithDetails | null>(null);
  const [emptyDialogOpen, setEmptyDialogOpen] = useState(false);
  // The row just closed from the edit dialog flashes once so you can see
  // which one you changed (the dialog covered it the whole time).
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 700);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const columns = useMemo(() => buildColumns(), []);

  const table = useReactTable({
    data: schedules,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false,
    getRowId: (row) => row.id,
  });

  return (
    <div className="flex-1 overflow-auto bg-card">
      <table className="w-full" aria-label="Scheduled transactions">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className={tableHeaderRow}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} scope="col" className={headerClass(header.column.id)}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <ScheduleRowRenderer
              key={row.id}
              row={row}
              onEdit={(s) => {
                setEditingSchedule(s);
                setEditOpen(true);
              }}
              isOpen={editOpen && editingSchedule?.id === row.id}
              flash={flashId === row.id}
            />
          ))}
        </tbody>
      </table>

      {schedules.length === 0 && (
        <>
          <EmptyState
            icon={CalendarClock}
            message="Set up your recurring bills and income to stay on track."
            primaryAction={{ label: "Add schedule", onClick: () => setEmptyDialogOpen(true) }}
          />
          <ScheduleDialog
            open={emptyDialogOpen}
            onOpenChange={setEmptyDialogOpen}
            accounts={accounts}
            categories={categories}
            categoryGroups={categoryGroups}
          />
        </>
      )}

      <ScheduleDialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (editingSchedule) setFlashId(editingSchedule.id);
            setEditOpen(false);
          }
        }}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        schedule={editingSchedule}
      />
    </div>
  );
}

function ScheduleRowRenderer({
  row,
  onEdit,
  isOpen,
  flash,
}: {
  row: Row<ScheduledTransactionWithDetails>;
  onEdit: (s: ScheduledTransactionWithDetails) => void;
  isOpen: boolean;
  flash: boolean;
}) {
  const amount = Number(row.original.amount);

  return (
    <tr
      onClick={() => onEdit(row.original)}
      data-flash={flash ? "a" : undefined}
      className={cn(
        "text-[15px] transition-colors group cursor-pointer border-b border-border/40 bg-card",
        "hover:bg-accent/30",
        isOpen && OPEN_TABLE_ROW_CLASS
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          className={cn(
            cellClass(cell.column.id),
            cell.column.id === "amount" &&
              (amount > 0 ? "text-positive" : amount < 0 ? "text-negative" : "text-foreground")
          )}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

function StatusBadge({ status }: { status: ScheduleStatus }) {
  const props = getStatusProps(status);
  const Icon = statusIcon(status);

  return (
    <Badge intent={props.intent}>
      <Icon className="h-3 w-3" />
      {props.label}
    </Badge>
  );
}

function statusIcon(status: ScheduleStatus) {
  switch (status) {
    case "missed":
      return AlertTriangle;
    case "due":
      return AlertTriangle;
    case "upcoming":
      return Calendar;
    case "paid":
      return CircleCheck;
    case "completed":
      return Star;
    case "scheduled":
      return Clock;
  }
}

function ScheduleActionsCell({
  schedule,
}: {
  schedule: ScheduledTransactionWithDetails;
}) {
  const [, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { toast } = useToast();
  const undoRedo = useUndoRedo();
  const status = getScheduleStatus(schedule, schedule.has_paid_transaction);
  const isRecurring = schedule.frequency !== "once";
  const scheduleLabel = schedule.name || schedule.payee || "this schedule";

  // `success` is optional because most of these actions change on-row state the
  // user is already looking at. Only posting needs one — see the call sites.
  const handleAction = (
    action: () => Promise<void>,
    failure: string,
    success?: string
  ) => {
    startTransition(async () => {
      try {
        await action();
        // Toasted only after the write lands. Announcing it alongside the await
        // would report a post that can still reject.
        if (success) toast({ message: success });
      } catch {
        toast({ message: failure, variant: "error", duration: 2500 });
      }
    });
  };

  const handleDelete = () => {
    void (async () => {
      try {
        // `snapshot` is reassigned by redo and re-read by undo. Restoring a
        // stale capture would resurrect an old next_date: if the schedule
        // posted between an undo and a redo, the redo's DELETE nulls that
        // transaction's schedule_id (ON DELETE SET NULL), so postDueSchedules'
        // NOT EXISTS guard can no longer see it — and a stale next_date would
        // post the same occurrence a second time.
        const captured = await deleteScheduleWithSnapshot(schedule.id);
        if (!captured) return;
        let snapshot = captured;
        const entryId = undoRedo.push({
          label: `Delete "${scheduleLabel}"`,
          forward: async () => {
            const fresh = await deleteScheduleWithSnapshot(snapshot.id);
            if (fresh) snapshot = fresh;
          },
          backward: async () => {
            const restored = await restoreScheduleSnapshot(snapshot);
            // INSERT OR IGNORE swallows every constraint failure, not just a
            // PK collision — if the schedule's category was hard-deleted in
            // the meantime, the FK fails and the restore is a silent no-op.
            // Say so rather than letting the undo look like it worked.
            if (!restored) {
              toast({
                message: `Could not restore "${scheduleLabel}"`,
                variant: "error",
                duration: 2500,
              });
            }
          },
        });
        toast({
          message: `Deleted "${scheduleLabel}"`,
          action: { label: "Undo", onClick: () => undoRedo.undoEntry(entryId) },
        });
      } catch {
        toast({
          message: "Could not delete the schedule — try again",
          variant: "error",
          duration: 2500,
        });
      }
    })();
  };

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        aria-label={`Options for ${scheduleLabel}`}
        // Hover-revealed, but also shown on keyboard focus and while open so
        // tabbing to it doesn't land on an invisible button.
        className="h-7 w-7 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 hover:bg-accent/30 transition-all"
      >
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="whitespace-nowrap">
        {!schedule.completed && status !== "paid" && (
          <>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                // The transaction and the balance it moves both live on other
                // pages, so the status badge flipping to Paid is not an
                // acknowledgement that money moved. Name the schedule rather
                // than the amount — a toast is not a privacy-masked surface.
                handleAction(
                  () => postScheduleTransaction(schedule.id),
                  "Could not post the transaction — try again",
                  `Posted "${scheduleLabel}"`
                );
              }}
            >
              Post transaction
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleAction(
                  () => postScheduleTransaction(schedule.id, true),
                  "Could not post the transaction — try again",
                  // Distinguishable after the fact from the line above, which
                  // posts to the scheduled date.
                  `Posted "${scheduleLabel}" today`
                );
              }}
            >
              Post transaction today
            </DropdownMenuItem>
          </>
        )}
        {!schedule.completed && isRecurring && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              handleAction(
                () => skipScheduleDate(schedule.id),
                "Could not skip the next date — try again"
              );
            }}
          >
            Skip next date
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {schedule.completed ? (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              handleAction(
                () => restartSchedule(schedule.id),
                "Could not restart the schedule — try again"
              );
            }}
          >
            Restart
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              handleAction(
                () => completeSchedule(schedule.id),
                "Could not complete the schedule — try again"
              );
            }}
          >
            Complete
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteOpen(true);
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    {/* The row is clickable (onEdit); ConfirmDialog stops its own propagation
        so Delete/Cancel don't also open the edit modal. */}
    <ConfirmDialog
      open={deleteOpen}
      onOpenChange={setDeleteOpen}
      title={`Delete "${scheduleLabel}"?`}
      description={
        isRecurring
          ? "This recurring schedule will stop posting. Transactions it already posted are kept, and you can undo this."
          : "Transactions it already posted are kept, and you can undo this."
      }
      onConfirm={handleDelete}
    />
    </>
  );
}
