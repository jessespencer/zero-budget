"use client";

import { useState, useRef, useEffect, useTransition, useCallback, useMemo } from "react";
import Sortable from "sortablejs";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { CategoryRow, type SelectCategoryOptions } from "./category-row";
import { CategoryGroupMenu } from "./category-group-menu";
import { SelectCheckbox } from "./select-checkbox";
import { addCategory, deleteCategory, renameCategoryGroup } from "@/app/(app)/budget/actions";
import { clientId } from "@/lib/client-id";
import { useToast } from "@/components/ui/toast";
import type { Account, CategoryGroupWithCategories, CategoryWithBudget } from "@/lib/types";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";
import type { ReassignOption } from "./bulk-delete-categories-dialog";

export type DragEndEvent = {
  itemId: string;
  itemName: string;
  fromGroupId: string;
  toGroupId: string;
  oldIndex: number;
  newIndex: number;
};

type CategoryGroupRowProps = {
  group: CategoryGroupWithCategories;
  categories: CategoryWithBudget[];
  month: string;
  expanded: boolean;
  onToggle: (groupId: string, altKey: boolean) => void;
  onSelectCategory: (categoryId: string, options?: SelectCategoryOptions) => void;
  onMutate: (entry: MutationEntry) => MutationId;
  undoEntry: (id: MutationId) => void;
  // Every non-system category; CategoryMenu's delete dialog needs it as a
  // destination list and filters out the row's own category.
  reassignOptions: ReassignOption[];
  onDragEnd: (evt: DragEndEvent) => void;
  isFirst: boolean;
  isLast: boolean;
  accounts: Account[];
  selectedIds: Set<string>;
  // The category open in the side panel, if any.
  openCategoryId: string | null;
  // Whether this group itself is checked (header checkbox). Distinct from its
  // children being selected — an empty group can be selected with no children.
  isGroupSelected: boolean;
  onToggleSelection: (
    categoryId: string,
    options?: {
      withShift: boolean;
      groupCategoryIds: string[];
      groupId?: string;
    }
  ) => void;
  onToggleGroupSelection: (groupId: string, childIds: string[]) => void;
  // Other (non-system) groups a category in THIS group can be moved to —
  // pure pass-through to CategoryRow. Pre-filtered by BudgetTable.
  otherGroups: { id: string; name: string }[];
  onMoveToGroup: (
    categoryId: string,
    targetGroupId: string,
    categoryName: string
  ) => void;
  // All visible categories across all groups (in display order). Threaded
  // down to each CategoryRow as `siblingDestinations` for the move-money
  // popover. CategoryRow filters out its own category at the leaf to keep
  // this prop stable.
  allDestinations: { id: string; name: string; groupName: string }[];
  closeSidePanel?: () => void;
};

