"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type Header,
  type Row,
} from "@tanstack/react-table";
import { cn, tableHeaderRow } from "@/lib/utils";
import { CHECKED_TABLE_ROW_CLASS } from "@/lib/row-classes";
import { TruncatedText as TruncatedCell } from "@/components/shared/truncated-text";
import { clientId } from "@/lib/client-id";
import { formatShortDate, formatMonthYear } from "@/lib/format";
import { Currency } from "@/components/shared/currency";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { updateTransaction, getSplitsForTransaction } from "@/app/(app)/transactions/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  Lock,
  Smartphone,
  Unlock,
  Wallet,
  XCircle,
  XIcon,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TransactionDialog } from "./transaction-dialog";
import { DateInput } from "@/components/shared/date-input";
import { PayeeCombobox, type PayeeOption } from "@/components/shared/payee-combobox";
import { CategoryCombobox } from "@/components/shared/category-combobox";
import { AccountCombobox } from "@/components/shared/account-combobox";
import { SelectCheckbox } from "@/components/budget/select-checkbox";
import type { TransactionWithDetails, TransactionSplitWithCategory } from "@/lib/types";
import { STARTING_BALANCE_CATEGORY_ID, READY_TO_ASSIGN_CATEGORY_ID } from "@/lib/db-constants";
import { roundCents } from "@/lib/db-utils";
import type { SplitDraftItem, SplitDraftState } from "./transactions-client";
import { autoDistributeSplits, splitRemainingAmount } from "@/lib/split-math";
import type { RowData } from "@tanstack/react-table";
import { FEATURES } from "@/lib/features";
import { Minus, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransactionDraft = {
  date: string;
  payee: string;
  memo: string;
  amount: number;
  category_id: string | null;
  account_id: string;
};

type TransactionTableProps = {
  transactions: TransactionWithDetails[];
  // includes tracking accounts (260517-vxf) — is_budget_account is not used
  // as a picker filter; the field stays on the row shape for downstream uses.
  accounts: { id: string; name: string; type: string; is_budget_account: boolean }[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  payees: PayeeOption[];
  defaultAccountId?: string;
  editingRowId: string | null;
  /** Row just saved from inline edit — flashes once. */
  flashRowId?: string | null;
  /** A filter/search navigation is in flight — rows on screen are stale. */
  isRefreshing?: boolean;
  draft: TransactionDraft | null;
  setDraft: (draft: TransactionDraft | null) => void;
  startEditing: (row: TransactionWithDetails) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
  approveEdit?: () => void;
  splitDraft: SplitDraftState | null;
  setSplitDraft: (draft: SplitDraftState | null) => void;
  onEnterSplitMode: () => void;
  onExitSplitMode: (categoryId: string) => void;
  rowSelection: RowSelectionState;
  onRowSelectionChange: (selection: RowSelectionState | ((prev: RowSelectionState) => RowSelectionState)) => void;
  deleteWithUndo?: (id: string) => void | Promise<void>;
  // Transactions hidden by the active filter set, including the implicit
  // "default to current month" filter that lives outside URL params. Used by
  // the empty state to distinguish "truly empty" from "filtered to nothing".
  hiddenCount?: number;
  // Clears explicit URL filters AND the implicit default range (sets
  // range=all when the route's default is non-empty). Use this instead of
  // a local searchParams reset so "View all" works on bare-URL pages.
  onResetAllFilters?: () => void;
  // First month-key of the route's implicit default range (e.g. "2026-06"),
  // used to label the empty state when no explicit filters are set.
  defaultRangeStart?: string | null;
};

// TanStack TableMeta augmentation for type-safe meta access in cell renderers
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    editingRowId?: string | null;
    draft?: TransactionDraft | null;
    setDraft?: (draft: TransactionDraft | null) => void;
    startEditing?: (row: TransactionWithDetails) => void;
    commitEdit?: () => void;
    cancelEdit?: () => void;
    onEnterSplitMode?: () => void;
    onExitSplitMode?: (categoryId: string) => void;
    splitDraft?: SplitDraftState | null;
    expandedSplits?: Set<string>;
    toggleSplitExpand?: (id: string) => void;
    payees?: PayeeOption[];
    categories?: { id: string; name: string; category_group_id: string }[];
    categoryGroups?: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
    accounts?: { id: string; name: string; type: string; is_budget_account: boolean }[];
    deleteWithUndo?: (id: string) => void | Promise<void>;
    handleApprovedCheckboxClick?: (
      txnId: string,
      txnIndex: number,
      event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }
    ) => void;
  }
}

// ---------------------------------------------------------------------------
// Column helper
// ---------------------------------------------------------------------------

const columnHelper = createColumnHelper<TransactionWithDetails>();

// ---------------------------------------------------------------------------
// Inline action cells
// ---------------------------------------------------------------------------

