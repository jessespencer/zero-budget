"use client";

import { useState, useTransition } from "react";
import { ChevronRight, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectCheckbox } from "./select-checkbox";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  unarchiveCategoryWithSnapshot,
  restoreUnarchiveCategorySnapshot,
  unarchiveGroupWithSnapshot,
  restoreUnarchiveGroupSnapshot,
} from "@/app/(app)/budget/actions";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";
import type { CategoryWithBudget, CategoryGroupWithCategories } from "@/lib/types";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";

// Shared grid so every row aligns with the live budget grid: name column +
// assigned / activity / available (we only fill available here).
const GRID = "grid grid-cols-[minmax(256px,1fr)_120px_120px_120px] items-center pl-1 pr-6 h-10";

// Leading slots mirroring CategoryRow / CategoryGroupRow exactly (grip slot +
// chevron-or-spacer + checkbox slot) so hidden rows line up to the pixel with
// the non-hidden grid. `chevron` fills the chevron slot for group headers;
// categories pass nothing and get a matching spacer.
function RowLead({
  chevron,
  checkbox,
}: {
  chevron?: React.ReactNode;
  checkbox?: React.ReactNode;
}) {
  return (
    <>
      {/* grip slot (always reserved on real rows, revealed on hover) */}
      <span className="shrink-0 p-0.5 -mr-0.5" aria-hidden="true">
        <span className="block h-3.5 w-3.5" />
      </span>
      {/* chevron slot */}
      {chevron ?? <span className="shrink-0 h-3.5 w-3.5" aria-hidden="true" />}
      {/* checkbox slot */}
      {checkbox ? (
        <span
          className="shrink-0 h-3.5 w-3.5 flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {checkbox}
        </span>
      ) : (
        <span className="shrink-0 h-3.5 w-3.5" aria-hidden="true" />
      )}
    </>
  );
}

type HiddenCategoriesSectionProps = {
  // Individually-hidden categories whose group is still visible.
  categories: CategoryWithBudget[];
  // Whole hidden groups, rendered as collapsible group rows under "Hidden".
  groups: CategoryGroupWithCategories[];
  // groupId -> name lookup for individually-hidden categories so we can show
  // the (still-visible) parent group as inline context next to the cat name.
  groupNamesById?: Map<string, string>;
  // Threaded for parity with the rest of the grid; unhide is a flag-only flip
  // (no balance change) so it does not need the month.
  month: string;
  // Returns the id of the pushed entry so the toast's Undo can target *that*
  // action rather than whatever is on top of the stack six seconds later.
  // budget-table already passes `pushMutation`, which has always returned one.
  onMutate: (entry: MutationEntry) => MutationId;
  // Bulk-selection (drives the floating Unhide toolbar). Only hidden GROUP rows
  // and flat individually-hidden CATEGORY rows are selectable — categories
  // nested inside a hidden group can't be unhidden on their own.
  selectedGroupIds: Set<string>;
  selectedCategoryIds: Set<string>;
  onToggleGroup: (groupId: string) => void;
  onToggleCategory: (categoryId: string) => void;
};

