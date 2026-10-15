"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { GripVertical } from "lucide-react";
import { Currency } from "@/components/shared/currency";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { AssignInput } from "./assign-input";
import { CategoryMenu } from "./category-menu";
import { AvailablePill, isUnderfunded } from "./available-pill";
import { SelectCheckbox } from "./select-checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TruncatedText } from "@/components/shared/truncated-text";
import { CHECKED_ROW_CLASS, OPEN_ROW_CLASS } from "@/lib/row-classes";
import { renameCategory } from "@/app/(app)/budget/actions";
import { useToast } from "@/components/ui/toast";
import type { Account, CategoryWithBudget } from "@/lib/types";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";
import type { ReassignOption } from "./bulk-delete-categories-dialog";

/** `openDrawer: false` selects the category without opening the narrow-width drawer. */
export type SelectCategoryOptions = { openDrawer?: boolean };

type CategoryRowProps = {
  category: CategoryWithBudget;
  month: string;
  groupId: string;
  onSelect: (categoryId: string, options?: SelectCategoryOptions) => void;
  // Returns the pushed entry's id so descendants can wire a toast's Undo to
  // that specific action. Passed straight through from budget-table's
  // `pushMutation`, which has always returned one.
  onMutate: (entry: MutationEntry) => MutationId;
  // Threaded to the move-money popover so its success toast can undo *that*
  // move rather than whatever is on top of the stack.
  undoEntry: (id: MutationId) => void;
  // Every non-system category; CategoryMenu's delete dialog needs it as a
  // destination list and filters out the row's own category.
  reassignOptions: ReassignOption[];
  isFirst: boolean;
  isLast: boolean;
  accounts: Account[];
  isSelected: boolean;
  // Open in the side panel — distinct from isSelected (the bulk checkbox).
  isOpen: boolean;
  onToggleSelection: (categoryId: string, withShift: boolean) => void;
  // Pure pass-through to CategoryMenu — filtered by BudgetTable.
  otherGroups: { id: string; name: string }[];
  onMoveToGroup: (
    categoryId: string,
    targetGroupId: string,
    categoryName: string
  ) => void;
  // Every visible category in the current month EXCLUDING this row's own
  // category — destinations for the move-money popover. Pre-grouped/sorted
  // by BudgetTable; CategoryRow filters out the source id at the leaf to
  // keep the parent prop stable across rows.
  siblingDestinations: { id: string; name: string; groupName: string }[];
  closeSidePanel?: () => void;
};