function ApprovalCell({
  txn,
  deleteWithUndo,
}: {
  txn: TransactionWithDetails;
  deleteWithUndo?: (id: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center justify-center cursor-pointer"
      >
        <CheckCircle2
          className={cn(
            "h-3.5 w-3.5",
            txn.approved
              ? "text-positive/60"
              : "text-muted-foreground/20 hover:text-muted-foreground/40"
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-1 flex flex-col gap-0.5"
        side="bottom"
        align="start"
      >
        <button
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-accent/30 transition-colors text-left"
          disabled={isPending}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            setIsPending(true);
            updateTransaction(txn.id, { approved: true }).finally(() =>
              setIsPending(false)
            );
          }}
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-positive" />
          Approve transaction
        </button>
        <button
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-accent/30 transition-colors text-left"
          disabled={isPending || !deleteWithUndo}
          onClick={(e) => {
            e.stopPropagation();
            if (!deleteWithUndo) return;
            setOpen(false);
            setIsPending(true);
            Promise.resolve(deleteWithUndo(txn.id)).finally(() =>
              setIsPending(false)
            );
          }}
        >
          <XCircle className="h-3.5 w-3.5 text-negative" />
          Reject transaction
        </button>
      </PopoverContent>
    </Popover>
  );
}

function ClearedCell({ txn }: { txn: TransactionWithDetails }) {
  const [isPending, setIsPending] = useState(false);

  return (
    <div className="flex justify-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsPending(true);
          updateTransaction(txn.id, { cleared: !txn.cleared }).finally(() =>
            setIsPending(false)
          );
        }}
        disabled={isPending}
        aria-label={txn.cleared ? "Mark as uncleared" : "Mark as cleared"}
        aria-pressed={txn.cleared}
        className="transition-colors"
      >
        {txn.cleared ? (
          <Lock className="h-3.5 w-3.5 text-positive/60" />
        ) : (
          <Unlock className="h-3.5 w-3.5 text-muted-foreground/20 hover:text-muted-foreground/40" />
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

// Max widths based on p95 content lengths (chars × ~8px + padding)
// Account p95: 11 chars, Payee p95: 23 chars, Category p95: 32 chars,
// Memo: short note (~28 chars typical)
// Account bumped to 180 so the inline editor's "Choose an account"
// placeholder (17 chars + chevron) fits without truncation.
const COL_MAX = { account: 180, payee: 220, category: 280, memo: 220 } as const;

// Compact class override shared by all inline editors
const inlineEditorClass =
  "h-10 w-full rounded border-none bg-white px-1 py-0 text-base outline-none ring-1 ring-primary/30 focus-visible:ring-2 focus-visible:ring-primary/50 dark:bg-input";

// ---------------------------------------------------------------------------
// Inline editor wrappers (used inside cell renderers when row is editing)
// ---------------------------------------------------------------------------

function InlineDateEditor({
  draft,
  setDraft,
}: {
  draft: TransactionDraft;
  setDraft: (d: TransactionDraft) => void;
}) {
  return (
    // Bleeds into the cell's px-4: the native date text plus the icon gutter
    // needs ~117px, more than the column leaves inside its padding.
    <div className="-mx-2" onClick={(e) => e.stopPropagation()}>
      <DateInput
        value={draft.date}
        onChange={(e) => setDraft({ ...draft, date: e.target.value })}
        className={cn(inlineEditorClass, "pr-7")}
      />
    </div>
  );
}

function InlineAccountEditor({
  draft,
  setDraft,
  accounts,
}: {
  draft: TransactionDraft;
  setDraft: (d: TransactionDraft) => void;
  accounts: { id: string; name: string; type: string; is_budget_account: boolean }[];
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <AccountCombobox
        value={draft.account_id}
        accounts={accounts}
        onChange={(id) => setDraft({ ...draft, account_id: id })}
        className={inlineEditorClass}
      />
    </div>
  );
}

function InlinePayeeEditor({
  draft,
  setDraft,
  payees,
}: {
  draft: TransactionDraft;
  setDraft: (d: TransactionDraft) => void;
  payees: PayeeOption[];
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <PayeeCombobox
        value={draft.payee}
        payees={payees}
        placeholder="Payee"
        onChange={(name, defaultCategoryId) => {
          const updates: Partial<TransactionDraft> = { payee: name };
          if (defaultCategoryId && !draft.category_id) {
            updates.category_id = defaultCategoryId;
          }
          setDraft({ ...draft, ...updates });
        }}
        className={inlineEditorClass}
      />
    </div>
  );
}

// Plain text input for the optional memo field. Modeled on
// InlinePayeeEditor's outer shell but without a combobox — memos are free-form
// notes, not selections from a list.
function InlineMemoEditor({
  draft,
  setDraft,
}: {
  draft: TransactionDraft;
  setDraft: (d: TransactionDraft) => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        placeholder="Memo"
        value={draft.memo}
        onChange={(e) => setDraft({ ...draft, memo: e.target.value })}
        className={inlineEditorClass}
      />
    </div>
  );
}

function InlineCategoryEditor({
  draft,
  setDraft,
  categories,
  categoryGroups,
  onSplit,
  placeholder,
  onOverrideChange,
}: {
  draft: TransactionDraft;
  setDraft: (d: TransactionDraft) => void;
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  onSplit?: () => void;
  placeholder?: string;
  onOverrideChange?: (id: string) => void;
}) {
  const grouped = categoryGroups
    .filter((g) => !g.is_income && !g.is_system)
    .map((group) => ({
      ...group,
      items: categories.filter((c) => c.category_group_id === group.id),
    }))
    .filter((g) => g.items.length > 0);

  const income = categoryGroups
    .filter((g) => g.is_income)
    .flatMap((g) => categories.filter((c) => c.category_group_id === g.id));

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <CategoryCombobox
        value={draft.category_id ?? ""}
        groupedCategories={grouped}
        incomeCategories={income}
        onChange={(id) => {
          if (onOverrideChange && id) {
            onOverrideChange(id);
          } else {
            setDraft({ ...draft, category_id: id || null });
          }
        }}
        onSplit={onSplit}
        placeholder={placeholder}
        className={inlineEditorClass}
      />
    </div>
  );
}

// Compute the initial visible string from the parent's numeric draft amount.
// Returns "" when the sign doesn't match this field or the amount is zero so
// the input renders as an empty placeholder. Otherwise returns the absolute
// value as a string with no superfluous trailing zeros — the local string
// state inside InlineAmountEditor preserves any zeros the user actually typed.
function initialDisplayString(amount: number, field: "outflow" | "inflow"): string {
  const isOutflow = field === "outflow";
  const showValue = isOutflow ? amount <= 0 : amount > 0;
  if (!showValue || amount === 0) return "";
  return String(roundCents(Math.abs(amount)));
}

function InlineAmountEditor({
  draft,
  setDraft,
  field,
}: {
  draft: TransactionDraft;
  setDraft: (d: TransactionDraft) => void;
  field: "outflow" | "inflow";
}) {
  const isOutflow = field === "outflow";
  const { hidden } = useAmountsHidden();

  // Local string state — the input is driven by what the user typed, NOT by
  // String(Math.abs(draft.amount)) which round-trips through parseFloat on
  // every render and eats trailing dots / trailing zeros (e.g. typing "1234."
  // would parse to 1234 and the dot would disappear before the next keystroke).
  const [localValue, setLocalValue] = useState<string>(() =>
    initialDisplayString(draft.amount, field)
  );

  // Re-sync local string FROM the parent ONLY when the parent's amount
  // diverges from what we'd parse locally — i.e. the parent is the source of
  // truth (a different row was loaded, an undo fired, etc.). Within rounding
  // tolerance the user is mid-edit and we keep the local string verbatim.
  useEffect(() => {
    const parsed = parseFloat(localValue) || 0;
    const target = Math.abs(draft.amount);
    if (Math.abs(parsed - target) > 0.005) {
      setLocalValue(initialDisplayString(draft.amount, field));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.amount, field]);

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        inputMode="decimal"
        placeholder={hidden ? "$••••••" : "0.00"}
        value={hidden ? "" : localValue}
        disabled={hidden}
        onChange={(e) => {
          // Strip non-numeric/non-dot, then collapse multiple dots to the first.
          let raw = e.target.value.replace(/[^0-9.]/g, "");
          const firstDot = raw.indexOf(".");
          if (firstDot !== -1) {
            raw =
              raw.slice(0, firstDot + 1) +
              raw.slice(firstDot + 1).replace(/\./g, "");
          }
          setLocalValue(raw);
          const num = parseFloat(raw) || 0;
          setDraft({ ...draft, amount: isOutflow ? -Math.abs(num) : Math.abs(num) });
        }}
        className={cn(inlineEditorClass, "text-right tabular-nums")}
      />
    </div>
  );
}

function EditActionRow({
  colSpan,
  onCancel,
  onConfirm,
  splitDraft,
  onAutoDistribute,
  onUpdateTotal,
}: {
  colSpan: number;
  onCancel: () => void;
  onConfirm: () => void;
  splitDraft?: SplitDraftState | null;
  onAutoDistribute?: () => void;
  onUpdateTotal?: () => void;
}) {
  const fmt = useMaskedCurrency();
  const [showMismatch, setShowMismatch] = useState(false);
  const hasSplit = !!splitDraft;
  const remaining = hasSplit ? splitRemainingAmount(splitDraft!) : 0;
  const isBalanced = !hasSplit || Math.round(remaining * 100) === 0;

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasSplit && !isBalanced) {
      setShowMismatch(true);
    } else {
      onConfirm();
    }
  };

  const splitSum = hasSplit ? splitDraft!.items.reduce((acc, item) => acc + item.amount, 0) : 0;

  return (
    <tr className="border-b border-border/40 bg-primary/8">
      <td colSpan={colSpan} className="p-0">
        <div className="flex items-center justify-end gap-2 px-4 py-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-sm"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-sm"
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
        {/* Split mismatch dialog */}
        {showMismatch && hasSplit && (
          <div className="mx-4 mb-2 relative rounded-2xl bg-popover ring-1 ring-foreground/5 shadow-lg p-4" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2"
              onClick={() => setShowMismatch(false)}
            >
              <XIcon aria-hidden="true" />
              <span className="sr-only">Close</span>
            </Button>
            <div className="flex flex-col gap-2">
              <h3 className="font-heading text-base leading-none font-extrabold">Something doesn&apos;t add up</h3>
              <p className="text-sm text-muted-foreground">
                The total is <span className="zero-amount">{fmt(splitDraft!.parentAmount)}</span>, but the splits add up to <span className="zero-amount">{fmt(splitSum)}</span>.
                How would you like to handle the unassigned <span className="zero-amount">{fmt(Math.abs(remaining))}</span>?
              </p>
            </div>
            <div className="-mx-4 -mb-4 mt-4 flex gap-2 rounded-b-xl border-t bg-muted/50 p-4 justify-end">
              <Button
                variant="outline"
                size="sm"
                className="text-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMismatch(false);
                }}
              >
                Adjust manually
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMismatch(false);
                  onUpdateTotal?.();
                }}
              >
                Update total
              </Button>
              <Button
                size="sm"
                className="text-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMismatch(false);
                  onAutoDistribute?.();
                }}
              >
                Auto-distribute
              </Button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Split helpers and sub-row component
