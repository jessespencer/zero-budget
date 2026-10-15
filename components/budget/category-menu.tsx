"use client";

import { useState, useTransition, useEffect } from "react";
import { MoreHorizontal, Pencil, Trash2, ArrowUp, ArrowDown, Settings, FolderInput, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  BulkDeleteCategoriesDialog,
  type ReassignOption,
} from "./bulk-delete-categories-dialog";
import { CategorySettingsDialog } from "./category-settings-dialog";
import {
  archiveCategoryWithSnapshot,
  bulkDeleteCategoriesWithSnapshot,
  getCategoryDeletionImpact,
  reorderCategory,
  restoreArchiveCategorySnapshot,
} from "@/app/(app)/budget/actions";
import { useCategoryRestore } from "./use-category-restore";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";
import type { CategoryWithBudget, Account } from "@/lib/types";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";

type CategoryMenuProps = {
  categoryId: string;
  categoryName: string;
  groupId: string;
  // Month the budget grid is showing — the hide sweep lowers this month's
  // assigned by the category's available balance.
  month: string;
  isFirst: boolean;
  isLast: boolean;
  onRenameStart: () => void;
  // Returns the id of the pushed entry so a toast's Undo can target *that*
  // action rather than whatever is on top of the stack six seconds later.
  // budget-table already passes `pushMutation`, which has always returned one —
  // the old `void` return type discarded it.
  onMutate: (entry: MutationEntry) => MutationId;
  accounts: Account[];
  category: CategoryWithBudget;
  // Other groups the category can be moved to. Pre-filtered by the caller
  // (excludes the current group and any system groups). When empty, the
  // "Move to group…" submenu trigger renders disabled so keyboard users get
  // the native disabled affordance — the menu itself is kept dumb and does
  // no filtering.
  otherGroups: { id: string; name: string }[];
  onMoveToGroup: (targetGroupId: string) => void;
  // Every non-system category, including this one — the delete dialog filters
  // this category out itself so callers don't have to build a per-row list.
  reassignOptions: ReassignOption[];
  // Closes the responsive side-panel drawer before opening a sub-dialog so
  // the Sheet's backdrop doesn't stack with the Dialog's backdrop at narrow
  // viewports (would otherwise produce double-blur and leave a stray overlay
  // after the dialog closes).
  closeSidePanel?: () => void;
};

