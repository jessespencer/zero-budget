"use client";

import { useState, useTransition, useEffect } from "react";
import { MoreHorizontal, Pencil, Trash2, ArrowUp, ArrowDown, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  BulkDeleteCategoriesDialog,
  type ReassignOption,
} from "./bulk-delete-categories-dialog";
import {
  archiveGroupWithSnapshot,
  bulkDeleteCategoriesWithSnapshot,
  getCategoryDeletionImpact,
  reorderCategoryGroup,
  restoreArchiveGroupSnapshot,
} from "@/app/(app)/budget/actions";
import { useCategoryRestore } from "./use-category-restore";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";

type CategoryGroupMenuProps = {
  groupId: string;
  groupName: string;
  categoryCount: number;
  // The budget month the hide sweeps against (RTA round-trips to the cent).
  month: string;
  isFirst: boolean;
  isLast: boolean;
  onRenameStart: () => void;
  onMutate: (entry: MutationEntry) => MutationId;
  // Categories outside this group — destinations for the deleted group's
  // transactions and budget history. Its own children are filtered out by
  // CategoryGroupRow, since they are being deleted too.
  reassignOptions: ReassignOption[];
  // See note on CategoryMenuProps.closeSidePanel.
  closeSidePanel?: () => void;
};

export function CategoryGroupMenu({
  groupId,
  groupName,
  categoryCount,
  month,
  isFirst,
  isLast,
  onRenameStart,
  onMutate,
  reassignOptions,
  closeSidePanel,
}: CategoryGroupMenuProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [transactionCount, setTransactionCount] = useState(0);
  const [budgetHistoryCount, setBudgetHistoryCount] = useState(0);
  const [, startTransition] = useTransition();
  const restoreCategories = useCategoryRestore();
  const { toast } = useToast();
  const { undoEntry } = useUndoRedo();

  // Look up affected transaction count when the confirm dialog opens so we
  // can warn the user. Counts include cascading children.
  useEffect(() => {
    if (!confirmOpen) return;
    let cancelled = false;
    getCategoryDeletionImpact([], [groupId]).then((impact) => {
      if (cancelled) return;
      setTransactionCount(impact.transactionCount);
      setBudgetHistoryCount(impact.budgetHistoryCount);
    });
    return () => {
      cancelled = true;
    };
  }, [confirmOpen, groupId]);

  const handleDelete = (reassignToCategoryId: string | null) => {
    setConfirmOpen(false);
    startTransition(async () => {
      try {
        const snapshot = await bulkDeleteCategoriesWithSnapshot({
          categoryIds: [],
          groupIds: [groupId],
          reassignToCategoryId,
        });
        const entryId = onMutate({
          label: `Delete "${groupName}"`,
          forward: async () => {
            await bulkDeleteCategoriesWithSnapshot({
              categoryIds: [],
              groupIds: [groupId],
              reassignToCategoryId,
            });
          },
          backward: () => restoreCategories(snapshot, `"${groupName}"`),
        });
        toast({
          message: `Deleted "${groupName}"`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        toast({
          message: `Couldn't delete "${groupName}". Nothing was changed.`,
          variant: "error",
        });
      }
    });
  };

  const handleHide = () => {
    startTransition(async () => {
      try {
        const snapshot = await archiveGroupWithSnapshot(groupId, month);
        const entryId = onMutate({
          label: `Hide "${groupName}"`,
          forward: async () => {
            await archiveGroupWithSnapshot(groupId, month);
          },
          backward: async () => {
            await restoreArchiveGroupSnapshot(snapshot);
          },
        });
        // Same as hiding a category: the group's balances sweep to Ready to
        // Assign and every row that would have shown it leaves the screen.
        toast({
          message: `Hid "${groupName}"`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        toast({
          message: `Couldn't hide "${groupName}". Nothing was changed.`,
          variant: "error",
        });
      }
    });
  };

  const handleMove = (direction: "up" | "down") => {
    const opposite = direction === "up" ? "down" : "up";
    startTransition(async () => {
      try {
        await reorderCategoryGroup(groupId, direction);
        onMutate({
          label: `Move "${groupName}" ${direction}`,
          forward: () => reorderCategoryGroup(groupId, direction),
          backward: () => reorderCategoryGroup(groupId, opposite),
        });
      } catch {
        // No success toast — the group visibly moves.
        toast({
          message: `Couldn't move "${groupName}".`,
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
                      aria-label={`Options for ${groupName}`}
                      className="shrink-0 opacity-0 group-hover/group-row:opacity-100 focus-visible:opacity-100 transition-opacity"
                    />
                  }
                  onClick={(e) => e.stopPropagation()}
                />
              }
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Group options</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent align="start" sideOffset={4}>
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
          <DropdownMenuItem onClick={() => handleHide()}>
            <EyeOff className="h-3.5 w-3.5" />
            Hide group
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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

      {/* Deleting a group deletes its categories, so it needs the same
          destination picker they do — the server refuses a delete that would
          drop their budget history. */}
      <BulkDeleteCategoriesDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        categoryCount={categoryCount}
        groupCount={1}
        transactionCount={transactionCount}
        reassignOptions={reassignOptions}
        onConfirm={handleDelete}
        requireReassign={budgetHistoryCount > 0}
      />
    </>
  );
}
