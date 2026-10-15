"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { CHECKED_ROW_CLASS } from "@/lib/row-classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CategoryCombobox } from "@/components/shared/category-combobox";
import { PayeeCombobox } from "@/components/shared/payee-combobox";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  updatePayee,
  deletePayee,
  deletePayees,
  mergePayeesWithSnapshot,
  restoreMergePayeesSnapshot,
} from "@/app/(app)/transactions/actions";
import { useUndoRedo } from "@/lib/use-undo-redo";
import { EmptyState } from "@/components/shared/empty-state";
import { Settings2, Search, Trash2 } from "lucide-react";

type PayeeItem = { id: string; name: string; default_category_id: string | null };

// A pending merge awaiting confirmation. winnerName/loserNames drive the
// confirm-dialog copy; the ids drive the server call. onComplete clears the
// originating panel (collapse selection / mark loser deleted) after success.
type PendingMerge = {
  loserIds: string[];
  winnerId: string;
  winnerName: string;
  loserNames: string[];
  onComplete: () => void;
};

// Thread a single merge runner down to both entry points so undo wiring +
// the confirm gate live in one place.
type RunMerge = (merge: PendingMerge) => void;

type ManagePayeesDialogProps = {
  payees: PayeeItem[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  // Optional controlled-open support. When `open` is provided, the dialog is
  // driven externally (e.g. from the sidebar SettingsMenu) and renders no
  // default trigger button. When omitted, the dialog stays self-contained with
  // its own state + the "Manage payees" trigger (existing callsites).
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function ManagePayeesDialog({
  payees,
  categories,
  categoryGroups,
  open,
  onOpenChange,
}: ManagePayeesDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const dialogOpen = isControlled ? open : internalOpen;
  const [search, setSearch] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [isMergePending, startMergeTransition] = useTransition();
  const undoRedo = useUndoRedo();
  const { toast } = useToast();

  // Single merge runner: stages a pending merge for confirmation. The right
  // panel swaps to an inline confirm (no nested dialog) and the server call
  // fires from confirmMerge below.
  const runMerge: RunMerge = (merge) => {
    setMergeError(null);
    setPendingMerge(merge);
  };

  const confirmMerge = () => {
    if (!pendingMerge) return;
    const { loserIds, winnerId, onComplete } = pendingMerge;
    setMergeError(null);
    startMergeTransition(async () => {
      try {
        const snapshot = await mergePayeesWithSnapshot(loserIds, winnerId);
        const entryId = undoRedo.push({
          label: "Merge payees",
          forward: () => mergePayeesWithSnapshot(loserIds, winnerId).then(() => {}),
          backward: () => restoreMergePayeesSnapshot(snapshot),
        });
        // The merged rows leave the list, so the only trace is the loser
        // vanishing — toast the count with the Undo.
        toast({
          message: `Merged ${loserIds.length} payee${loserIds.length === 1 ? "" : "s"}`,
          action: { label: "Undo", onClick: () => undoRedo.undoEntry(entryId) },
        });
        onComplete();
        setPendingMerge(null);
      } catch (err) {
        setMergeError(err instanceof Error ? err.message : "Couldn't merge — try again.");
      }
    });
  };

  const filtered = search
    ? payees.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : payees;

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (checkedIds.size === filtered.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(filtered.map((p) => p.id)));
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (isControlled) onOpenChange?.(o);
    else setInternalOpen(o);
    if (!o) {
      setCheckedIds(new Set());
      setSearch("");
      setPendingMerge(null);
    }
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
          <Settings2 className="h-4 w-4" />
          Manage payees
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-3xl h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage payees</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 gap-0 -mx-4 -mb-4 border-t border-border/50">
          {/* Left panel — payee list */}
          <div className="w-[320px] border-r border-border/50 flex flex-col">
            <div className="p-4 border-b border-border/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
                <Input
                  placeholder="Search payees"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-[13px]"
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {/* Select all header */}
              <label className="flex items-center gap-2.5 px-4 py-2.5 text-[12px] font-semibold text-muted-foreground border-b border-border/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && checkedIds.size === filtered.length}
                  onChange={toggleAll}
                  className="rounded accent-primary"
                />
                Payees ({filtered.length})
              </label>

              {filtered.map((p) => (
                <div
                  key={p.id}
                  onClick={() => toggleCheck(p.id)}
                  className={cn(
                    "flex items-center gap-2.5 px-4 py-2.5 text-[13px] cursor-pointer transition-colors",
                    checkedIds.has(p.id) ? CHECKED_ROW_CLASS : "hover:bg-accent/30"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checkedIds.has(p.id)}
                    onChange={() => toggleCheck(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded accent-primary"
                  />
                  <span className="truncate">{p.name}</span>
                </div>
              ))}

              {filtered.length === 0 && (
                <EmptyState variant="compact" message="No payees match your search." />
              )}
            </div>

          </div>

          {/* Right panel */}
          <div className="flex-1 flex items-center justify-center">
            {pendingMerge ? (
              <div className="w-full h-full flex flex-col">
                <div className="flex-1 p-4 flex flex-col gap-3">
                  <h3 className="text-lg font-extrabold">Merge payees?</h3>
                  <p className="text-sm text-muted-foreground">
                    {`All transactions for ${formatNameList(
                      pendingMerge.loserNames
                    )} will be renamed to "${pendingMerge.winnerName}". This can be undone this session, but not after a refresh.`}
                  </p>
                  {mergeError && (
                    <p className="text-[12px] text-negative">{mergeError}</p>
                  )}
                </div>
                <div className="p-3 border-t border-border/50 flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingMerge(null)}
                    disabled={isMergePending}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={confirmMerge} disabled={isMergePending}>
                    {isMergePending ? "Merging..." : "Merge"}
                  </Button>
                </div>
              </div>
            ) : checkedIds.size > 1 ? (
              <MultiSelectSummary
                checkedIds={checkedIds}
                payees={payees}
                onDeleted={() => setCheckedIds(new Set())}
                onMerge={runMerge}
              />
            ) : checkedIds.size === 1 ? (() => {
              const checkedPayee = payees.find((p) => checkedIds.has(p.id));
              return checkedPayee ? (
                <PayeeDetail
                  payee={checkedPayee}
                  categories={categories}
                  categoryGroups={categoryGroups}
                  onDeleted={() => setCheckedIds(new Set())}
                  onMerge={runMerge}
                />
              ) : null;
            })() : (
              <p className="text-sm text-muted-foreground">
                Select a payee to edit
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// "Beau Joes" / "A, B and C" — quoted, oxford-joined for the confirm copy.
function formatNameList(names: string[]): string {
  const quoted = names.map((n) => `"${n}"`);
  if (quoted.length === 0) return "the selected payees";
  if (quoted.length === 1) return quoted[0];
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

function PayeeDetail({
  payee,
  categories,
  categoryGroups,
  onDeleted,
  onMerge,
}: {
  payee: PayeeItem;
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  onDeleted: () => void;
  onMerge: RunMerge;
}) {
  const [name, setName] = useState(payee.name);
  const [defaultCategoryId, setDefaultCategoryId] = useState(payee.default_category_id || "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { toast } = useToast();
  // Set when a save fails on a duplicate name — drives the "Merge instead" button.
  const [conflict, setConflict] = useState<{
    conflictPayeeId: string;
    conflictName: string;
  } | null>(null);

  // Reset when payee changes
  const [prevId, setPrevId] = useState(payee.id);
  if (payee.id !== prevId) {
    setPrevId(payee.id);
    setName(payee.name);
    setDefaultCategoryId(payee.default_category_id || "");
    setError("");
    setConflict(null);
  }

  const groupedCategories = categoryGroups
    .filter((g) => !g.is_income && !g.is_system)
    .map((group) => ({
      ...group,
      items: categories.filter((c) => c.category_group_id === group.id),
    }))
    .filter((g) => g.items.length > 0);

  const hasChanges = name !== payee.name || (defaultCategoryId || null) !== (payee.default_category_id || null);

  const handleSave = () => {
    setError("");
    setConflict(null);
    startTransition(async () => {
      try {
        const updates: { name?: string; default_category_id?: string | null } = {};
        if (name !== payee.name) updates.name = name;
        if ((defaultCategoryId || null) !== (payee.default_category_id || null)) {
          updates.default_category_id = defaultCategoryId || null;
        }
        const result = await updatePayee(payee.id, updates);
        if (!result.ok && result.error === "duplicate_name") {
          setError(`A payee named "${result.conflictName}" already exists.`);
          if (result.conflictPayeeId) {
            setConflict({
              conflictPayeeId: result.conflictPayeeId,
              conflictName: result.conflictName,
            });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update");
      }
    });
  };

  const handleMergeInstead = () => {
    if (!conflict) return;
    onMerge({
      loserIds: [payee.id],
      winnerId: conflict.conflictPayeeId,
      winnerName: conflict.conflictName,
      loserNames: [payee.name],
      onComplete: onDeleted,
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deletePayee(payee.id);
        // Irreversible (no snapshot), so the toast carries no Undo — it just
        // acknowledges the delete and the off-screen loss of the learned
        // default category the confirm warned about.
        toast({ message: "Payee deleted" });
        onDeleted();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete");
      }
    });
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
          Name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
          Default category
        </label>
        <CategoryCombobox
          value={defaultCategoryId}
          groupedCategories={groupedCategories}
          onChange={setDefaultCategoryId}
          placeholder="None"
        />
      </div>

      {error && (
        <div className="space-y-2">
          <p className="text-[12px] text-negative">{error}</p>
          {conflict && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMergeInstead}
              disabled={isPending}
            >
              Merge &quot;{payee.name}&quot; into &quot;{conflict.conflictName}&quot;
            </Button>
          )}
        </div>
      )}
      </div>

      <div className="p-3 border-t border-border/50 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="text-negative hover:text-negative"
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={isPending}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Delete
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending || !hasChanges || !name.trim()}
        >
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete "${payee.name}"?`}
        description="This removes the payee and its learned default category. Transactions keep their payee text. This can't be undone."
        confirmLabel="Delete payee"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function MultiSelectSummary({
  checkedIds,
  payees,
  onDeleted,
  onMerge,
}: {
  checkedIds: Set<string>;
  payees: PayeeItem[];
  onDeleted: () => void;
  onMerge: RunMerge;
}) {
  const [isPending, startTransition] = useTransition();
  // null = bulk view; "" or a name = the "Merge into…" winner picker is open.
  const [winnerInput, setWinnerInput] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { toast } = useToast();
  const checked = payees.filter((p) => checkedIds.has(p.id));

  const handleDelete = () => {
    setDeleteError(null);
    const count = checked.length;
    startTransition(async () => {
      try {
        await deletePayees([...checkedIds]);
        // Irreversible (no snapshot) — plain acknowledgement, no Undo. The
        // deleted rows vanish from a list the user may not be watching.
        toast({ message: `Deleted ${count} payee${count === 1 ? "" : "s"}` });
        onDeleted();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Couldn't delete — try again.");
      }
    });
  };

  const handleMerge = () => {
    // Winner must be one of the checked payees — the picker only offers those.
    const winner = checked.find(
      (p) => p.name.toLowerCase() === (winnerInput ?? "").trim().toLowerCase()
    );
    if (!winner) return;
    const losers = checked.filter((p) => p.id !== winner.id);
    if (losers.length === 0) return;
    onMerge({
      loserIds: losers.map((p) => p.id),
      winnerId: winner.id,
      winnerName: winner.name,
      loserNames: losers.map((p) => p.name),
      onComplete: onDeleted,
    });
  };

  const winnerResolved = checked.some(
    (p) => p.name.toLowerCase() === (winnerInput ?? "").trim().toLowerCase()
  );

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 p-4 flex flex-col gap-3">
        <h3 className="text-lg font-extrabold">
          {checked.length} payees selected
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {checked.map((p) => p.name).join(", ")}
        </p>

        {winnerInput !== null && (
          <div className="space-y-1.5 pt-2">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
              Merge into
            </label>
            <PayeeCombobox
              value={winnerInput}
              payees={checked}
              placeholder="Pick the payee to keep"
              onChange={(name) => setWinnerInput(name)}
            />
          </div>
        )}

        {deleteError && (
          <p className="text-[12px] text-negative">{deleteError}</p>
        )}
      </div>
      <div className="p-3 border-t border-border/50 flex items-center justify-end gap-2">
        {winnerInput === null ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setWinnerInput("")}>
              Merge into…
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={isPending}
            >
              {isPending ? "Deleting..." : `Delete ${checked.length}`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => setWinnerInput(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleMerge} disabled={!winnerResolved}>
              Next
            </Button>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete ${checked.length} payee${checked.length === 1 ? "" : "s"}?`}
        description="This removes the payees and their learned default categories. Transactions keep their payee text. This can't be undone."
        confirmLabel={`Delete ${checked.length}`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
