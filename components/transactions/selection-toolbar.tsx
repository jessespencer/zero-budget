"use client";

import { useEffect, useState, useMemo } from "react";
import {
  X,
  CheckCircle2,
  Trash2,
  Tag,
  Copy,
  Lock,
  CalendarClock,
  ArrowRightLeft,
  Pencil,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/features";
import { PayeeCombobox, type PayeeOption } from "@/components/shared/payee-combobox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useExitPresence } from "@/components/shared/use-exit-presence";

export type SelectionAction =
  | { type: "approve" }
  | { type: "delete" }
  | { type: "categorize"; categoryId: string }
  | { type: "moveAccount"; accountId: string }
  | { type: "renamePayee"; payee: string }
  | { type: "duplicate" }
  | { type: "cleared" }
  | { type: "schedule" }
  | { type: "editTransfer" };

// Transfer composition of the current selection. A transfer is two linked rows;
// most bulk actions (categorize, rename payee, move, duplicate) either make no
// sense or would desync the pair, so when the selection is entirely transfers
// the toolbar collapses to Approve / Edit / Delete. Editing routes through the
// transfer dialog (see `editTransfer`).
export type TransferSelectionInfo = {
  // How many selected rows are transfer legs (transfer_account_id set).
  legCount: number;
  // Distinct transfer pairs the selected legs belong to.
  pairCount: number;
  // True when the selection is exactly one transfer pair and nothing else —
  // the only case where "Edit" is offered.
  canEdit: boolean;
};

type SelectionToolbarProps = {
  selectedCount: number;
  // Effective delete count after transfer-pair sibling expansion. Equals
  // `selectedCount` when no sibling cascade applies; higher when one or more
  // selected rows is a transfer leg whose sibling will be auto-deleted
  // server-side (260518-fqy #4). Used only in the confirm-delete dialog copy.
  effectiveDeleteCount?: number;
  // Structural shape — the upstream `getAccountsAndCategories` query already
  // filters out archived accounts, so we only need id + name here.
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  payees: PayeeOption[];
  // Current payees on the selected rows. When all selected rows share one
  // payee the rename dialog seeds with that name (for typo-fix flows); when
  // mixed, it opens empty.
  selectedPayees?: (string | null)[];
  // How many selected rows are still pending (approved=0). When > 0 the
  // "Approve" action is offered to post them — independent of FEATURES.BANK_SYNC
  // (import-txns pending rows surface without the full bank-sync surface).
  pendingCount?: number;
  // Transfer composition of the selection. Absent (or legCount 0) means the
  // selection has no transfers and the full toolbar shows.
  transferInfo?: TransferSelectionInfo;
  onDeselect: () => void;
  onAction: (action: SelectionAction) => void;
};

export function SelectionToolbar({
  selectedCount,
  effectiveDeleteCount,
  accounts,
  categories,
  categoryGroups,
  payees,
  selectedPayees,
  pendingCount = 0,
  transferInfo,
  onDeselect,
  onAction,
}: SelectionToolbarProps) {
  // Selection is entirely transfer legs — collapse to Approve / Edit / Delete.
  const allTransfers =
    !!transferInfo &&
    transferInfo.legCount > 0 &&
    transferInfo.legCount === selectedCount;
  const canEditTransfer = allTransfers && !!transferInfo?.canEdit;
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const sharedPayee = useMemo(() => {
    if (!selectedPayees || selectedPayees.length === 0) return null;
    const first = selectedPayees[0] ?? "";
    for (const p of selectedPayees) {
      if ((p ?? "") !== first) return null;
    }
    return first;
  }, [selectedPayees]);

  // Seed the rename input each time the dialog opens. Reset when it closes so
  // we don't leak stale input into the next session.
  useEffect(() => {
    if (renameDialogOpen) setRenameValue(sharedPayee ?? "");
    else setRenameValue("");
  }, [renameDialogOpen, sharedPayee]);

  const grouped = useMemo(
    () =>
      categoryGroups
        .filter((g) => !g.is_system)
        .map((group) => ({
          ...group,
          items: categories.filter((c) => c.category_group_id === group.id),
        }))
        .filter((g) => g.items.length > 0),
    [categories, categoryGroups]
  );

  const moveAccountOptions = useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
    [accounts]
  );

  useEffect(() => {
    if (selectedCount === 0 || deleteDialogOpen || renameDialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      // Ignore when the user is typing in an input, textarea, or contenteditable.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
      }
      e.preventDefault();
      setDeleteDialogOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCount, deleteDialogOpen, renameDialogOpen]);

  const visible = selectedCount > 0 || deleteDialogOpen || renameDialogOpen;
  // Stays mounted for the exit animation instead of vanishing on clear.
  const { mounted, closing, last } = useExitPresence(visible, selectedCount);
  if (!mounted) return null;
  // During the exit the selection is already empty — keep the last count.
  const shownCount = closing ? last : selectedCount;

  return (
    <>
    <div
      data-selection-toolbar
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 duration-150",
        closing
          ? "animate-out slide-out-to-bottom-4 fade-out fill-mode-forwards pointer-events-none"
          : "animate-in slide-in-from-bottom-4 fade-in"
      )}
    >
      <div className="flex items-center gap-0.5 rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 px-2 py-2">
        {/* Count + deselect */}
        <button
          onClick={onDeselect}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          {allTransfers
            ? `${transferInfo!.pairCount} ${transferInfo!.pairCount === 1 ? "transfer" : "transfers"}`
            : `${shownCount} ${shownCount === 1 ? "transaction" : "transactions"}`}
        </button>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Approve — shown when the selection has pending (approved=0) rows to
            post, or when bank sync is enabled. */}
        {(pendingCount > 0 || FEATURES.BANK_SYNC) && (
          <>
            <ToolbarButton
              icon={CheckCircle2}
              label="Approve"
              onClick={() => onAction({ type: "approve" })}
            />
            <div className="w-px h-5 bg-border mx-0.5" />
          </>
        )}

        {/* Edit — transfers-only, single pair. Opens the transfer dialog so
            amount/accounts/date change atomically instead of desyncing a leg. */}
        {canEditTransfer && (
          <>
            <ToolbarButton
              icon={Pencil}
              label="Edit"
              onClick={() => onAction({ type: "editTransfer" })}
            />
            <div className="w-px h-5 bg-border mx-0.5" />
          </>
        )}

        {/* Category / payee / move / duplicate don't apply to transfers — a
            transfer has no category, its payee is derived from the accounts, and
            duplicating one leg orphans it. Hide the whole group when the
            selection is entirely transfers. */}
        {!allTransfers && (
          <>
            {/* Categorize */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
              >
                <Tag className="h-3.5 w-3.5" />
                Categorize
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" className="max-h-80 overflow-y-auto">
                {grouped.map((group) => (
                  <DropdownMenuSub key={group.id}>
                    <DropdownMenuSubTrigger>{group.name}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {group.items.map((cat) => (
                        <DropdownMenuItem
                          key={cat.id}
                          onClick={() => onAction({ type: "categorize", categoryId: cat.id })}
                        >
                          {cat.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-px h-5 bg-border mx-0.5" />

            {/* Rename payee */}
            <ToolbarButton
              icon={Pencil}
              label="Rename payee"
              onClick={() => setRenameDialogOpen(true)}
            />

            <div className="w-px h-5 bg-border mx-0.5" />

            {/* Cleared — only shown when reconciliation is enabled */}
            {FEATURES.RECONCILIATION && (
              <ToolbarButton
                icon={Lock}
                label="Cleared"
                onClick={() => onAction({ type: "cleared" })}
              />
            )}

            {/* Duplicate */}
            <ToolbarButton
              icon={Copy}
              label="Duplicate"
              onClick={() => onAction({ type: "duplicate" })}
            />

            <div className="w-px h-5 bg-border mx-0.5" />
          </>
        )}

        {/* Transfers-only: the More menu would hold nothing but Delete (Move /
            Add schedule are hidden), so surface Delete directly. Otherwise keep
            the overflow menu for Move to account (bulk), Add schedule (single),
            and Delete. */}
        {allTransfers ? (
          <ToolbarButton
            icon={Trash2}
            label="Delete"
            destructive
            onClick={() => setDeleteDialogOpen(true)}
          />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              More
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="max-h-80 overflow-y-auto">
              {/* Move to account */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Move to account
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                  {moveAccountOptions.map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      onClick={() => onAction({ type: "moveAccount", accountId: a.id })}
                    >
                      {a.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {/* Add schedule — single selection only */}
              {selectedCount === 1 && (
                <DropdownMenuItem onClick={() => onAction({ type: "schedule" })}>
                  <CalendarClock className="h-3.5 w-3.5" />
                  Add schedule
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {/* Delete */}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>

    <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
      <DialogContent className="overflow-visible">
        <DialogHeader>
          <DialogTitle>
            Rename payee on {selectedCount} {selectedCount === 1 ? "transaction" : "transactions"}
          </DialogTitle>
          <DialogDescription>
            {sharedPayee
              ? `Current: ${sharedPayee || "(blank)"}. Pick an existing payee or type a new name.`
              : "Selected transactions have different payees. The new name will apply to all of them."}
          </DialogDescription>
        </DialogHeader>
        <div className="py-1">
          <PayeeCombobox
            value={renameValue}
            payees={payees}
            placeholder="New payee name"
            onChange={(name) => setRenameValue(name)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={renameValue.trim().length === 0 || renameValue.trim() === (sharedPayee ?? "").trim()}
            onClick={() => {
              const trimmed = renameValue.trim();
              if (trimmed.length === 0) return;
              onAction({ type: "renamePayee", payee: trimmed });
              setRenameDialogOpen(false);
            }}
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {effectiveDeleteCount ?? selectedCount} {(effectiveDeleteCount ?? selectedCount) === 1 ? "transaction" : "transactions"}?</DialogTitle>
          <DialogDescription>
            {effectiveDeleteCount !== undefined && effectiveDeleteCount > selectedCount
              ? `Includes the paired ${effectiveDeleteCount - selectedCount === 1 ? "leg" : "legs"} of any selected transfer. You can undo this.`
              : "You can undo this."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onAction({ type: "delete" });
              setDeleteDialogOpen(false);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