// A collapsed-by-default "Hidden" section at the bottom of the budget grid.
// "Hidden" is a thin centered divider label; under it, hidden groups render as
// real (muted) collapsible group rows aligned with the live grid, and
// individually-hidden categories render as flat rows with their own unhide.
export function HiddenCategoriesSection({
  categories,
  groups,
  groupNamesById,
  onMutate,
  selectedGroupIds,
  selectedCategoryIds,
  onToggleGroup,
  onToggleCategory,
}: HiddenCategoriesSectionProps) {
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const childrenId = "hidden-group-children";
  const { toast } = useToast();
  // The undo stack is a module singleton, so this reaches the same stack
  // budget-table pushes to — no need to thread undoEntry down as a prop.
  const { undoEntry } = useUndoRedo();

  // Unhide lands the row back in its group up the page, usually scrolled well
  // above the Hidden section the click happened in — the effect is off-screen,
  // which CLAUDE.md's table answers with a toast.
  const handleUnhideGroup = (group: CategoryGroupWithCategories) => {
    startTransition(async () => {
      try {
        const snapshot = await unarchiveGroupWithSnapshot(group.id);
        const entryId = onMutate({
          label: `Unhide "${group.name}"`,
          forward: async () => {
            await unarchiveGroupWithSnapshot(group.id);
          },
          backward: async () => {
            await restoreUnarchiveGroupSnapshot(snapshot);
          },
        });
        toast({
          message: `Unhid group "${group.name}"`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        toast({
          message: `Couldn't unhide "${group.name}". Nothing was changed.`,
          variant: "error",
        });
      }
    });
  };

  const handleUnhideCategory = (categoryId: string, categoryName: string) => {
    startTransition(async () => {
      try {
        const snapshot = await unarchiveCategoryWithSnapshot(categoryId);
        const entryId = onMutate({
          label: `Unhide "${categoryName}"`,
          forward: async () => {
            await unarchiveCategoryWithSnapshot(categoryId);
          },
          backward: async () => {
            await restoreUnarchiveCategorySnapshot(snapshot);
          },
        });
        toast({
          message: `Unhid "${categoryName}"`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        toast({
          message: `Couldn't unhide "${categoryName}". Nothing was changed.`,
          variant: "error",
        });
      }
    });
  };

  // Count = every hidden category, whether hidden as part of a group or
  // individually.
  const totalHidden =
    groups.reduce((n, g) => n + g.categories.length, 0) + categories.length;

  return (
    <div>
      {/* "Hidden" — a centered divider label (no chevron, no heavy bg). The
          whole row toggles the section; it's a real button for keyboard use. */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={childrenId}
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 h-9 px-3 cursor-pointer select-none"
      >
        <span className="flex-1 h-px bg-border/60" aria-hidden="true" />
        <span className="inline-flex items-center gap-2 px-2 py-1 rounded-md transition-colors hover:bg-foreground/5 hover:text-foreground">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Hidden
          </span>
          <span className="text-[10px] text-muted-foreground/80 font-medium tabular-nums">
            {totalHidden}
          </span>
        </span>
        <span className="flex-1 h-px bg-border/60" aria-hidden="true" />
      </button>

      <div id={childrenId} hidden={!expanded}>
        {/* Hidden groups — collapsible (muted) group rows. */}
        {groups.map((group) => (
          <HiddenGroupBlock
            key={group.id}
            group={group}
            selected={selectedGroupIds.has(group.id)}
            onToggleSelect={() => onToggleGroup(group.id)}
            onUnhide={() => handleUnhideGroup(group)}
          />
        ))}

        {/* Individually-hidden categories — flat rows, with the (still-visible)
            parent group rendered inline as a faint breadcrumb so the user can
            see which group a hidden category will return to on unhide, without
            implying the parent group itself is hidden. */}
        {categories.map((cat) => (
          <FlatHiddenCategoryRow
            key={cat.id}
            cat={cat}
            parentName={groupNamesById?.get(cat.category_group_id)}
            selected={selectedCategoryIds.has(cat.id)}
            onToggle={() => onToggleCategory(cat.id)}
            onUnhide={() => handleUnhideCategory(cat.id, cat.name)}
          />
        ))}
      </div>
    </div>
  );
}

// A single individually-hidden category row. When `parentName` is supplied, an
// inline faint breadcrumb renders before the category name so the user knows
// which still-visible group the category will return to on unhide.
function FlatHiddenCategoryRow({
  cat,
  parentName,
  selected,
  onToggle,
  onUnhide,
}: {
  cat: CategoryWithBudget;
  parentName?: string;
  selected: boolean;
  onToggle: () => void;
  onUnhide: () => void;
}) {
  const fmt = useMaskedCurrency();
  return (
    <div
      className={cn(GRID, "hover:bg-accent/30 text-[14px] border-b border-border/70 group/hidden-row")}
    >
      <div className="flex items-center gap-1 min-w-0">
        <RowLead
          checkbox={
            <SelectCheckbox
              checked={selected}
              onClick={onToggle}
              ariaLabel={`Select ${cat.name}`}
            />
          }
        />
        <div className="ml-1 flex items-center gap-1 min-w-0">
          {parentName && (
            <>
              <span className="shrink truncate min-w-0 text-foreground/45 text-[13px]">
                {parentName}
              </span>
              <ChevronRight
                className="shrink-0 h-3 w-3 text-foreground/40"
                strokeWidth={2}
                aria-hidden="true"
              />
            </>
          )}
          <span className="truncate text-foreground/80">{cat.name}</span>
        </div>
        <UnhideButton
          label={`Unhide ${cat.name}`}
          tooltip="Unhide category"
          hoverScope="group-hover/hidden-row:opacity-100"
          onClick={onUnhide}
        />
      </div>
      <span />
      <span />
      <span className="text-right tabular-nums zero-amount text-foreground/80">
        {fmt(cat.available)}
      </span>
    </div>
  );
}

// A hidden group: a muted, collapsible group row (its own chevron) aligned with
// the live group rows, with its categories listed beneath when expanded.
function HiddenGroupBlock({
  group,
  selected,
  onToggleSelect,
  onUnhide,
}: {
  group: CategoryGroupWithCategories;
  selected: boolean;
  onToggleSelect: () => void;
  onUnhide: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const childrenId = `hidden-grp-${group.id}`;

  return (
    <div className="group/hidden-grp">
      <div
        role="row"
        onClick={() => setExpanded((v) => !v)}
        className={cn(GRID, "bg-accent/40 text-[13px] font-semibold hover:bg-accent/50 cursor-pointer")}
      >
        <div className="flex items-center gap-1 min-w-0">
          <RowLead
            chevron={
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={childrenId}
                aria-label={`Toggle ${group.name} group`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                className="shrink-0 inline-flex items-center justify-center h-3.5 w-3.5 cursor-pointer"
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 text-foreground/70 transition-transform duration-150",
                    expanded && "rotate-90"
                  )}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>
            }
            checkbox={
              <SelectCheckbox
                checked={selected}
                onClick={onToggleSelect}
                ariaLabel={`Select group ${group.name}`}
              />
            }
          />
          <span className="ml-1 text-base text-foreground/70 truncate min-w-0">
            {group.name}
          </span>
          <CountBadge n={group.categories.length} />
          <UnhideButton
            label={`Unhide group ${group.name}`}
            tooltip="Unhide group"
            hoverScope="group-hover/hidden-grp:opacity-100"
            onClick={onUnhide}
          />
        </div>
      </div>

      <div id={childrenId} hidden={!expanded}>
        {group.categories.map((cat) => (
          <CategoryLine key={cat.id} name={cat.name} available={cat.available} />
        ))}
      </div>
    </div>
  );
}

function CountBadge({ n }: { n: number }) {
  return <Badge className="shrink-0 tabular-nums">{n}</Badge>;
}

// Display-only category line under a hidden group (no unhide — the category has
// no visible group to live under until the whole group is unhidden). Aligns
// with the non-hidden categories via the shared RowLead.
function CategoryLine({ name, available }: { name: string; available: number }) {
  const fmt = useMaskedCurrency();
  return (
    <div className={cn(GRID, "hover:bg-accent/30 text-[14px] border-b border-border/70")}>
      <div className="flex items-center gap-1 min-w-0">
        <RowLead />
        <span className="ml-1 text-foreground/80 truncate min-w-0">{name}</span>
      </div>
      <span />
      <span />
      <span className="text-right tabular-nums zero-amount text-foreground/80">
        {fmt(available)}
      </span>
    </div>
  );
}

function UnhideButton({
  label,
  tooltip,
  hoverScope,
  onClick,
}: {
  label: string;
  tooltip: string;
  hoverScope: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              className={cn("shrink-0 opacity-0 focus-visible:opacity-100 transition-opacity", hoverScope)}
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
            />
          }
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