export function CategoryMenu({
  categoryId,
  categoryName,
  groupId,
  month,
  isFirst,
  isLast,
  onRenameStart,
  onMutate,
  accounts,
  category,
  otherGroups,
  onMoveToGroup,
  reassignOptions,
  closeSidePanel,
}: CategoryMenuProps) {
  // Never offer the category being deleted as its own destination.
  const destinations = reassignOptions.filter((o) => o.id !== categoryId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transactionCount, setTransactionCount] = useState(0);
  const [budgetHistoryCount, setBudgetHistoryCount] = useState(0);
  const [, startTransition] = useTransition();
  const restoreCategories = useCategoryRestore();
  const { toast } = useToast();
  // The undo stack is a module singleton, so this reaches the same stack
  // budget-table pushes to — no need to thread undoEntry down as a prop.
  const { undoEntry } = useUndoRedo();

  // Look up the transaction count when the confirm dialog is about to open so
  // the description can warn the user. Cheap query (single COUNT).
  useEffect(() => {
    if (!confirmOpen) return;
    let cancelled = false;
    getCategoryDeletionImpact([categoryId]).then((impact) => {
      if (cancelled) return;
      setTransactionCount(impact.transactionCount);
      setBudgetHistoryCount(impact.budgetHistoryCount);
    });
    return () => {
      cancelled = true;
    };
  }, [confirmOpen, categoryId]);

  const handleDelete = (reassignToCategoryId: string | null) => {
    setConfirmOpen(false);
    startTransition(async () => {
      try {
        const snapshot = await bulkDeleteCategoriesWithSnapshot({
          categoryIds: [categoryId],
          groupIds: [],
          reassignToCategoryId,
        });
        const entryId = onMutate({
          label: `Delete "${categoryName}"`,
          forward: async () => {
            await bulkDeleteCategoriesWithSnapshot({
              categoryIds: [categoryId],
              groupIds: [],
              reassignToCategoryId,
            });
          },
          backward: () => restoreCategories(snapshot, `"${categoryName}"`),
        });
        toast({
          message: `Deleted "${categoryName}"`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        toast({
          message: `Couldn't delete "${categoryName}". Nothing was changed.`,
          variant: "error",
        });
      }
    });
  };

  const handleHide = () => {
    closeSidePanel?.();
    startTransition(async () => {
      try {
        const snapshot = await archiveCategoryWithSnapshot(categoryId, month);
        const entryId = onMutate({
          label: `Hide "${categoryName}"`,
          forward: async () => {
            await archiveCategoryWithSnapshot(categoryId, month);
          },
          backward: async () => {
            await restoreArchiveCategorySnapshot(snapshot);
          },
        });
        // Hiding sweeps the category's available balance back to Ready to
        // Assign, and the row it happened on disappears in the same beat — so
        // money moves with no number changing anywhere the user is looking.
        // CLAUDE.md names this exact case as requiring a toast.
        toast({
          message: `Hid "${categoryName}"`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        toast({
          message: `Couldn't hide "${categoryName}". Nothing was changed.`,
          variant: "error",
        });
      }
    });
  };

  const handleMove = (direction: "up" | "down") => {
    const opposite = direction === "up" ? "down" : "up";
    startTransition(async () => {
      try {
        await reorderCategory(categoryId, groupId, direction);
        // Pushed after the reorder lands. It used to fire alongside an
        // un-awaited call, so a failed move still left an undo entry whose
        // backward() would reorder in the opposite direction from wherever the
        // row actually was.
        onMutate({
          label: `Move "${categoryName}" ${direction}`,
          forward: () => reorderCategory(categoryId, groupId, direction),
          backward: () => reorderCategory(categoryId, groupId, opposite),
        });
      } catch {
        // No success toast — the row visibly moves. A failure moves nothing,
        // which is indistinguishable from never having clicked.
        toast({
          message: `Couldn't move "${categoryName}".`,
          variant: "error",
        });
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Options for ${categoryName}`}
                      className="shrink-0 opacity-0 group-hover/cat-row:opacity-100 focus-visible:opacity-100 transition-opacity"
                    />
                  }
                  onClick={(e) => e.stopPropagation()}
                />
              }
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Category options</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent align="start" sideOffset={4} className="min-w-[180px]">
          <DropdownMenuItem onClick={() => onRenameStart()}>
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isFirst}
            onClick={() => handleMove("up")}
          >
            <ArrowUp className="h-3.5 w-3.5" />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isLast}
            onClick={() => handleMove("down")}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Move down
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={otherGroups.length === 0}>
              <FolderInput className="h-3.5 w-3.5" />
              Move to group…
            </DropdownMenuSubTrigger>
            {otherGroups.length > 0 && (
              <DropdownMenuSubContent>
                {otherGroups.map((g) => (
                  <DropdownMenuItem
                    key={g.id}
                    onClick={() => onMoveToGroup(g.id)}
                  >
                    {g.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            )}
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              closeSidePanel?.();
              setSettingsOpen(true);
            }}
          >
            <Settings className="h-3.5 w-3.5" />
            Category settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleHide}>
            <EyeOff className="h-3.5 w-3.5" />
            Hide category
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              closeSidePanel?.();
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The same dialog the bulk path uses, scoped to one category. A plain
          ConfirmDialog can't serve this any more: a category with assign
          history needs somewhere for that history to go, and the server
          refuses the delete without it. */}
      <BulkDeleteCategoriesDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        categoryCount={1}
        groupCount={0}
        transactionCount={transactionCount}
        reassignOptions={destinations}
        onConfirm={handleDelete}
        requireReassign={budgetHistoryCount > 0}
      />

      <CategorySettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        category={category}
        accounts={accounts}
        onMutate={onMutate}
      />
    </>
  );
}