export function CategoryRow({
  category,
  month,
  groupId,
  onSelect,
  onMutate,
  undoEntry,
  isFirst,
  isLast,
  accounts,
  isSelected,
  isOpen,
  onToggleSelection,
  otherGroups,
  onMoveToGroup,
  reassignOptions,
  siblingDestinations,
  closeSidePanel,
}: CategoryRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(category.name);
  const renameRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();
  const fmt = useMaskedCurrency();
  const { toast } = useToast();

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  const saveRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== category.name) {
      const oldName = category.name;
      startTransition(async () => {
        try {
          await renameCategory(category.id, trimmed);
          // After the rename lands — pushing alongside an un-awaited call left
          // an undo entry that would rename a category the server never
          // renamed.
          onMutate({
            label: `Rename "${oldName}" to "${trimmed}"`,
            forward: () => renameCategory(category.id, trimmed),
            backward: () => renameCategory(category.id, oldName),
          });
        } catch {
          // No success toast — the row shows the new name. On failure the row
          // snaps back, which needs saying out loud.
          setRenameValue(oldName);
          toast({
            message: `Couldn't rename "${oldName}".`,
            variant: "error",
          });
        }
      });
    } else {
      setRenameValue(category.name);
    }
    setRenaming(false);
  };

  return (
    <div
        role="row"
        aria-current={isOpen ? "true" : undefined}
        className={cn(
          "grid grid-cols-[minmax(256px,1fr)_120px_120px_120px] items-center pl-1 pr-6 h-10 bg-card hover:bg-accent/30 text-[14px] transition-colors group/cat-row cursor-pointer border-b border-border/70",
          isSelected && !isOpen && CHECKED_ROW_CLASS,
          isOpen && OPEN_ROW_CLASS
        )}
        onClick={() => onSelect(category.id)}
      >
        {/* First-column wrapper acts as the row's rowheader. aria-label
            scopes the rowheader's accessible name to the category name
            (without it, SR would dump the drag handle + checkbox label
            + target/buffer pills + kebab menu copy into the row header
            announcement). The inner interactive descendants stay
            operable via Tab. */}
        <div
          role="rowheader"
          aria-label={category.name}
          className="flex items-center gap-1 min-w-0"
        >
        <span className="shrink-0 opacity-0 group-hover/cat-row:opacity-40 transition-opacity p-0.5 -mr-0.5">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </span>
        {/* Chevron-width spacer so the checkbox column aligns with the
            group-row checkbox (which sits to the right of its chevron). */}
        <div className="shrink-0 h-3.5 w-3.5" aria-hidden="true" />
        <div
          className="shrink-0 h-3.5 w-3.5 flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
          data-bulk-checkbox
        >
          <SelectCheckbox
            checked={isSelected}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelection(category.id, e.shiftKey);
            }}
            ariaLabel={`Select ${category.name}`}
          />
        </div>
        {/* Wrap name + pills together so the name truncates while the
            pills stay glued to it. Without this wrapper, name (shrink:1)
            collapses to 0 while pills (shrink:0) keep their full width.
            No flex-1: keep the wrapper at content width so the hover
            menu sits right next to the pills instead of floating at
            the right edge of the column. */}
        <div className="flex items-center gap-1.5 min-w-0">
          {renaming ? (
            <input
              ref={renameRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={saveRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
                if (e.key === "Escape") {
                  setRenameValue(category.name);
                  setRenaming(false);
                }
              }}
              className="text-[14px] text-foreground/75 bg-input ml-1 px-2 py-0.5 rounded-md border border-ring/30 outline-none focus:ring-2 focus:ring-ring/40 w-full"
            />
          ) : (
            <TruncatedText className="ml-1 text-foreground/80 group-hover/cat-row:text-foreground/90 transition-colors text-left">
              {category.name}
            </TruncatedText>
          )}
          {category.target && !renaming && (() => {
            const t = category.target;
            const underfunded = isUnderfunded(category.available, category.assigned, category.cumulative_assigned, t);
            const formatted = fmt(t.target_amount);
            let label: string;
            if (t.target_date) {
              const [y, m] = t.target_date.split("-").map(Number);
              const byDate = new Date(y, m - 1, 1).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              });
              label = `${formatted} by ${byDate}`;
            } else if (t.type === "monthly_funding") {
              label = `${formatted}/mo`;
            } else if (t.type === "spending") {
              label = `Cap ${formatted}`;
            } else {
              label = `${formatted} goal`;
            }
            return (
              <Badge
                intent={underfunded ? "warning" : "positive"}
                className="shrink-0 tabular-nums zero-amount"
              >
                {label}
              </Badge>
            );
          })()}
          {category.is_buffer && !renaming && (
            <Badge intent="neutral" className="shrink-0" aria-label="Buffer category">
              Buffer
            </Badge>
          )}
        </div>
        <CategoryMenu
          categoryId={category.id}
          categoryName={category.name}
          groupId={groupId}
          month={month}
          isFirst={isFirst}
          isLast={isLast}
          onRenameStart={() => {
            setRenameValue(category.name);
            setRenaming(true);
          }}
          onMutate={onMutate}
          accounts={accounts}
          category={category}
          otherGroups={otherGroups}
          reassignOptions={reassignOptions}
          onMoveToGroup={(targetGroupId) =>
            onMoveToGroup(category.id, targetGroupId, category.name)
          }
          closeSidePanel={closeSidePanel}
        />
      </div>
      {/* Numeric cells. role="cell" only (no aria-labelledby) — column
          association is positional via the ARIA table model. Interactive
          descendants (AssignInput, AvailablePill button) are allowed
          inside role="cell" because we chose role="table", not
          role="grid". */}
      <div role="cell" className="text-right" onClick={(e) => e.stopPropagation()}>
        <AssignInput
          categoryId={category.id}
          categoryName={category.name}
          month={month}
          value={category.assigned}
          onMutate={onMutate}
          onSelect={() => onSelect(category.id, { openDrawer: false })}
        />
      </div>
      <div role="cell" className="text-right tabular-nums text-foreground/80">
        {category.activity !== 0 ? (
          <Currency amount={category.activity} colorize={false} smallCents={false} />
        ) : (
          "—"
        )}
      </div>
      <div
        role="cell"
        className="flex justify-end"
        onClick={(e) => e.stopPropagation()}
      >
        <AvailablePill
          available={category.available}
          assigned={category.assigned}
          cumulativeAssigned={category.cumulative_assigned}
          target={category.target}
          categoryId={category.id}
          categoryName={category.name}
          month={month}
          destinations={siblingDestinations.filter((d) => d.id !== category.id)}
          onMutate={onMutate}
          undoEntry={undoEntry}
        />
      </div>
    </div>
  );
}