// ---------------------------------------------------------------------------

// Split-line amount cell. Keeps local string state so a mid-edit decimal point
// survives — the same reason InlineAmountEditor exists. Round-tripping the
// numeric `item.amount` through parseFloat on every keystroke eats trailing
// dots/zeros (typing "40" then "." then "00" would collapse to 4000).
function SplitAmountInput({
  amount,
  field,
  onChangeNum,
}: {
  amount: number;
  field: "outflow" | "inflow";
  onChangeNum: (num: number) => void;
}) {
  const { hidden } = useAmountsHidden();
  const [localValue, setLocalValue] = useState<string>(() =>
    initialDisplayString(amount, field)
  );

  // Re-sync from the parent only when it diverges beyond rounding tolerance
  // (undo, auto-distribute, a different row loaded). Within tolerance the user
  // is mid-edit and we keep the local string verbatim.
  useEffect(() => {
    const parsed = parseFloat(localValue) || 0;
    const target = Math.abs(amount);
    if (Math.abs(parsed - target) > 0.005) {
      setLocalValue(initialDisplayString(amount, field));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, field]);

  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder={hidden ? "$••••••" : "0.00"}
      value={hidden ? "" : localValue}
      disabled={hidden}
      onChange={(e) => {
        // Strip non-numeric/non-dot, then collapse multiple dots to the first.
        let raw = e.target.value.replace(/[^0-9.]/g, "");
        const firstDot = raw.indexOf(".");
        if (firstDot !== -1) {
          raw =
            raw.slice(0, firstDot + 1) +
            raw.slice(firstDot + 1).replace(/\./g, "");
        }
        setLocalValue(raw);
        onChangeNum(parseFloat(raw) || 0);
      }}
      className={cn(inlineEditorClass, "text-right tabular-nums")}
    />
  );
}

function SplitSubRows({
  splitDraft,
  setSplitDraft,
  categories,
  categoryGroups,
  columnIds,
}: {
  splitDraft: SplitDraftState;
  setSplitDraft: (draft: SplitDraftState | null) => void;
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  columnIds: string[];
}) {
  const fmt = useMaskedCurrency();
  const grouped = categoryGroups
    .filter((g) => !g.is_income && !g.is_system)
    .map((group) => ({
      ...group,
      items: categories.filter((c) => c.category_group_id === group.id),
    }))
    .filter((g) => g.items.length > 0);

  const income = categoryGroups
    .filter((g) => g.is_income)
    .flatMap((g) => categories.filter((c) => c.category_group_id === g.id));

  const updateItem = (tempId: string, updates: Partial<SplitDraftItem>) => {
    setSplitDraft({
      ...splitDraft,
      items: splitDraft.items.map((item) =>
        item.tempId === tempId ? { ...item, ...updates } : item
      ),
    });
  };

  const removeItem = (tempId: string) => {
    if (splitDraft.items.length <= 1) return;
    setSplitDraft({
      ...splitDraft,
      items: splitDraft.items.filter((item) => item.tempId !== tempId),
    });
  };

  const addItem = () => {
    setSplitDraft({
      ...splitDraft,
      items: [
        ...splitDraft.items,
        { tempId: clientId(), category_id: "", amount: 0 },
      ],
    });
  };

  const remaining = splitRemainingAmount(splitDraft);
  const isBalanced = Math.round(remaining * 100) === 0;

  // Build a column-aware cell mapping for each split row.
  // We render real <td> cells matching the table's column structure.
  const renderSplitRow = (item: SplitDraftItem) => {
    return columnIds.map((colId) => {
      switch (colId) {
        case "select":
        case "date":
        case "account":
          return <td key={colId} className={cn("h-12", bodyCellClass(colId))} />;
        case "payee":
          return (
            <td key={colId} className={cn("h-12", bodyCellClass("payee"))}>
              <button
                type="button"
                disabled={splitDraft.items.length <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem(item.tempId);
                }}
                className={cn(
                  "inline-flex items-center gap-1 text-sm transition-colors",
                  splitDraft.items.length <= 1
                    ? "text-muted-foreground/20 cursor-not-allowed"
                    : "text-muted-foreground/60 hover:text-negative"
                )}
              >
                <Minus className="h-3 w-3" />
                Remove
              </button>
            </td>
          );
        case "category":
          return (
            <td key={colId} className={cn("h-12", bodyCellClass("category"))}>
              <div onClick={(e) => e.stopPropagation()}>
                <CategoryCombobox
                  value={item.category_id}
                  groupedCategories={grouped}
                  incomeCategories={income}
                  onChange={(id) => updateItem(item.tempId, { category_id: id })}
                  placeholder="Needs category"
                  className={cn(inlineEditorClass, !item.category_id && "ring-1 ring-warning/50")}
                />
              </div>
            </td>
          );
        case "outflow":
          return (
            <td key={colId} className={cn("h-12", bodyCellClass("outflow"))}>
              <div onClick={(e) => e.stopPropagation()}>
                <SplitAmountInput
                  amount={item.amount}
                  field="outflow"
                  onChangeNum={(num) =>
                    updateItem(item.tempId, { amount: num === 0 ? 0 : -Math.abs(num) })
                  }
                />
              </div>
            </td>
          );
        case "inflow":
          return (
            <td key={colId} className={cn("h-12", bodyCellClass("inflow"))}>
              <div onClick={(e) => e.stopPropagation()}>
                <SplitAmountInput
                  amount={item.amount}
                  field="inflow"
                  onChangeNum={(num) => updateItem(item.tempId, { amount: num })}
                />
              </div>
            </td>
          );
        default:
          // Cleared, delete, approved — empty cells
          return <td key={colId} className={cn("h-12", bodyCellClass(colId))} />;
      }
    });
  };

  return (
    <>
      {splitDraft.items.map((item) => (
        <tr key={item.tempId} className="border-b border-border/20 bg-primary/4">
          {renderSplitRow(item)}
        </tr>
      ))}
      {/* Add another split + remaining to assign — aligned to table columns */}
      <tr className="border-b border-border/20 bg-primary/4">
        {columnIds.map((colId) => {
          switch (colId) {
            case "payee":
              return (
                <td key={colId} className={cn("h-8", bodyCellClass("payee"))}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addItem();
                    }}
                    className="inline-flex items-center gap-1 text-sm text-foreground hover:text-foreground/70 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Add another split
                  </button>
                </td>
              );
            case "category":
              return (
                <td key={colId} className={cn("h-8 text-[15px]", bodyCellClass("category"))}>
                  <span className={cn("tabular-nums", isBalanced ? "text-positive" : "text-warning")}>
                    Remaining to assign:
                  </span>
                </td>
              );
            case "outflow":
              return (
                <td key={colId} className={cn("h-8 text-[15px]", bodyCellClass("outflow"))}>
                  <span className={cn("tabular-nums zero-amount", isBalanced ? "text-positive" : "text-warning")}>
                    {fmt(Math.abs(remaining < 0 ? remaining : 0))}
                  </span>
                </td>
              );
            case "inflow":
              return (
                <td key={colId} className={cn("h-8 text-[15px]", bodyCellClass("inflow"))}>
                  <span className={cn("tabular-nums zero-amount", isBalanced ? "text-positive" : "text-warning")}>
                    {fmt(remaining > 0 ? remaining : 0)}
                  </span>
                </td>
              );
            default:
              return <td key={colId} className={cn("h-8", bodyCellClass(colId))} />;
          }
        })}
      </tr>
    </>
  );
}