export function CategoryGroupRow({
  group,
  categories,
  month,
  expanded,
  onToggle,
  onSelectCategory,
  onMutate,
  undoEntry,
  onDragEnd,
  isFirst,
  isLast,
  accounts,
  selectedIds,
  openCategoryId,
  isGroupSelected,
  onToggleSelection,
  onToggleGroupSelection,
  otherGroups,
  onMoveToGroup,
  reassignOptions,
  allDestinations,
  closeSidePanel,
}: CategoryGroupRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const addCatRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();
  const fmt = useMaskedCurrency();
  const { toast } = useToast();

  // Ref to keep onDragEnd callback fresh without recreating the sortable
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const sortableInstanceRef = useRef<Sortable | null>(null);

  const groupCategoryIds = useMemo(
    () => categories.map((c) => c.id),
    [categories]
  );

  const handleToggleSelection = useCallback(
    (categoryId: string, withShift: boolean) => {
      onToggleSelection(categoryId, {
        withShift,
        groupCategoryIds,
        groupId: group.id,
      });
    },
    [onToggleSelection, groupCategoryIds, group.id]
  );

  const groupSelectedCount = useMemo(
    () => groupCategoryIds.filter((id) => selectedIds.has(id)).length,
    [groupCategoryIds, selectedIds]
  );
  // The header checkbox selects the group itself (checked), so a single delete
  // takes the group and its children. It reads as indeterminate when the group
  // isn't fully selected but some of its children are individually checked.
  // Group selection is always explicit — checking this box — never inferred
  // from "all children happen to be selected", so it can't delete a group by
  // surprise.
  const groupAllSelected = isGroupSelected;
  const groupIndeterminate = !isGroupSelected && groupSelectedCount > 0;

  // Callback ref: creates/destroys sortable when the container mounts/unmounts
  const sortableCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (sortableInstanceRef.current) {
      sortableInstanceRef.current.destroy();
      sortableInstanceRef.current = null;
    }

    if (node) {
      sortableInstanceRef.current = Sortable.create(node, {
        group: "budget-categories",
        animation: 150,
        fallbackOnBody: true,
        swapThreshold: 0.65,
        invertSwap: true,
        ghostClass: "opacity-30",
        onEnd: (evt) => {
          const { item, from, to, oldIndex, newIndex } = evt;
          if (oldIndex == null || newIndex == null) return;

          // Revert DOM — let React handle rendering from state
          if (from !== to) {
            to.removeChild(item);
            from.insertBefore(item, from.children[oldIndex] || null);
          } else {
            from.removeChild(item);
            from.insertBefore(item, from.children[oldIndex] || null);
          }

          onDragEndRef.current({
            itemId: item.dataset.id!,
            itemName: item.dataset.name!,
            fromGroupId: from.dataset.groupId!,
            toGroupId: to.dataset.groupId!,
            oldIndex,
            newIndex,
          });
        },
      });
    }
  }, []);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    if (addingCategory) addCatRef.current?.focus();
  }, [addingCategory]);

  const saveRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== group.name) {
      const oldName = group.name;
      startTransition(async () => {
        try {
          await renameCategoryGroup(group.id, trimmed);
          onMutate({
            label: `Rename "${oldName}" to "${trimmed}"`,
            forward: () => renameCategoryGroup(group.id, trimmed),
            backward: () => renameCategoryGroup(group.id, oldName),
          });
        } catch {
          setRenameValue(oldName);
          toast({
            message: `Couldn't rename "${oldName}".`,
            variant: "error",
          });
        }
      });
    } else {
      setRenameValue(group.name);
    }
    setRenaming(false);
  };

  const saveNewCategory = () => {
    const trimmed = newCatName.trim();
    if (trimmed) {
      // Generate the id up front so forward/backward target the same row
      // across undo→redo→undo cycles.
      const categoryId = clientId();
      startTransition(async () => {
        try {
          await addCategory(group.id, trimmed, categoryId);
          onMutate({
            label: `Add "${trimmed}"`,
            forward: () => addCategory(group.id, trimmed, categoryId).then(() => {}),
            backward: async () => {
              await deleteCategory(categoryId);
            },
          });
        } catch {
          // The row never appears on failure, so there is nothing on screen to
          // contradict — but also nothing to explain the click doing nothing.
          toast({
            message: `Couldn't add "${trimmed}".`,
            variant: "error",
          });
        }
      });
    }
    setNewCatName("");
    setAddingCategory(false);
  };

  const childrenId = `budget-group-${group.id}-children`;

  return (
    <div
      role="rowgroup"
      aria-label={group.name}
      className="border-b border-border/50 bg-card group/group-row relative"
      data-budget-group={group.id}
    >
      {/* Group header.

          Plain non-interactive container — was previously role="button"
          tabIndex=0 wrapping nested interactives (checkbox, add button,
          kebab menu), which axe flagged as nested-interactive +
          no-focusable-content (260511-jlp). Keyboard expand/collapse now
          lives on the chevron button below. The onClick stays as a
          mouse convenience so clicking the row name or empty space still
          toggles — but the semantic affordance is the chevron button. */}
      <div
        role="row"
        onClick={(e) => onToggle(group.id, e.altKey)}
        className="w-full grid grid-cols-[minmax(256px,1fr)_120px_120px_120px] items-center pl-1 pr-6 h-14 bg-accent/40 border-b border-border/50 text-[13px] font-extrabold cursor-pointer"
      >
        {/* First-column wrapper is the row's rowheader. aria-label scopes
            the announcement to the group name (without it, SR would dump
            the chevron button label, checkbox label, add-button tooltip
            and kebab menu copy into the row header name). Putting the
            rowheader role here (vs. on the inner <h2>) is also required
            by axe `aria-required-children` — the inner interactive
            buttons/inputs must NOT be direct semantic children of
            role="row". This mirrors the same pattern in CategoryRow. */}
        <div
          role="rowheader"
          aria-label={group.name}
          className="flex items-center gap-1 text-left min-w-0"
        >
          <div
            data-group-handle
            className="shrink-0 opacity-0 group-hover/group-row:opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-0.5 -mr-0.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <GripVertical
              aria-hidden="true"
              className="h-3.5 w-3.5 text-foreground/30"
            />
          </div>
          {/* Real <button> so Space/Enter toggle naturally; aria-expanded
              and aria-controls give the SR the relationship to the
              children region. Hold Alt to expand/collapse all groups —
              the parent onToggle reads altKey from the event. */}
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={childrenId}
            aria-label={`Toggle ${group.name} group`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(group.id, e.altKey);
            }}
            className="shrink-0 inline-flex items-center justify-center h-3.5 w-3.5 cursor-pointer"
          >
            <ChevronRight
              data-budget-group-chevron
              className={cn(
                "h-3.5 w-3.5 text-foreground/90 transition-transform duration-150",
                expanded && "rotate-90"
              )}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
          <div
            className="shrink-0 h-3.5 w-3.5 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <SelectCheckbox
              checked={groupAllSelected}
              indeterminate={groupIndeterminate}
              onClick={(e) => {
                e.stopPropagation();
                onToggleGroupSelection(group.id, groupCategoryIds);
              }}
              ariaLabel={`Select group ${group.name}`}
            />
          </div>
          {/* Wrap name + count badge so the name truncates while the
              badge stays glued. min-w-0 (no flex-1) so the wrapper takes
              content width — keeps the +/menu icons next to the badge
              instead of pushing them to the right edge of the column. */}
          <div className="flex items-center gap-1.5 min-w-0">
            {renaming ? (
              <input
                ref={renameRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={saveRename}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") saveRename();
                  if (e.key === "Escape") {
                    setRenameValue(group.name);
                    setRenaming(false);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="ml-1 text-base font-semibold text-foreground/90 bg-transparent border-b border-primary outline-none w-auto"
              />
            ) : (
              // Was previously <h2 role="rowheader">. The rowheader role
              // moved to the parent first-column wrapper (which is what
              // axe `aria-required-children` requires — interactive
              // descendants of the row need to be inside a semantic
              // child like rowheader / cell, not floating directly inside
              // role="row"). Switched <h2> → <div> so the heading rotor
              // doesn't expose every group name as a top-level page
              // heading — same outcome the plan intended when it asked
              // for the heading role to be overridden.
              <div className="ml-1 text-base text-foreground/90 truncate min-w-0">
                {group.name}
              </div>
            )}
            <Badge className="shrink-0 tabular-nums">{group.categories.length}</Badge>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 opacity-0 group-hover/group-row:opacity-100 focus-visible:opacity-100 transition-opacity ml-1"
                    aria-label={`Add category to ${group.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddingCategory(true);
                      if (!expanded) onToggle(group.id, false);
                    }}
                  />
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>Add category</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <CategoryGroupMenu
            groupId={group.id}
            groupName={group.name}
            categoryCount={group.categories.length}
            month={month}
            isFirst={isFirst}
            isLast={isLast}
            onRenameStart={() => {
              setRenameValue(group.name);
              setRenaming(true);
            }}
            onMutate={onMutate}
            // This group's own categories go with it, so they can't be
            // destinations for its transactions or budget history.
            reassignOptions={reassignOptions.filter(
              (o) => !groupCategoryIds.includes(o.id)
            )}
            closeSidePanel={closeSidePanel}
          />
        </div>
        {/* Group total cells. No aria-labelledby — column → cell
            association is positional via the ARIA table model. */}
        <span role="cell" className="text-right tabular-nums zero-amount text-muted-foreground">
          {fmt(group.groupAssigned)}
        </span>
        <span role="cell" className="text-right tabular-nums zero-amount text-muted-foreground">
          {fmt(group.groupActivity)}
        </span>
        <span role="cell" className="text-right tabular-nums zero-amount text-muted-foreground">
          {fmt(group.groupAvailable)}
        </span>
      </div>

      {/* Category rows. Wrapper always rendered so the chevron button's
          aria-controls reference resolves; `hidden` toggles via the
          `expanded` prop so SRs see it as collapsed correctly. */}
      <div
        id={childrenId}
        className="min-h-[2px]"
        data-budget-group-children
        hidden={!expanded}
      >
        {expanded && (
          <>
          {categories.length === 0 && !addingCategory && (
            <div className="grid grid-cols-[minmax(256px,1fr)_120px_120px_120px] items-center pl-1 pr-6 h-10">
              <div className="flex items-center gap-1 h-full">
                <div className="shrink-0 p-0.5 -mr-0.5"><div className="h-3.5 w-3.5" /></div>
                <div className="shrink-0 h-3.5 w-3.5" aria-hidden="true" />
                <div className="shrink-0 h-3.5 w-3.5" aria-hidden="true" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingCategory(true);
                  }}
                  className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  + Add budget item
                </button>
              </div>
            </div>
          )}
          {addingCategory && (
            <div className="grid grid-cols-[minmax(256px,1fr)_120px_120px_120px] items-center pl-1 pr-6 h-10">
              <div className="flex items-center gap-1">
                <div className="shrink-0 p-0.5 -mr-0.5"><div className="h-3.5 w-3.5" /></div>
                <div className="shrink-0 h-3.5 w-3.5" aria-hidden="true" />
                <div className="shrink-0 h-3.5 w-3.5" aria-hidden="true" />
                <input
                  ref={addCatRef}
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onBlur={saveNewCategory}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveNewCategory();
                    if (e.key === "Escape") {
                      setNewCatName("");
                      setAddingCategory(false);
                    }
                  }}
                  placeholder="Category name"
                  className="text-[13px] text-foreground/75 bg-input px-2 py-0.5 rounded-md border border-ring/30 outline-none focus:ring-2 focus:ring-ring/40 w-full placeholder:text-muted-foreground/30"
                />
              </div>
            </div>
          )}
          <div ref={sortableCallbackRef} data-group-id={group.id}>
            {categories.map((cat, idx) => (
              <div key={cat.id} data-id={cat.id} data-name={cat.name}>
                <CategoryRow
                  category={cat}
                  month={month}
                  groupId={group.id}
                  onSelect={onSelectCategory}
                  onMutate={onMutate}
                  undoEntry={undoEntry}
                  isFirst={idx === 0}
                  isLast={idx === categories.length - 1}
                  accounts={accounts}
                  isSelected={selectedIds.has(cat.id)}
                  isOpen={cat.id === openCategoryId}
                  onToggleSelection={handleToggleSelection}
                  otherGroups={otherGroups}
                  onMoveToGroup={onMoveToGroup}
                  reassignOptions={reassignOptions}
                  siblingDestinations={allDestinations}
                  closeSidePanel={closeSidePanel}
                />
              </div>
            ))}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