// Read-only split detail rows shown when a split parent is expanded.
// Clicks on these rows behave as if clicking the parent row (select/edit).
function SplitDetailRows({
  splits,
  columnIds,
  isParentSelected,
  onClickRow,
}: {
  splits: TransactionSplitWithCategory[];
  columnIds: string[];
  isParentSelected: boolean;
  onClickRow: (e: React.MouseEvent) => void;
}) {
  return (
    <>
      {splits.map((split) => {
        const amount = Number(split.amount);
        return (
          <tr
            key={split.id}
            onClick={onClickRow}
            className={cn(
              "text-[15px] cursor-pointer transition-colors group-hover/row:bg-accent/40 bg-card",
              "border-b border-border/40",
              isParentSelected && "bg-primary/5"
            )}
          >
            {columnIds.map((colId) => {
              switch (colId) {
                case "category":
                  return (
                    <td key={colId} className={cn("h-12", bodyCellClass("category"))}>
                      <div className="pl-4">
                        {split.category_id ? (
                          <TruncatedCell>{split.category_name ?? ""}</TruncatedCell>
                        ) : (
                          <Badge intent="warning" className="text-[15px] font-medium px-2.5 py-0.5">Uncategorized</Badge>
                        )}
                      </div>
                    </td>
                  );
                case "outflow":
                  return (
                    <td key={colId} className={cn("h-12", bodyCellClass("outflow"))}>
                      {amount < 0 ? <Currency amount={amount} colorize={false} /> : ""}
                    </td>
                  );
                case "inflow":
                  return (
                    <td key={colId} className={cn("h-12", bodyCellClass("inflow"))}>
                      {amount > 0 ? <Currency amount={amount} colorize={false} /> : ""}
                    </td>
                  );
                default:
                  return <td key={colId} className={cn("h-12", bodyCellClass(colId))} />;
              }
            })}
          </tr>
        );
      })}
    </>
  );
}

// Reserved "Category not needed" pill — rendered in both display and edit modes
// for credit-card starting-balance transactions (category_id =
// STARTING_BALANCE_CATEGORY_ID, seeded by migration 017). The pill is neutral
// (bg-muted/40 + text-muted-foreground + ring-border) so it doesn't masquerade
// as an action or a warning; locking it from edits conveys read-only without
// extra disabled-state styling.
function categoryNotNeededPill() {
  return (
    <span className="inline-flex items-center rounded-full pl-2 pr-2.5 py-0.5 font-medium bg-muted/40 text-muted-foreground ring-1 ring-border">
      Category not needed
    </span>
  );
}

function buildColumns(): ColumnDef<TransactionWithDetails, unknown>[] {
  const cols: ColumnDef<TransactionWithDetails, unknown>[] = [
    // Select checkbox
    columnHelper.display({
      id: "select",
      size: 48,
      header: ({ table }) => {
        const allSelected = table.getIsAllRowsSelected();
        const someSelected = table.getIsSomeRowsSelected();
        return (
          <SelectCheckbox
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            onClick={() => table.toggleAllRowsSelected()}
            ariaLabel="Select all transactions"
            className="transition-colors hover:bg-foreground/[0.06]"
          />
        );
      },
      cell: ({ row, table }) => {
        const meta = table.options.meta;
        return (
          <SelectCheckbox
            checked={row.getIsSelected()}
            onClick={(e) => {
              e.stopPropagation();
              const rows = table.getRowModel().rows;
              const currentIndex = rows.findIndex((r) => r.id === row.id);
              meta?.handleApprovedCheckboxClick?.(row.id, currentIndex, {
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
              });
            }}
            ariaLabel="Select transaction"
            className="transition-colors hover:bg-foreground/[0.06]"
          />
        );
      },
    }) as ColumnDef<TransactionWithDetails, unknown>,

    // Date
    columnHelper.accessor("date", {
      id: "date",
      // Fits the widest form ("Sep 30, 2025") + px-4 padding, and the inline
      // DateInput editor ("10/06/2026" + icon gutter) with its -mx-2 bleed.
      size: 140,
      header: "Date",
      cell: (info) => {
        const meta = info.table.options.meta;
        if (meta?.editingRowId === info.row.id && meta.draft && meta.setDraft) {
          return <InlineDateEditor draft={meta.draft} setDraft={meta.setDraft} />;
        }
        return <TruncatedCell>{formatShortDate(info.getValue())}</TruncatedCell>;
      },
      sortingFn: "text",
    }) as ColumnDef<TransactionWithDetails, unknown>,

    // Payee
    columnHelper.accessor("payee", {
      id: "payee",
      size: COL_MAX.payee,
      header: "Payee",
      cell: (info) => {
        const meta = info.table.options.meta;
        if (meta?.editingRowId === info.row.id && meta.draft && meta.setDraft && meta.payees) {
          return (
            <InlinePayeeEditor
              draft={meta.draft}
              setDraft={meta.setDraft}
              payees={meta.payees}
            />
          );
        }
        // Quiet provenance marker for rows added from /quick (migration 018
        // / SEED-014). Other sources (desktop / import / legacy NULL) render
        // unchanged to keep the default view quiet.
        if (info.row.original.source === "quick") {
          return (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Smartphone
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                      aria-label="Added from Quick"
                    />
                  }
                />
                <TooltipContent side="bottom" align="start">Added from Quick</TooltipContent>
              </Tooltip>
              <TruncatedCell>{info.getValue() || "—"}</TruncatedCell>
            </span>
          );
        }
        return <TruncatedCell>{info.getValue() || "—"}</TruncatedCell>;
      },
      sortingFn: "text",
    }) as ColumnDef<TransactionWithDetails, unknown>,

    // Category
    columnHelper.accessor("category_name", {
      id: "category",
      size: COL_MAX.category,
      header: "Category",
      cell: (info) => {
        const meta = info.table.options.meta;
        const txnRow = info.row.original;
        if (txnRow.transfer_account_id) {
          return (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <ArrowLeftRight className="h-[15px] w-[15px]" />
              Transfer
            </span>
          );
        }
        if (
          meta?.editingRowId === info.row.id &&
          meta.draft &&
          meta.setDraft &&
          meta.categories &&
          meta.categoryGroups
        ) {
          // Lock the cell for credit-card starting-balance transactions —
          // render the neutral "Category not needed" pill instead of a
          // combobox so other columns in the row can still be edited but the
          // category stays read-only.
          if (info.row.original.category_id === STARTING_BALANCE_CATEGORY_ID) {
            return categoryNotNeededPill();
          }
          // In split mode, show editable category dropdown — selecting a category exits split mode
          if (meta.splitDraft) {
            return (
              <InlineCategoryEditor
                draft={meta.draft}
                setDraft={meta.setDraft}
                categories={meta.categories}
                categoryGroups={meta.categoryGroups}
                onSplit={meta.onEnterSplitMode}
                placeholder="Split (Multiple Categories)..."
                onOverrideChange={(id) => meta.onExitSplitMode?.(id)}
              />
            );
          }
          return (
            <InlineCategoryEditor
              draft={meta.draft}
              setDraft={meta.setDraft}
              categories={meta.categories}
              categoryGroups={meta.categoryGroups}
              onSplit={meta.onEnterSplitMode}
            />
          );
        }
        // Display mode: show split chevron, category name, or uncategorized badge
        const txn = info.row.original;
        if (txn.is_split_parent) {
          const isExpanded = meta?.expandedSplits?.has(txn.id);
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                meta?.toggleSplitExpand?.(txn.id);
              }}
              className="inline-flex items-center gap-1 text-foreground/70 hover:text-foreground transition-colors -ml-4"
            >
              <ChevronRight
                className={cn(
                  "h-[15px] w-[15px] shrink-0 transition-transform duration-150",
                  isExpanded && "rotate-90"
                )}
              />
              <span>Split ({txn.split_count ?? 0} categories)</span>
            </button>
          );
        }
        if (txn.category_id === STARTING_BALANCE_CATEGORY_ID) {
          return categoryNotNeededPill();
        }
        if (txn.category_id === READY_TO_ASSIGN_CATEGORY_ID) {
          return (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Wallet className="h-[15px] w-[15px]" />
              {info.getValue() || "Ready to assign"}
            </span>
          );
        }
        const value = info.getValue();
        if (value) return <TruncatedCell>{value}</TruncatedCell>;
        return <Badge intent="warning" className="text-[15px] font-medium px-2.5 py-0.5">Uncategorized</Badge>;
      },
      sortingFn: "text",
    }) as ColumnDef<TransactionWithDetails, unknown>,

    // Account
    columnHelper.accessor("account_name", {
      id: "account",
      size: COL_MAX.account,
      header: "Account",
      cell: (info) => {
        const meta = info.table.options.meta;
        if (
          meta?.editingRowId === info.row.id &&
          meta.draft &&
          meta.setDraft &&
          meta.accounts
        ) {
          return (
            <InlineAccountEditor
              draft={meta.draft}
              setDraft={meta.setDraft}
              accounts={meta.accounts}
            />
          );
        }
        return <TruncatedCell>{info.getValue()}</TruncatedCell>;
      },
      sortingFn: "text",
    }) as ColumnDef<TransactionWithDetails, unknown>,

    // Memo — short freeform note. Sits between Account and Outflow;
    // display em-dash for null/empty matching Payee.
    columnHelper.accessor("memo", {
      id: "memo",
      size: COL_MAX.memo,
      header: "Memo",
      cell: (info) => {
        const meta = info.table.options.meta;
        if (meta?.editingRowId === info.row.id && meta.draft && meta.setDraft) {
          return <InlineMemoEditor draft={meta.draft} setDraft={meta.setDraft} />;
        }
        const value = info.getValue();
        const text = value ?? "";
        return (
          <span title={text || undefined} className="block">
            <TruncatedCell>{text || "—"}</TruncatedCell>
          </span>
        );
      },
      sortingFn: "text",
    }) as ColumnDef<TransactionWithDetails, unknown>,

    // Outflow
    columnHelper.accessor("amount", {
      id: "outflow",
      size: 100,
      header: "Outflow",
      cell: (info) => {
        const meta = info.table.options.meta;
        if (meta?.editingRowId === info.row.id && meta.draft && meta.setDraft) {
          return (
            <InlineAmountEditor draft={meta.draft} setDraft={meta.setDraft} field="outflow" />
          );
        }
        const amount = Number(info.getValue());
        if (amount >= 0) return "";
        return <Currency amount={amount} colorize={false} />;
      },
      sortingFn: "basic",
    }) as ColumnDef<TransactionWithDetails, unknown>,

    // Inflow
    columnHelper.accessor("amount", {
      id: "inflow",
      size: 100,
      header: "Inflow",
      sortingFn: "basic",
      cell: (info) => {
        const meta = info.table.options.meta;
        if (meta?.editingRowId === info.row.id && meta.draft && meta.setDraft) {
          return (
            <InlineAmountEditor draft={meta.draft} setDraft={meta.setDraft} field="inflow" />
          );
        }
        const amount = Number(info.getValue());
        if (amount <= 0) return "";
        return <Currency amount={amount} colorize={false} />;
      },
    }) as ColumnDef<TransactionWithDetails, unknown>,

  ];

  // Bank sync: approved indicator column (after select)
  if (FEATURES.BANK_SYNC) {
    cols.splice(1, 0, columnHelper.display({
      id: "approved",
      size: 40,
      enableSorting: false,
      header: () => <CheckCircle2 className="h-3.5 w-3.5 inline-block" />,
      cell: ({ row, table }) => (
        <ApprovalCell
          txn={row.original}
          deleteWithUndo={table.options.meta?.deleteWithUndo}
        />
      ),
    }) as ColumnDef<TransactionWithDetails, unknown>);
  }

  // Reconciliation: cleared status column (before delete)
  if (FEATURES.RECONCILIATION) {
    cols.splice(cols.length - 1, 0, columnHelper.display({
      id: "cleared",
      size: 40,
      enableSorting: false,
      header: () => <Lock className="h-3 w-3 inline-block" />,
      cell: ({ row }) => <ClearedCell txn={row.original} />,
    }) as ColumnDef<TransactionWithDetails, unknown>);
  }

  return cols;
}

// ---------------------------------------------------------------------------
// Sort indicator
// ---------------------------------------------------------------------------

function SortIndicator({ header }: { header: Header<TransactionWithDetails, unknown> }) {
  const sorted = header.column.getIsSorted();
  if (!sorted) return null;
  return sorted === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 ml-0.5" strokeWidth={3} />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 ml-0.5" strokeWidth={3} />
  );
}

// ---------------------------------------------------------------------------
// Column header className helpers
// ---------------------------------------------------------------------------

// All cells get vertical centering and consistent horizontal padding
// Icon columns: equal padding, centered content
// Text columns: px-3, left-aligned
// Numeric columns: px-3, right-aligned
const cellBase = "align-middle";
const iconCell = cn(cellBase, "px-3 text-center leading-none");

// Icon columns: fixed width, never change
const fixedIcon = "w-[48px] min-w-[48px] max-w-[48px]";

function headerCellClass(columnId: string): string {
  switch (columnId) {
    case "select":
      return cn(iconCell, fixedIcon);
    case "approved":
      return cn(iconCell, fixedIcon);
    case "date":
      return cn(cellBase, "px-4 text-left");
    case "account":
      return cn(cellBase, "px-4 text-left");
    case "payee":
      return cn(cellBase, "px-4 text-left");
    case "category":
      return cn(cellBase, "px-4 text-left");
    case "memo":
      return cn(cellBase, "px-4 text-left");
    case "outflow":
      return cn(cellBase, "px-3 text-right");
    case "inflow":
      return cn(cellBase, "pl-3 pr-6 text-right");
    case "cleared":
      return cn(iconCell, fixedIcon);
    default:
      return cn(cellBase, "px-4 text-left");
  }
}

function bodyCellClass(columnId: string): string {
  switch (columnId) {
    case "select":
      return cn(iconCell, fixedIcon);
    case "approved":
      return cn(iconCell, fixedIcon);
    case "date":
      return cn(cellBase, "px-4 text-left text-[14px] text-muted-foreground font-medium");
    case "account":
      return cn(cellBase, "px-4 text-left text-[14px] text-muted-foreground font-medium");
    case "payee":
      return cn(cellBase, "px-4 text-left text-foreground font-medium");
    case "category":
      return cn(cellBase, "px-4 text-left text-foreground/80 font-medium");
    case "memo":
      return cn(cellBase, "px-4 text-left text-[14px] text-muted-foreground font-medium");
    case "outflow":
      return cn(cellBase, "px-3 text-right tabular-nums text-negative font-medium");
    case "inflow":
      return cn(cellBase, "pl-3 pr-6 text-right tabular-nums text-positive font-medium");
    case "cleared":
      return cn(iconCell, fixedIcon);
    default:
      return cn(cellBase, "px-4 text-left");
  }
}


// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const columns = buildColumns();

// Map between TanStack column IDs and server-side sort keys
const columnToServerSort: Record<string, string> = {
  date: "date",
  account: "account",
  payee: "payee",
  category: "category",
  outflow: "amount",
};
const serverToColumnSort: Record<string, string> = {
  date: "date",
  account: "account",
  payee: "payee",
  category: "category",
  amount: "outflow",
};

export function TransactionTable({
  transactions,
  accounts,
  categories,
  categoryGroups,
  payees,
  defaultAccountId,
  editingRowId,
  flashRowId,
  isRefreshing = false,
  draft,
  setDraft,
  startEditing,
  commitEdit,
  cancelEdit,
  approveEdit,
  splitDraft,
  setSplitDraft,
  onEnterSplitMode,
  onExitSplitMode,
  rowSelection,
  onRowSelectionChange,
  deleteWithUndo,
  hiddenCount = 0,
  onResetAllFilters,
  defaultRangeStart,
}: TransactionTableProps) {
  const [editingTxn, setEditingTxn] = useState<TransactionWithDetails | null>(null);
  const [emptyStateDialogOpen, setEmptyStateDialogOpen] = useState(false);
  const [pendingCollapsed, setPendingCollapsed] = useState(false); // Used when BANK_SYNC enabled
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleDialogChange = useCallback((open: boolean) => {
    if (!open) setEditingTxn(null);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Section-tagged anchor: shift-range only spans rows within the same section
  // (approved vs. pending). Switching sections resets the anchor implicitly.
  const selectionAnchorRef = useRef<{
    section: "approved" | "pending" | null;
    index: number | null;
  }>({ section: null, index: null });
  const [isScrolled, setIsScrolled] = useState(false);

  type ClickContext = {
    txnId: string;
    txnIndex: number;
    section: "approved" | "pending";
    sectionRowIds: string[];
    mode: "row-body" | "first-column";
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
  };

  // Unified selection click handler. Returns:
  //   "edit"     — caller should startEditing(this row)
  //   "selected" — selection was mutated; caller does nothing
  // Find the sibling transfer leg for a given txn id within the loaded
  // transactions list. Mirrors the server's findTransferSibling invariants
  // (swapped accounts, mirrored amount, same date). Returns null if no
  // transfer partner is in view (260518-fqy #4 visual).
  //
  // Reads from `transactions` rather than `tableRows` because the latter is
  // declared later in the file; FEATURES.BANK_SYNC stays off project-wide
  // so the two collections are equivalent today.
  const siblingIdFor = useCallback(
    (txnId: string): string | null => {
      const txn = transactions.find((t) => t.id === txnId);
      if (!txn || !txn.transfer_account_id) return null;
      const sibling = transactions.find(
        (t) =>
          t.id !== txn.id &&
          t.account_id === txn.transfer_account_id &&
          t.transfer_account_id === txn.account_id &&
          Number(t.amount) === -Number(txn.amount) &&
          t.date === txn.date
      );
      return sibling?.id ?? null;
    },
    [transactions]
  );

  const handleRowSelectClick = useCallback(
    (ctx: ClickContext): "edit" | "selected" => {
      const additive = ctx.metaKey || ctx.ctrlKey;
      const anchor = selectionAnchorRef.current;
      const anchorIndex =
        anchor.section === ctx.section ? anchor.index : null;

      const applyRange = (from: number, to: number) => {
        const start = Math.min(from, to);
        const end = Math.max(from, to);
        const range: Record<string, boolean> = {};
        for (let i = start; i <= end; i++) range[ctx.sectionRowIds[i]] = true;
        onRowSelectionChange((prev) => ({ ...prev, ...range }));
      };

      const setAnchor = () => {
        selectionAnchorRef.current = {
          section: ctx.section,
          index: ctx.txnIndex,
        };
      };

      // Mirror a per-row toggle onto the transfer sibling so the bulk-select
      // visual matches the server-side cascade — selecting one leg of a
      // transfer reveals the other leg's checkbox as also selected, and
      // unselecting one drops both. Skips itself when no sibling is in view.
      const toggleWithSibling = (id: string) => {
        const siblingId = siblingIdFor(id);
        onRowSelectionChange((prev) => {
          const next = { ...prev };
          const turningOn = !next[id];
          if (turningOn) {
            next[id] = true;
            if (siblingId) next[siblingId] = true;
          } else {
            delete next[id];
            if (siblingId) delete next[siblingId];
          }
          return next;
        });
      };

      // Shift: range select, never edit
      if (ctx.shiftKey && anchorIndex !== null) {
        applyRange(anchorIndex, ctx.txnIndex);
        setAnchor();
        return "selected";
      }

      // Cmd/Ctrl: toggle this row, preserve others
      if (additive) {
        toggleWithSibling(ctx.txnId);
        setAnchor();
        return "selected";
      }

      // First-column click (no modifier): toggle this row, preserve others.
      // The select column is a "selection gutter" — clicks there are always
      // additive, never replace the existing batch. Range-extend is reserved
      // for shift (handled above).
      if (ctx.mode === "first-column") {
        toggleWithSibling(ctx.txnId);
        setAnchor();
        return "selected";
      }

      // Row body, no modifier
      const isSelected = !!rowSelection[ctx.txnId];
      if (isSelected) {
        // Preserve other selections; caller should enter edit
        return "edit";
      }
      const siblingId = siblingIdFor(ctx.txnId);
      const next: RowSelectionState = { [ctx.txnId]: true };
      if (siblingId) next[siblingId] = true;
      onRowSelectionChange(next);
      setAnchor();
      return "selected";
    },
    [onRowSelectionChange, rowSelection, siblingIdFor]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setIsScrolled(el.scrollTop > 0);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Keep the viewport still while editing. When you type into an editing input
  // that's scrolled out of view (e.g. you scrolled the list mid-edit), the
  // browser's native caret-follow yanks the page to the row. We can't opt out
  // of that scroll, so we record the position on `beforeinput` and restore it
  // on the next frame — fires only while typing, never fights wheel/trackpad.
  useEffect(() => {
    if (!editingRowId) return;
    const el = scrollRef.current;
    if (!el) return;
    const onBeforeInput = () => {
      const anchored = el.scrollTop;
      requestAnimationFrame(() => {
        if (el.scrollTop !== anchored) el.scrollTop = anchored;
      });
    };
    el.addEventListener("beforeinput", onBeforeInput, true);
    return () => el.removeEventListener("beforeinput", onBeforeInput, true);
  }, [editingRowId]);

  // Track which column was clicked so we can focus the right editor
  const clickedColumnRef = useRef<string | null>(null);

  // Expanded split parents — tracks which split transactions are showing detail rows
  const [expandedSplits, setExpandedSplits] = useState<Set<string>>(new Set());
  const splitCacheRef = useRef<Map<string, TransactionSplitWithCategory[]>>(new Map());

  // Invalidate split cache when transactions change (server revalidation after edits).
  // Expanded splits will re-fetch lazily on next render via the ref check below.
  const prevTransactionsRef = useRef(transactions);
  if (prevTransactionsRef.current !== transactions) {
    prevTransactionsRef.current = transactions;
    splitCacheRef.current.clear();
  }

  // Re-fetch any expanded splits that lost their cache
  useEffect(() => {
    let cancelled = false;
    expandedSplits.forEach((id) => {
      if (!splitCacheRef.current.has(id)) {
        getSplitsForTransaction(id).then((splits) => {
          if (cancelled) return;
          splitCacheRef.current.set(id, splits);
          setExpandedSplits((s) => new Set(s));
        });
      }
    });
    return () => { cancelled = true; };
  }, [expandedSplits, transactions]);

  const toggleSplitExpand = useCallback((id: string) => {
    setExpandedSplits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    // Fetch splits outside the state updater to avoid triggering Router updates during render
    if (!splitCacheRef.current.has(id)) {
      getSplitsForTransaction(id).then((splits) => {
        splitCacheRef.current.set(id, splits);
        setExpandedSplits((s) => new Set(s));
      });
    }
  }, []);

  // Auto-focus the correct input when editing starts
  useEffect(() => {
    if (!editingRowId) return;
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-row-id="${editingRowId}"]`);
      if (!row) return;

      // Try to focus the input in the clicked column first
      const col = clickedColumnRef.current;
      if (col) {
        const cell = row.querySelector(`[data-col="${col}"]`);
        const input = cell?.querySelector("input, [role='combobox']") as HTMLElement | null;
        if (input) {
          input.focus({ preventScroll: true });
          clickedColumnRef.current = null;
          return;
        }
      }

      // Fallback: focus the first editable input
      const firstInput = row?.querySelector("input, [role='combobox']") as HTMLElement | null;
      firstInput?.focus({ preventScroll: true });
      clickedColumnRef.current = null;
    });
  }, [editingRowId]);

  // Commit edit or clear selection on click outside the table
  const hasSelection = Object.keys(rowSelection).length > 0;
  useEffect(() => {
    if (!editingRowId && !hasSelection) return;
    const handleClickOutside = (e: MouseEvent) => {
      const container = scrollRef.current;
      if (!container) return;
      // Ignore clicks on the selection toolbar (fixed-positioned)
      const target = e.target as HTMLElement;
      if (target.closest("[data-selection-toolbar]")) return;
      if (target.closest("[data-slot='dialog-overlay']") || target.closest("[data-slot='dialog-content']")) return;
      if (target.closest("[data-slot='dropdown-menu-content']") || target.closest("[data-slot='dropdown-menu-sub-content']")) return;
      if (!container.contains(target)) {
        if (editingRowId) commitEdit();
        if (hasSelection) onRowSelectionChange({});
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [editingRowId, hasSelection, commitEdit, onRowSelectionChange]);

  // Global Escape: clear the row selection regardless of focus. Skipped when
  // editing — the row's own keyDown handles Esc-to-cancel during edit. Also
  // skipped when an open menu/dialog is going to consume the Escape itself.
  useEffect(() => {
    if (editingRowId || !hasSelection) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Let dialogs/menus eat their own Escape first.
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-slot='dialog-content']")) return;
      if (target?.closest("[data-slot='dropdown-menu-content']")) return;
      if (target?.closest("[data-slot='dropdown-menu-sub-content']")) return;
      if (target?.closest("[data-slot='popover-content']")) return;
      e.preventDefault();
      onRowSelectionChange({});
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editingRowId, hasSelection, onRowSelectionChange]);

  // Approved-section id list — used by the approved-checkbox meta handler for
  // range-select. Pending/approved row *rendering* is split from the table's
  // own row model below (see pendingModelRows / approvedModelRows).
  const tableRows = useMemo(() => transactions.filter((t) => t.approved), [transactions]);

  // ---------------------------------------------------------------------------
  // Sorting — synced with URL search params (server-side sorting)
  // ---------------------------------------------------------------------------

  const urlSortBy = searchParams.get("sortBy");
  const urlSortDir = searchParams.get("sortDir");

  const sorting: SortingState = useMemo(() => {
    // Mirror the server's implicit default (date DESC, created_at DESC) so the
    // Date header shows its arrow before the user has touched any sort control.
    if (!urlSortBy) return [{ id: "date", desc: true }];
    const columnId = serverToColumnSort[urlSortBy] ?? urlSortBy;
    return [{ id: columnId, desc: urlSortDir !== "asc" }];
  }, [urlSortBy, urlSortDir]);

  const handleSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const params = new URLSearchParams(searchParams.toString());
      if (next.length > 0) {
        const serverKey = columnToServerSort[next[0].id] ?? next[0].id;
        params.set("sortBy", serverKey);
        params.set("sortDir", next[0].desc ? "desc" : "asc");
      } else {
        params.delete("sortBy");
        params.delete("sortDir");
      }
      router.push(`?${params.toString()}`);
    },
    [sorting, searchParams, router]
  );

  // ---------------------------------------------------------------------------
  // Selection — lifted to parent, supports select-then-edit pattern
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Table instance — approved rows only (pending rendered separately)
  // ---------------------------------------------------------------------------

  const coreRowModel = useRef(getCoreRowModel<TransactionWithDetails>());
  const getRowId = useCallback((row: TransactionWithDetails) => row.id, []);

  const table = useReactTable({
    // Feed ALL rows through the table so pending and approved rows render via
    // the same flexRender/column-def path — the two sections can't drift.
    // manualSorting keeps input order, so the row model mirrors `transactions`;
    // we split it into sections below by `approved`.
    data: transactions,
    columns,
    state: {
      sorting,
      rowSelection,
    },
    meta: {
      editingRowId,
      draft,
      setDraft,
      startEditing,
      commitEdit,
      cancelEdit,
      onEnterSplitMode,
      onExitSplitMode,
      splitDraft,
      expandedSplits,
      toggleSplitExpand,
      payees,
      categories,
      categoryGroups,
      accounts,
      deleteWithUndo,
      handleApprovedCheckboxClick: (txnId, txnIndex, event) => {
        handleRowSelectClick({
          txnId,
          txnIndex,
          section: "approved",
          sectionRowIds: tableRows.map((t) => t.id),
          mode: "first-column",
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        });
      },
    },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: onRowSelectionChange,
    getCoreRowModel: coreRowModel.current,
    getRowId,
    enableSorting: true,
    // Two-state cycle (asc ↔ desc) instead of TanStack's default three-state
    // (asc → desc → unsorted). The unsorted state never landed clean with
    // manualSorting + URL-derived state — clicking from asc was skipping
    // desc and going straight to unsorted. Two-state is also the UX users
    // expect from spreadsheet-like tables.
    enableSortingRemoval: false,
    enableRowSelection: true,
    enableColumnResizing: false,
    manualSorting: true, // Server-side sorting via URL
  });

  const headerGroups = table.getHeaderGroups();
  const modelRows = table.getRowModel().rows;
  // Split the single row model into sections by `approved`. This is data-driven,
  // NOT gated on FEATURES.BANK_SYNC: any unapproved row (e.g. a not-yet-posted
  // line inserted by the import-txns skill) surfaces in the pending section
  // without turning on the full bank-sync surface. Rows default to approved=1,
  // so with nothing pending the section is empty and approved holds everything.
  const pendingModelRows = useMemo(
    () => modelRows.filter((r) => !r.original.approved),
    [modelRows]
  );
  const approvedModelRows = useMemo(
    () => modelRows.filter((r) => r.original.approved),
    [modelRows]
  );
  const pendingSectionIds = useMemo(() => pendingModelRows.map((r) => r.id), [pendingModelRows]);
  const approvedSectionIds = useMemo(() => approvedModelRows.map((r) => r.id), [approvedModelRows]);
  const visibleColumnIds = useMemo(
    () => table.getVisibleLeafColumns().map((c) => c.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns]
  );

  // Shared row renderer — used by BOTH the pending and approved sections so
  // they render through the identical column-def/flexRender path (no drift).
  // `section` only tweaks selection wiring, dimming, and the edit-confirm verb
  // (editing a pending row approves it on save).
  const renderTxnRow = (
    row: Row<TransactionWithDetails>,
    rowIndex: number,
    section: "pending" | "approved",
    sectionRowIds: string[]
  ) => {
    const isEditing = editingRowId === row.id;
    const isSelected = row.getIsSelected();
    const hasExpandedSplits = !isEditing && row.original.is_split_parent && expandedSplits.has(row.id);
    const isPending = section === "pending";
    const confirmEdit = isPending ? (approveEdit ?? commitEdit) : commitEdit;
    return (
      <tbody key={row.id} className={cn(hasExpandedSplits && "group/row")}>
        <tr
          data-row-id={row.id}
          onMouseDown={(e) => {
            // Suppress the browser's shift-extend text selection on shift-click.
            if (e.shiftKey) e.preventDefault();
          }}
          onClick={(e) => {
            if (isEditing) return;
            if (editingRowId) {
              commitEdit();
              return;
            }
            const td = (e.target as HTMLElement).closest("td");
            const colId = td?.getAttribute("data-col") ?? null;
            // First-column clicks (including the gutter around the checkbox)
            // are selection-only — they never enter edit mode.
            const mode: "first-column" | "row-body" =
              colId === "select" ? "first-column" : "row-body";
            const verdict = handleRowSelectClick({
              txnId: row.id,
              txnIndex: rowIndex,
              section,
              sectionRowIds,
              mode,
              shiftKey: e.shiftKey,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
            });
            if (verdict === "edit") {
              clickedColumnRef.current = colId;
              startEditing(row.original);
            }
          }}
          onKeyDown={(e) => {
            if (isEditing) {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            } else if (isSelected && e.key === "Escape") {
              e.preventDefault();
              onRowSelectionChange({});
            }
          }}
          data-flash={flashRowId === row.id ? "a" : undefined}
          className={cn(
            "text-[15px] transition-colors group border-b border-border/40 cursor-pointer bg-card",
            isEditing
              ? "bg-primary/8 ring-1 ring-primary/20 border-b-0"
              : hasExpandedSplits
                ? "group-hover/row:bg-accent/30"
                : "hover:bg-accent/30",
            // Pending rows read as muted until approved.
            isPending && !isEditing && "text-foreground/35 [&_td]:!text-inherit",
            isSelected && !isEditing && CHECKED_TABLE_ROW_CLASS
          )}
        >
          {row.getVisibleCells().map((cell) => (
            <td
              key={cell.id}
              data-col={cell.column.id}
              className={cn("h-12", bodyCellClass(cell.column.id))}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          ))}
        </tr>
        {isEditing && splitDraft && (
          <SplitSubRows
            splitDraft={splitDraft}
            setSplitDraft={setSplitDraft}
            categories={categories}
            categoryGroups={categoryGroups}
            columnIds={visibleColumnIds}
          />
        )}
        {isEditing && (
          <EditActionRow
            colSpan={columns.length}
            onCancel={cancelEdit}
            onConfirm={confirmEdit}
            splitDraft={splitDraft}
            onAutoDistribute={splitDraft ? () => {
              setSplitDraft({ ...splitDraft, items: autoDistributeSplits(splitDraft) });
            } : undefined}
            onUpdateTotal={splitDraft ? () => {
              const splitSum = splitDraft.items.reduce((acc, item) => acc + item.amount, 0);
              setDraft(draft ? { ...draft, amount: splitSum } : null);
              setSplitDraft({ ...splitDraft, parentAmount: splitSum });
            } : undefined}
          />
        )}
        {/* Expanded split detail rows (read-only, non-editing) */}
        {!isEditing && row.original.is_split_parent && expandedSplits.has(row.id) && (
          <SplitDetailRows
            splits={splitCacheRef.current.get(row.id) ?? []}
            columnIds={visibleColumnIds}
            isParentSelected={isSelected}
            onClickRow={(e) => {
              if (editingRowId) {
                commitEdit();
                return;
              }
              const verdict = handleRowSelectClick({
                txnId: row.id,
                txnIndex: rowIndex,
                section,
                sectionRowIds,
                mode: "row-body",
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
              });
              if (verdict === "edit") {
                startEditing(row.original);
              }
            }}
          />
        )}
      </tbody>
    );
  };

  return (
    <div
      ref={scrollRef}
      aria-busy={isRefreshing || undefined}
      className={cn(
        "flex-1 overflow-auto bg-card transition-opacity duration-200",
        // Delayed so a fast navigation never flickers.
        isRefreshing && "opacity-50 delay-150"
      )}
    >
      {/* Single table — TanStack-powered */}
      <table className="w-full table-fixed" aria-label="Transactions">
        <thead>
          {headerGroups.map((headerGroup) => (
            <tr
              key={headerGroup.id}
              className={cn(
                tableHeaderRow,
                "transition-shadow",
                isScrolled && "shadow-[0_2px_4px_-1px_rgba(0,0,0,0.08)]"
              )}
            >
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();

                return (
                  <th
                    key={header.id}
                    scope="col"
                    // table-fixed only honors widths set on the first row's
                    // cells. Without this, columns distribute viewport evenly
                    // and the date column ends up huge. Memo is the one
                    // flexible column: fixed widths summed to 1358px, wider
                    // than the content area at common window sizes, so the
                    // table scrolled sideways by a sliver. Memo is usually
                    // "—" and truncates with a tooltip, so it absorbs the slack.
                    style={{ width: header.column.id === "memo" ? undefined : header.getSize() }}
                    className={cn("h-12", headerCellClass(header.column.id))}
                  >
                    {canSort ? (
                      <button
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex items-center gap-0.5 uppercase -mx-2 px-2 py-1 rounded-md cursor-pointer hover:bg-accent/70 hover:text-foreground/80 transition-colors",
                          sorted && "text-foreground/80"
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIndicator header={header} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        {/* Pending section — imported/unapproved rows. Rendered through the SAME
            shared renderer as the approved rows below, so the two sections can't
            drift in columns, order, or cell styling. Data-driven: shows whenever
            any row is unapproved, independent of FEATURES.BANK_SYNC. */}
        {pendingModelRows.length > 0 && (
          <>
            <tbody>
              {/* Section header row */}
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <button
                    onClick={() => setPendingCollapsed(!pendingCollapsed)}
                    className="flex items-center gap-1.5 w-full px-6 py-2 bg-warning/8 text-warning text-[11px] font-semibold uppercase tracking-[0.06em] text-left"
                    aria-expanded={!pendingCollapsed}
                  >
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 transition-transform duration-150",
                        !pendingCollapsed && "rotate-90"
                      )}
                    />
                    Pending transactions ({pendingModelRows.length})
                  </button>
                </td>
              </tr>
            </tbody>
            {!pendingCollapsed &&
              pendingModelRows.map((row, rowIndex) =>
                renderTxnRow(row, rowIndex, "pending", pendingSectionIds)
              )}
            {/* Thick divider between pending and approved */}
            <tbody>
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <div className="h-[3px] bg-border" />
                </td>
              </tr>
            </tbody>
          </>
        )}

        {/* Approved rows — rendered through the shared renderer so they can't
            drift from the pending section above. */}
        {approvedModelRows.map((row, rowIndex) =>
          renderTxnRow(row, rowIndex, "approved", approvedSectionIds)
        )}
      </table>

      {transactions.length === 0 && (() => {
        // Differentiate "no transactions at all" from "filters yielded zero".
        // The dialog-based "Add transaction" CTA only makes sense in the
        // truly-empty case; when filters are active, the helpful action is
        // clearing them. hiddenCount captures the implicit default-current-
        // month filter that lives outside URL params.
        const filterKeys = ["search", "category", "start", "end"] as const;
        const activeFilters = filterKeys.filter((k) => searchParams.get(k));
        const hasExplicitFilters = activeFilters.length > 0;
        const isUncategorized = searchParams.get("category") === "uncategorized";

        const clearExplicitOnly = () => {
          const params = new URLSearchParams(searchParams.toString());
          for (const k of filterKeys) params.delete(k);
          const next = params.toString();
          router.push(next ? `?${next}` : "?");
        };
        const resetAll = onResetAllFilters ?? clearExplicitOnly;

        if (isUncategorized) {
          return (
            <EmptyState
              icon={CircleCheck}
              message="Nothing left to categorize — you're all caught up."
              primaryAction={{ label: "Clear filter", onClick: clearExplicitOnly }}
            />
          );
        }

        // No rows visible, but hiddenCount > 0 means filters (explicit or the
        // implicit default month range) are hiding data. Surface a count and
        // a "View all" that escapes the implicit default too.
        if (hiddenCount > 0) {
          const monthLabel = !hasExplicitFilters && defaultRangeStart
            ? formatMonthYear(`${defaultRangeStart}-01`)
            : null;
          return (
            <EmptyState
              icon={ArrowLeftRight}
              headline={monthLabel ? `No transactions in ${monthLabel}` : "No transactions match these filters"}
              message={`${hiddenCount} ${hiddenCount === 1 ? "transaction is" : "transactions are"} hidden by the current filter.`}
              primaryAction={{ label: "View all", onClick: resetAll }}
            />
          );
        }

        if (hasExplicitFilters) {
          return (
            <EmptyState
              icon={ArrowLeftRight}
              message="No transactions match these filters."
              primaryAction={{ label: "Clear filters", onClick: clearExplicitOnly }}
            />
          );
        }

        return (
          <>
            <EmptyState
              icon={ArrowLeftRight}
              message="Add your first transaction to get started."
              primaryAction={{ label: "Add transaction", onClick: () => setEmptyStateDialogOpen(true) }}
            />
            <TransactionDialog
              open={emptyStateDialogOpen}
              onOpenChange={setEmptyStateDialogOpen}
              accounts={accounts}
              categories={categories}
              categoryGroups={categoryGroups}
              payees={payees}
              defaultAccountId={defaultAccountId}
            />
          </>
        );
      })()}

      <TransactionDialog
        open={!!editingTxn}
        onOpenChange={handleDialogChange}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        payees={payees}
        defaultAccountId={defaultAccountId}
        transaction={editingTxn}
      />
    </div>
  );
}
