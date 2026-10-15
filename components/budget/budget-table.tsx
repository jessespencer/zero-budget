"use client";

import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useTransition,
  useRef,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Sortable from "sortablejs";
import type { DragEndEvent } from "./category-group-row";
import {
  ChevronRight,
  CircleCheck,
  FolderPlus,
  LayoutList,
  MoreVertical,
  PanelRight,
  PanelRightClose,
  Plus,
  Receipt,
  Redo2,
  Table2,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { clientId } from "@/lib/client-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { CategoryGroupRow } from "./category-group-row";
import { HiddenCategoriesSection } from "./hidden-categories-section";
import { CategoryDetailPanel } from "./category-detail-panel";
import type { SelectCategoryOptions } from "./category-row";
import { BudgetOverviewPanel } from "./budget-overview-panel";
import { BudgetFilterBar, matchesFilter } from "./budget-filter-bar";
import type { BudgetFilter } from "./budget-filter-bar";
import { BudgetSelectionToolbar } from "./budget-selection-toolbar";
import { BudgetSimpleView } from "./budget-simple-view";
import { BudgetViewToggle } from "./budget-view-toggle";
import {
  persistBudgetView,
  persistOverviewDocked,
  type BudgetView,
} from "./budget-view";
import { SelectCheckbox } from "./select-checkbox";
import { EmptyState } from "@/components/shared/empty-state";
import {
  addCategoryGroup,
  bulkDeleteCategoriesWithSnapshot,
  bulkUpdateCategorySettings,
  bulkUpdateCategorySettingsWithSnapshot,
  deleteCategoryGroup,
  getCategoryDeletionImpact,
  moveCategoryToGroup,
  reorderCategoriesInGroup,
  reorderCategoryGroups,
  restoreCategorySettingsBatch,
  unarchiveCategoryWithSnapshot,
  restoreUnarchiveCategorySnapshot,
  unarchiveGroupWithSnapshot,
  restoreUnarchiveGroupSnapshot,
  type CategoryUnarchiveSnapshot,
  type GroupUnarchiveSnapshot,
} from "@/app/(app)/budget/actions";
import { useUndoRedo } from "@/lib/use-undo-redo";
import { useCategoryRestore } from "./use-category-restore";
import { onAddCategoryGroupRequest } from "./add-group-request";
import type { Account, BudgetMonth, CategoryWithBudget } from "@/lib/types";
import { ToolbarIconButton } from "@/components/shared/toolbar-icon-button";
import {
  BulkDeleteCategoriesDialog,
  type ReassignOption,
} from "./bulk-delete-categories-dialog";

type BudgetTableProps = {
  budget: BudgetMonth;
  accounts: Account[];
  initialView: BudgetView;
  initialOverviewDocked: boolean;
};

const EXPANDED_GROUPS_STORAGE_KEY = "zero:budget:expanded-groups";

// useLayoutEffect on the client (runs sync before paint), useEffect on the
// server (no DOM, just silences React's "useLayoutEffect does nothing on
// the server" warning during the SSR pass).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function BudgetTable({
  budget,
  accounts,
  initialView,
  initialOverviewDocked,
}: BudgetTableProps) {
  // Grid vs. simple. Only meaningful at md+ — below that the simple view is
  // the only one (the grid's fixed columns don't fit a phone), which is
  // handled in CSS so SSR needs no viewport guess.
  const [view, setView] = useState<BudgetView>(initialView);
  const handleViewChange = useCallback((next: BudgetView) => {
    setView(next);
    persistBudgetView(next);
  }, []);
  // Docked overview panel at 1400px+ — the Overview button hides/shows it.
  const [overviewDocked, setOverviewDocked] = useState(initialOverviewDocked);
  const toggleOverviewDocked = useCallback(() => {
    setOverviewDocked((prev) => {
      persistOverviewDocked(!prev);
      return !prev;
    });
  }, []);
  // Default everything to expanded for SSR / initial client render so
  // hydration matches. The persisted preference is applied below.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(budget.groups.map((g) => [g.id, true]))
  );
  const [expandedHydrated, setExpandedHydrated] = useState(false);

  // Hydrate from localStorage once on mount. Known groups inherit the user's
  // stored preference; new/unknown groups stay at their default (expanded).
  // useLayoutEffect (via the isomorphic alias) so the state update lands
  // before the browser's first post-hydration paint — eliminates the
  // post-hydration flash. The pre-hydration flash is suppressed by the
  // inline <script> in budget/page.tsx, which injects a <style> tag with
  // matching `display:none` rules; we tear that style down here once React
  // controls the children DOM directly.
  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Record<string, boolean>;
        setExpandedGroups((prev) =>
          Object.fromEntries(
            Object.keys(prev).map((id) => [id, stored[id] ?? prev[id]])
          )
        );
      }
    } catch {
      // Malformed JSON or storage unavailable — keep defaults.
    }
    setExpandedHydrated(true);
    document.querySelector("style[data-budget-prehydrate]")?.remove();
  }, []);

  // Persist on change. Gated on hydration so we don't clobber the stored
  // value with the all-expanded default before we've read it.
  useEffect(() => {
    if (!expandedHydrated) return;
    try {
      window.localStorage.setItem(
        EXPANDED_GROUPS_STORAGE_KEY,
        JSON.stringify(expandedGroups),
      );
    } catch {
      // Quota exceeded / private mode / disabled storage — ignore.
    }
  }, [expandedGroups, expandedHydrated]);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // All category ids in the current budget — used to validate URL-supplied
  // ids so a stale link doesn't try to render a missing category.
  const allCategoryIds = useMemo(
    () => new Set(budget.groups.flatMap((g) => g.categories).map((c) => c.id)),
    [budget]
  );

  // Visible group name lookup — surfaced under individually-hidden categories
  // in the Hidden section so the user can see which (still-visible) group an
  // orphaned hidden category belongs to.
  const visibleGroupNamesById = useMemo(
    () => new Map(budget.groups.map((g) => [g.id, g.name])),
    [budget.groups]
  );

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null
  );

  // Hydrate the selection from `?category=<id>` on mount. If the id is
  // present but unknown to this budget, strip it from the URL so we don't
  // keep a dangling param. Run-once: fighting our own writes below would
  // create a loop.
  useEffect(() => {
    const fromUrl = searchParams?.get("category") ?? null;
    if (fromUrl && allCategoryIds.has(fromUrl)) {
      setSelectedCategoryId(fromUrl);
    } else if (fromUrl && !allCategoryIds.has(fromUrl)) {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      next.delete("category");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single helper that updates state AND URL together. Uses URLSearchParams
  // so other params (e.g. ?month=) survive. router.replace (NOT push) so
  // clicking through categories doesn't pollute browser history; { scroll:
  // false } prevents the table jumping to the top on each click.
  const handleSelectCategory = useCallback(
    (id: string | null, { openDrawer = true }: SelectCategoryOptions = {}) => {
      setSelectedCategoryId(id);
      // Auto-open the drawer when a category is picked at narrow widths so
      // the user actually sees the detail panel they just clicked into.
      // No-op above 1400px because the panel is already visible inline.
      // The assign cell opts out: opening the drawer moves focus into it (it's
      // non-modal now, but still takes focus on open), so the input the user
      // just opened would close before a keystroke.
      if (id && openDrawer) setPanelOpen(true);
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      if (id) {
        next.set("category", id);
      } else {
        next.delete("category");
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const [activeFilter, setActiveFilter] = useState<BudgetFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  useEffect(() => onAddCategoryGroupRequest(() => setDialogOpen(true)), []);
  // Drawer state for the side panel below 1400px. At 1400px+ the panel is always
  // visible inline (CSS-driven); this flag only matters at narrow widths.
  const [panelOpen, setPanelOpen] = useState(false);
  // Track viewport so we can keep the Sheet drawer fully closed at wide widths.
  // SheetContent is display:none at >=1400px, but the SheetOverlay is rendered
  // in a sibling portal and would still paint a blurred backdrop if we let
  // open=true through. Gating the open prop here is the cleanest way to
  // suppress the overlay above the breakpoint.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1399.98px)");
    setIsNarrow(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const [, startTransition] = useTransition();
  const { toast } = useToast();
  // Read by `groupContainerRef`, which is a *callback ref*: anything in its
  // dependency array that changes identity tears down the SortableJS instance
  // and rebuilds it, potentially mid-drag. `toast` is stable today only
  // because ToastProvider wraps it in `useCallback(…, [])` — an invariant
  // nothing enforces. Going through a ref keeps the group's drag handler
  // independent of that, the same way CategoryGroupRow holds `onDragEnd`.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // A rejected undo used to be silent: the hook catches it and puts the entry
  // back on the stack, but Cmd+Z simply appeared to do nothing. That matters
  // here more than elsewhere — deleting a category that still holds assign
  // history is now refused outright (migration 029), and "undo the add" is the
  // path that hits it. The message stays generic on purpose: Next redacts
  // server-action error text in production, so the reason can't be relayed —
  // what's always true, and worth saying, is that nothing moved.
  const {
    push: pushMutation,
    undo,
    undoEntry,
    redo,
    canUndo,
    canRedo,
    isPending,
  } = useUndoRedo({
    onError: ({ action, label }) =>
      toast({
        // No quotes around `label` — it already carries its own where it names
        // something (`Add "Groceries"`), and wrapping it again reads as
        // `Couldn't undo "Add "Groceries"".`
        message: `Couldn't ${action} ${label}. Nothing changed.`,
        variant: "error",
      }),
  });
  const restoreCategories = useCategoryRestore();

  // Bulk selection — independent of `selectedCategoryId` (which drives the
  // detail panel for a single category). Ephemeral; not persisted.
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(
    () => new Set()
  );
  // Groups explicitly selected via their header checkbox. Kept separate from
  // selectedCategoryIds because an empty group has no children to stand in for
  // it — the group id itself has to live somewhere. Selecting a group mirrors
  // its children into selectedCategoryIds (below) so the per-row checkboxes,
  // count, and "where money lives" all keep working off one set.
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    () => new Set()
  );
  const selectedGroupIdsRef = useRef(selectedGroupIds);
  selectedGroupIdsRef.current = selectedGroupIds;
  const selectedCategoryIdsRef = useRef(selectedCategoryIds);
  selectedCategoryIdsRef.current = selectedCategoryIds;
  // Hidden-row selection — drives the floating "Unhide" toolbar. Kept separate
  // from the active selection above and mutually exclusive with it, so the
  // toolbar unambiguously shows either delete/reassign OR unhide.
  const [selectedHiddenGroupIds, setSelectedHiddenGroupIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedHiddenCategoryIds, setSelectedHiddenCategoryIds] = useState<Set<string>>(
    () => new Set()
  );
  const [bulkPending, startBulkTransition] = useTransition();
  // Anchor for shift-click range selection — last toggled id within a group.
  const selectionAnchorRef = useRef<string | null>(null);

  const toggleSelection = useCallback(
    (
      categoryId: string,
      options?: { withShift: boolean; groupCategoryIds: string[]; groupId?: string }
    ) => {
      // Active selection and hidden selection are mutually exclusive.
      setSelectedHiddenGroupIds(new Set());
      setSelectedHiddenCategoryIds(new Set());
      const anchorId = selectionAnchorRef.current;
      if (options?.withShift && anchorId) {
        const ids = options.groupCategoryIds;
        const anchorIdx = ids.indexOf(anchorId);
        const targetIdx = ids.indexOf(categoryId);
        // Anchor must live in the same group; otherwise fall through to a
        // plain toggle so cross-group shift-clicks don't sweep unintended rows.
        if (anchorIdx >= 0 && targetIdx >= 0) {
          const [from, to] =
            anchorIdx <= targetIdx
              ? [anchorIdx, targetIdx]
              : [targetIdx, anchorIdx];
          const range = ids.slice(from, to + 1);
          setSelectedCategoryIds((prev) => {
            const next = new Set(prev);
            for (const id of range) next.add(id);
            return next;
          });
          selectionAnchorRef.current = categoryId;
          return;
        }
      }
      const wasSelected = selectedCategoryIdsRef.current.has(categoryId);
      setSelectedCategoryIds((prev) => {
        const next = new Set(prev);
        if (next.has(categoryId)) next.delete(categoryId);
        else next.add(categoryId);
        return next;
      });
      // Deselecting a child breaks "all children selected", so the group can
      // no longer count as fully selected — drop it so a later delete doesn't
      // cascade through a child the user just unchecked.
      if (wasSelected && options?.groupId) {
        const groupId = options.groupId;
        setSelectedGroupIds((prev) => {
          if (!prev.has(groupId)) return prev;
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
      }
      selectionAnchorRef.current = categoryId;
    },
    []
  );

  // Toggle a whole group's selection from its header checkbox. Mirrors the
  // group's children into selectedCategoryIds so the row checkboxes and count
  // reflect what's selected; an empty group simply selects itself.
  const toggleGroupSelection = useCallback(
    (groupId: string, childIds: string[]) => {
      setSelectedHiddenGroupIds(new Set());
      setSelectedHiddenCategoryIds(new Set());
      const willSelect = !selectedGroupIdsRef.current.has(groupId);
      setSelectedGroupIds((prev) => {
        const next = new Set(prev);
        if (willSelect) next.add(groupId);
        else next.delete(groupId);
        return next;
      });
      setSelectedCategoryIds((prev) => {
        const next = new Set(prev);
        if (willSelect) for (const id of childIds) next.add(id);
        else for (const id of childIds) next.delete(id);
        return next;
      });
      selectionAnchorRef.current = null;
    },
    []
  );

  const clearSelection = useCallback(() => {
    setSelectedCategoryIds(new Set());
    setSelectedGroupIds(new Set());
    selectionAnchorRef.current = null;
  }, []);

  const clearHiddenSelection = useCallback(() => {
    setSelectedHiddenGroupIds(new Set());
    setSelectedHiddenCategoryIds(new Set());
  }, []);

  // Toggle a hidden group's selection. Selecting a hidden item clears the active
  // selection (mutual exclusivity → unambiguous toolbar).
  const toggleHiddenGroupSelection = useCallback(
    (groupId: string) => {
      clearSelection();
      setSelectedHiddenGroupIds((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      });
    },
    [clearSelection]
  );

  const toggleHiddenCategorySelection = useCallback(
    (categoryId: string) => {
      clearSelection();
      setSelectedHiddenCategoryIds((prev) => {
        const next = new Set(prev);
        if (next.has(categoryId)) next.delete(categoryId);
        else next.add(categoryId);
        return next;
      });
    },
    [clearSelection]
  );

  // Bulk unhide the selected hidden groups + flat categories in one undoable
  // step. Unhide is a flag-only flip — no balance change (money was swept to RTA
  // at hide time and stays there).
  const handleBulkUnhide = useCallback(() => {
    const groupIds = Array.from(selectedHiddenGroupIds);
    const categoryIds = Array.from(selectedHiddenCategoryIds);
    const count = groupIds.length + categoryIds.length;
    if (count === 0) return;
    startBulkTransition(async () => {
      const groupSnaps: GroupUnarchiveSnapshot[] = [];
      for (const id of groupIds) groupSnaps.push(await unarchiveGroupWithSnapshot(id));
      const catSnaps: CategoryUnarchiveSnapshot[] = [];
      for (const id of categoryIds) catSnaps.push(await unarchiveCategoryWithSnapshot(id));
      const runForward = async () => {
        for (const id of groupIds) await unarchiveGroupWithSnapshot(id);
        for (const id of categoryIds) await unarchiveCategoryWithSnapshot(id);
      };
      const runBackward = async () => {
        for (const s of groupSnaps) await restoreUnarchiveGroupSnapshot(s);
        for (const s of catSnaps) await restoreUnarchiveCategorySnapshot(s);
      };
      const entryId = pushMutation({
        label: `Unhide ${count} item${count === 1 ? "" : "s"}`,
        forward: runForward,
        backward: runBackward,
      });
      clearHiddenSelection();
      toast({
        message: `Unhid ${count} item${count === 1 ? "" : "s"}`,
        action: { label: "Undo", onClick: () => undoEntry(entryId) },
      });
    });
  }, [
    selectedHiddenGroupIds,
    selectedHiddenCategoryIds,
    pushMutation,
    undoEntry,
    clearHiddenSelection,
    toast,
  ]);

  // Used by the column-header "select all visible" checkbox — operates on
  // categories only, not groups.
  const setManySelected = useCallback(
    (ids: string[], selected: boolean) => {
      if (ids.length === 0) return;
      setSelectedHiddenGroupIds(new Set());
      setSelectedHiddenCategoryIds(new Set());
      setSelectedCategoryIds((prev) => {
        const next = new Set(prev);
        if (selected) for (const id of ids) next.add(id);
        else for (const id of ids) next.delete(id);
        return next;
      });
      selectionAnchorRef.current = null;
    },
    []
  );


  const handleBulkPickAccount = useCallback(
    (accountId: string | null) => {
      const ids = Array.from(selectedCategoryIds);
      if (ids.length === 0) return;
      const accountName = accountId
        ? accounts.find((a) => a.id === accountId)?.name ?? "account"
        : "primary";
      const count = ids.length;
      startBulkTransition(async () => {
        const snapshots = await bulkUpdateCategorySettingsWithSnapshot(
          ids,
          accountId
        );
        const entryId = pushMutation({
          label: `Change allocation account for ${count} categor${
            count === 1 ? "y" : "ies"
          }`,
          forward: () => bulkUpdateCategorySettings(ids, accountId),
          backward: () => restoreCategorySettingsBatch(snapshots),
        });
        clearSelection();
        toast({
          message: `Moved ${count} categor${count === 1 ? "y" : "ies"} to ${accountName}`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      });
    },
    [selectedCategoryIds, accounts, pushMutation, undoEntry, clearSelection, toast]
  );

  // Bulk delete dialog state
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteImpact, setBulkDeleteImpact] = useState<{
    transactionCount: number;
    splitCount: number;
    budgetHistoryCount: number;
  }>({ transactionCount: 0, splitCount: 0, budgetHistoryCount: 0 });

  // Bulk delete operates on the explicitly selected categories plus any groups
  // checked via their header checkbox. A checked group's children are already
  // mirrored into selectedCategoryIds, so they ride along here too; the server
  // de-dups against the group cascade. Group selection is explicit (the box is
  // checked), never inferred from "all children happen to be selected", so this
  // can't silently destroy a group the user didn't deliberately check.
  const selectedDeletionIds = useMemo(
    () => Array.from(selectedCategoryIds),
    [selectedCategoryIds]
  );
  const selectedGroupDeletionIds = useMemo(
    () => Array.from(selectedGroupIds),
    [selectedGroupIds]
  );

  // Every non-system category, for the per-row delete dialog in CategoryMenu.
  // That dialog drops the row's own category itself, so this list is shared
  // across all rows and doesn't recompute per row.
  const allReassignOptions = useMemo<ReassignOption[]>(() => {
    const options: ReassignOption[] = [];
    for (const group of budget.groups) {
      if (group.is_system) continue;
      for (const cat of group.categories) {
        options.push({ id: cat.id, name: cat.name, groupName: group.name });
      }
    }
    return options;
  }, [budget.groups]);

  // Categories that survive the deletion — used as reassignment targets.
  const reassignOptions = useMemo<ReassignOption[]>(() => {
    const deletedSet = new Set(selectedDeletionIds);
    const options: ReassignOption[] = [];
    for (const group of budget.groups) {
      if (group.is_system) continue;
      for (const cat of group.categories) {
        if (deletedSet.has(cat.id)) continue;
        options.push({ id: cat.id, name: cat.name, groupName: group.name });
      }
    }
    return options;
  }, [budget.groups, selectedDeletionIds]);

  const handleBulkDeleteOpen = useCallback(async () => {
    if (selectedDeletionIds.length === 0 && selectedGroupDeletionIds.length === 0)
      return;
    const impact = await getCategoryDeletionImpact(
      selectedDeletionIds,
      selectedGroupDeletionIds
    );
    setBulkDeleteImpact({
      transactionCount: impact.transactionCount,
      splitCount: impact.splitCount,
      budgetHistoryCount: impact.budgetHistoryCount,
    });
    setBulkDeleteOpen(true);
  }, [selectedDeletionIds, selectedGroupDeletionIds]);

  const handleBulkDeleteConfirm = useCallback(
    (reassignToCategoryId: string | null) => {
      const categoryIds = selectedDeletionIds;
      const groupIds = selectedGroupDeletionIds;
      if (categoryIds.length === 0 && groupIds.length === 0) return;
      const catCount = categoryIds.length;
      const grpCount = groupIds.length;
      startBulkTransition(async () => {
        const snapshot = await bulkDeleteCategoriesWithSnapshot({
          categoryIds,
          groupIds,
          reassignToCategoryId,
        });
        // "3 categories and 1 group", "1 group", "2 categories" — drop whichever
        // count is zero so an empty-group delete doesn't read "0 categories".
        const parts: string[] = [];
        if (catCount > 0)
          parts.push(`${catCount} categor${catCount === 1 ? "y" : "ies"}`);
        if (grpCount > 0)
          parts.push(`${grpCount} group${grpCount === 1 ? "" : "s"}`);
        const summary = parts.join(" and ");
        const entryId = pushMutation({
          label: `Delete ${summary}`,
          // forward re-runs the WithSnapshot variant — its returned snapshot
          // is discarded but the mutation is what matters for redo.
          forward: async () => {
            await bulkDeleteCategoriesWithSnapshot({
              categoryIds,
              groupIds,
              reassignToCategoryId,
            });
          },
          backward: () => restoreCategories(snapshot, summary),
        });
        setBulkDeleteOpen(false);
        clearSelection();
        toast({
          message: `Deleted ${summary}`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      });
    },
    [
      selectedDeletionIds,
      selectedGroupDeletionIds,
      pushMutation,
      undoEntry,
      clearSelection,
      toast,
      restoreCategories,
    ]
  );

  // Local state for optimistic reordering — synced from server props
  const [localCategories, setLocalCategories] = useState<Record<string, CategoryWithBudget[]>>(
    () => Object.fromEntries(budget.groups.map((g) => [g.id, g.categories]))
  );
  const localCategoriesRef = useRef(localCategories);
  localCategoriesRef.current = localCategories;

  // Local group order for optimistic drag reordering
  const [localGroupOrder, setLocalGroupOrder] = useState<string[]>(
    () => budget.groups.map((g) => g.id)
  );
  const localGroupOrderRef = useRef(localGroupOrder);
  localGroupOrderRef.current = localGroupOrder;

  const prevBudgetRef = useRef(budget);
  useEffect(() => {
    if (prevBudgetRef.current !== budget) {
      setLocalCategories(Object.fromEntries(budget.groups.map((g) => [g.id, g.categories])));
      setLocalGroupOrder(budget.groups.map((g) => g.id));
      // Reconcile expanded state with current groups: keep existing values,
      // add new groups as expanded, drop removed ones. Without this, bulk
      // collapse/expand skips groups that didn't exist at first render.
      setExpandedGroups((prev) =>
        Object.fromEntries(budget.groups.map((g) => [g.id, prev[g.id] ?? true]))
      );
      prevBudgetRef.current = budget;
    }
  }, [budget]);

  // SortableJS for group reordering
  const groupSortableRef = useRef<Sortable | null>(null);
  const groupContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (groupSortableRef.current) {
      groupSortableRef.current.destroy();
      groupSortableRef.current = null;
    }
    if (node) {
      groupSortableRef.current = Sortable.create(node, {
        handle: "[data-group-handle]",
        animation: 150,
        fallbackOnBody: true,
        ghostClass: "opacity-30",
        onEnd: (evt) => {
          const { oldIndex, newIndex } = evt;
          if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;

          // Revert DOM — let React handle rendering
          const parent = evt.from;
          const item = evt.item;
          parent.removeChild(item);
          parent.insertBefore(item, parent.children[oldIndex] || null);

          // Optimistic update
          const order = [...localGroupOrderRef.current];
          const [moved] = order.splice(oldIndex, 1);
          order.splice(newIndex, 0, moved);
          const oldOrder = [...localGroupOrderRef.current];

          setLocalGroupOrder(order);

          startTransition(async () => {
            try {
              await reorderCategoryGroups(order);
              pushMutation({
                label: "Reorder category group",
                forward: () => reorderCategoryGroups(order),
                backward: () => reorderCategoryGroups(oldOrder),
              });
            } catch {
              // The drag already moved the row optimistically. Without this the
              // grid keeps showing an order the server never accepted, and the
              // next reload silently snaps it back.
              setLocalGroupOrder(oldOrder);
              toastRef.current({
                message: "Couldn't reorder the groups.",
                variant: "error",
              });
            }
          });
        },
      });
    }
  }, [startTransition, pushMutation]);

  // Keyboard shortcuts: Cmd+Z / Cmd+Shift+Z
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const handleToggle = useCallback(
    (groupId: string, altKey: boolean) => {
      setExpandedGroups((prev) => {
        if (altKey) {
          const anyExpanded = Object.values(prev).some(Boolean);
          const next = !anyExpanded;
          return Object.fromEntries(
            Object.keys(prev).map((id) => [id, next])
          );
        }
        return { ...prev, [groupId]: !prev[groupId] };
      });
    },
    []
  );

  // Find selected category and its parent group
  const selectedCategory = selectedCategoryId
    ? budget.groups
        .flatMap((g) => g.categories)
        .find((c) => c.id === selectedCategoryId)
    : null;
  const selectedGroupName = selectedCategoryId
    ? budget.groups.find((g) =>
        g.categories.some((c) => c.id === selectedCategoryId)
      )?.name ?? ""
    : "";

  // At 1400px+ the column shows when the overview is docked OR a category is
  // open — so opening a category with the overview hidden still docks (and
  // closing it collapses the column again).
  const wideColumnOpen = overviewDocked || !!selectedCategory;
  const sidePanelOpen = isNarrow ? panelOpen : wideColumnOpen;

  const toggleSidePanel = () => {
    if (isNarrow) {
      if (panelOpen && selectedCategoryId) handleSelectCategory(null);
      setPanelOpen(!panelOpen);
      return;
    }
    if (wideColumnOpen) {
      // Close the whole column: drop the selection and undock the overview.
      if (selectedCategoryId) handleSelectCategory(null);
      if (overviewDocked) toggleOverviewDocked();
    } else {
      toggleOverviewDocked();
    }
  };

  // Escape backs out of the category detail in the docked column (the drawer
  // gets Escape from the dialog primitive). Ignored while typing or when an
  // inner popover/menu owns the key.
  useEffect(() => {
    if (!selectedCategoryId || isNarrow) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]"
        )
      ) {
        return;
      }
      handleSelectCategory(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedCategoryId, isNarrow, handleSelectCategory]);

  const saveNewGroup = () => {
    const trimmed = newGroupName.trim();
    if (trimmed) {
      // Generate the id up front so forward/backward target the same row
      // across undo→redo→undo cycles.
      const groupId = clientId();
      startTransition(async () => {
        try {
          await addCategoryGroup(trimmed, groupId);
          pushMutation({
            label: `Add group "${trimmed}"`,
            forward: () => addCategoryGroup(trimmed, groupId).then(() => {}),
            backward: async () => {
              await deleteCategoryGroup(groupId);
            },
          });
        } catch {
          // The group never appears on failure, so there's nothing on screen
          // to contradict — but also nothing to explain the dialog closing
          // with no new row.
          toast({
            message: `Couldn't add group "${trimmed}".`,
            variant: "error",
          });
        }
      });
    }
    setNewGroupName("");
    setDialogOpen(false);
  };

  // Menu-driven "Move to group…" handler. Mirrors the cross-group branch of
  // handleDragEnd: optimistic local-state update, server action, toast with
  // Undo, and a matching pushMutation entry so Cmd+Z / Cmd+Shift+Z behave the
  // same as drag-driven moves. The destination append position is handled by
  // the server action (omit newSortOrder on forward → server appends).
  const handleMoveToGroup = useCallback(
    (
      categoryId: string,
      targetGroupId: string,
      categoryName: string
    ) => {
      const cats = localCategoriesRef.current;
      // Find source group from the current local-state map (avoids relying on
      // a stale closure).
      let fromGroupId: string | null = null;
      let movedCategory: CategoryWithBudget | null = null;
      for (const [gId, list] of Object.entries(cats)) {
        const found = list.find((c) => c.id === categoryId);
        if (found) {
          fromGroupId = gId;
          movedCategory = found;
          break;
        }
      }
      if (!fromGroupId || !movedCategory || fromGroupId === targetGroupId) return;

      // Optimistic update: drop from source, append to target.
      const source = (cats[fromGroupId] ?? []).filter((c) => c.id !== categoryId);
      const target = [...(cats[targetGroupId] ?? []), movedCategory];
      setLocalCategories((prev) => ({
        ...prev,
        [fromGroupId!]: source,
        [targetGroupId]: target,
      }));

      startTransition(async () => {
        try {
          const { oldGroupId, oldSortOrder } = await moveCategoryToGroup(
            categoryId,
            targetGroupId
          );
          pushMutation({
            label: `Move "${categoryName}" to different group`,
            forward: async () => {
              await moveCategoryToGroup(categoryId, targetGroupId);
            },
            backward: () =>
              moveCategoryToGroup(categoryId, oldGroupId, oldSortOrder).then(
                () => {}
              ),
          });
        } catch {
          // Put the row back where it was — the optimistic move above is the
          // only thing that made it look like it landed.
          setLocalCategories((prev) => ({
            ...prev,
            [fromGroupId!]: cats[fromGroupId!] ?? [],
            [targetGroupId]: cats[targetGroupId] ?? [],
          }));
          toast({
            message: `Couldn't move "${categoryName}".`,
            variant: "error",
          });
        }
      });
    },
    [startTransition, pushMutation, toast]
  );

  // Single handler for all drag-and-drop — DOM is already reverted by onEnd,
  // so we just update React state and fire server actions.
  const handleDragEnd = useCallback(
    ({ itemId, itemName, fromGroupId, toGroupId, oldIndex, newIndex }: DragEndEvent) => {
      const cats = localCategoriesRef.current;

      if (fromGroupId === toGroupId) {
        // Within-group reorder
        const items = [...(cats[fromGroupId] ?? [])];
        const [moved] = items.splice(oldIndex, 1);
        items.splice(newIndex, 0, moved);

        const newIds = items.map((c) => c.id);
        const oldIds = (cats[fromGroupId] ?? []).map((c) => c.id);
        if (JSON.stringify(newIds) === JSON.stringify(oldIds)) return;

        setLocalCategories((prev) => ({ ...prev, [fromGroupId]: items }));

        startTransition(async () => {
          try {
            await reorderCategoriesInGroup(fromGroupId, newIds);
            pushMutation({
              label: "Reorder category",
              forward: () => reorderCategoriesInGroup(fromGroupId, newIds),
              backward: () => reorderCategoriesInGroup(fromGroupId, oldIds),
            });
          } catch {
            setLocalCategories((prev) => ({
              ...prev,
              [fromGroupId]: cats[fromGroupId] ?? [],
            }));
            toast({
              message: `Couldn't move "${itemName}".`,
              variant: "error",
            });
          }
        });
      } else {
        // Cross-group move
        const source = [...(cats[fromGroupId] ?? [])];
        const target = [...(cats[toGroupId] ?? [])];
        const [moved] = source.splice(oldIndex, 1);
        target.splice(newIndex, 0, moved);

        setLocalCategories((prev) => ({
          ...prev,
          [fromGroupId]: source,
          [toGroupId]: target,
        }));

        const targetIds = target.map((c) => c.id);

        // The two halves fail differently, so they're caught separately: if the
        // move itself fails nothing landed and the optimistic drag has to be
        // reverted, but if only the reposition fails the row IS in the new
        // group — reverting would then be the lie.
        startTransition(async () => {
          let moved: { oldGroupId: string; oldSortOrder: number };
          try {
            moved = await moveCategoryToGroup(itemId, toGroupId);
          } catch {
            setLocalCategories((prev) => ({
              ...prev,
              [fromGroupId]: cats[fromGroupId] ?? [],
              [toGroupId]: cats[toGroupId] ?? [],
            }));
            toast({
              message: `Couldn't move "${itemName}".`,
              variant: "error",
            });
            return;
          }
          try {
            // Persist the correct position within the target group
            await reorderCategoriesInGroup(toGroupId, targetIds);
          } catch {
            toast({
              message: `Moved "${itemName}", but couldn't set its position in the group.`,
              variant: "error",
            });
          }
          pushMutation({
            label: `Move "${itemName}" to different group`,
            forward: async () => {
              await moveCategoryToGroup(itemId, toGroupId);
              await reorderCategoriesInGroup(toGroupId, targetIds);
            },
            backward: () =>
              moveCategoryToGroup(itemId, moved.oldGroupId, moved.oldSortOrder).then(() => {}),
          });
        });
      }
    },
    [startTransition, pushMutation, toast]
  );

  const allCategories = budget.groups.flatMap((g) => g.categories);
  const isFiltering = activeFilter !== "all";
  const filteredForOverview = isFiltering
    ? allCategories.filter((c) => matchesFilter(c, activeFilter))
    : undefined;

  const visibleCategoryIds = useMemo(() => {
    const ids: string[] = [];
    for (const groupId of localGroupOrder) {
      const group = budget.groups.find((g) => g.id === groupId);
      if (!group) continue;
      const cats = localCategories[group.id] ?? group.categories;
      const filtered = isFiltering
        ? cats.filter((c) => matchesFilter(c, activeFilter))
        : cats;
      for (const c of filtered) ids.push(c.id);
    }
    return ids;
  }, [localGroupOrder, budget.groups, localCategories, isFiltering, activeFilter]);

  // Flat list of every visible (non-archived) category across all groups in
  // display order — fed to each CategoryRow as `siblingDestinations` for the
  // move-money popover. `budget.groups` is already archived-filtered upstream,
  // so this list excludes hidden categories. Not filter-aware (active filter
  // shouldn't shrink the destination menu).
  const allDestinations = useMemo(() => {
    const list: { id: string; name: string; groupName: string }[] = [];
    for (const groupId of localGroupOrder) {
      const group = budget.groups.find((g) => g.id === groupId);
      if (!group) continue;
      const cats = localCategories[group.id] ?? group.categories;
      for (const cat of cats) {
        list.push({ id: cat.id, name: cat.name, groupName: group.name });
      }
    }
    return list;
  }, [localGroupOrder, budget.groups, localCategories]);

  const visibleSelectedCount = visibleCategoryIds.filter((id) =>
    selectedCategoryIds.has(id)
  ).length;
  const allVisibleSelected =
    visibleCategoryIds.length > 0 &&
    visibleSelectedCount === visibleCategoryIds.length;
  const showEmptyState =
    budget.groups.length === 0 || (isFiltering && visibleCategoryIds.length === 0);
  const allHeaderIndeterminate =
    visibleSelectedCount > 0 && !allVisibleSelected;

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Main table area */}
      <div className="flex-1 overflow-auto">
        {/* One control row: filters on the left, page actions on the right.
            Sits OUTSIDE the role="table" region so its buttons aren't
            announced as table cells. */}
        <BudgetFilterBar
          categories={allCategories}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          actions={
            <>
              <ToolbarIconButton
                label="Add category group"
                className={cn(
                  "size-[38px]",
                  view === "simple" ? "hidden" : "hidden md:inline-flex"
                )}
                disabled={isFiltering}
                onClick={() => setDialogOpen(true)}
              >
                <Plus />
              </ToolbarIconButton>
              <ToolbarIconButton
                label="Undo"
                keys={["⌘", "Z"]}
                className="size-[38px]"
                disabled={!canUndo || isPending}
                onClick={undo}
              >
                <Undo2 />
              </ToolbarIconButton>
              <ToolbarIconButton
                label="Redo"
                keys={["⇧", "⌘", "Z"]}
                className="size-[38px]"
                disabled={!canRedo || isPending}
                onClick={redo}
              >
                <Redo2 />
              </ToolbarIconButton>
              <BudgetViewToggle
                view={view}
                onChange={handleViewChange}
                className="hidden md:inline-flex mx-1.5"
              />
              {/* Controls the whole right-hand panel, whatever it's showing.
                  Below 1400px that's the drawer; at 1400px+ the docked column. */}
              <ToolbarIconButton
                label={sidePanelOpen ? "Hide overview" : "Show overview"}
                className={cn("size-[38px]", sidePanelOpen && "text-foreground")}
                onClick={toggleSidePanel}
                aria-label={sidePanelOpen ? "Hide side panel" : "Show overview panel"}
                aria-pressed={sidePanelOpen}
              >
                {sidePanelOpen ? <PanelRightClose /> : <PanelRight />}
              </ToolbarIconButton>
            </>
          }
          compactActions={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<ToolbarIconButton label="More actions" className="size-[38px]" />}
              >
                <MoreVertical />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="min-w-52">
                {view === "grid" && (
                  <DropdownMenuItem
                    className="hidden md:flex"
                    disabled={isFiltering}
                    onClick={() => setDialogOpen(true)}
                  >
                    <Plus />
                    Add category group
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={!canUndo || isPending} onClick={undo}>
                  <Undo2 />
                  Undo
                  <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canRedo || isPending} onClick={redo}>
                  <Redo2 />
                  Redo
                  <DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="hidden md:block" />
                <DropdownMenuItem
                  className="hidden md:flex"
                  onClick={() => handleViewChange(view === "grid" ? "simple" : "grid")}
                >
                  {view === "grid" ? <LayoutList /> : <Table2 />}
                  {view === "grid" ? "Simple view" : "Grid view"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleSidePanel}>
                  {sidePanelOpen ? <PanelRightClose /> : <PanelRight />}
                  {sidePanelOpen ? "Hide overview" : "Show overview"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />

        {/* ARIA table region — scopes only the column-header strip and the
            per-group rows. The toolbar above and the side panel below sit
            OUTSIDE this wrapper deliberately, so their controls aren't
            announced as table cells. role="table" (not role="grid") because
            we do NOT implement arrow-key cell navigation. Column → cell
            association is positional via the canonical ARIA table model —
            no aria-labelledby is wired on cells (would shadow the dollar
            amount on stricter SR implementations). */}
        {/* Simple view — always the view below md; at md+ only when chosen.
            In grid mode both are in the DOM and CSS picks by breakpoint. */}
        {!showEmptyState && (
          <BudgetSimpleView
            className={view === "grid" ? "md:hidden" : undefined}
            groups={localGroupOrder.flatMap((groupId) => {
              const group = budget.groups.find((g) => g.id === groupId);
              if (!group) return [];
              const cats = localCategories[group.id] ?? group.categories;
              const filtered = isFiltering
                ? cats.filter((c) => matchesFilter(c, activeFilter))
                : cats;
              if (filtered.length === 0) return [];
              return [{ group, categories: filtered }];
            })}
            expandedGroups={expandedGroups}
            onToggleGroup={handleToggle}
            onSelectCategory={handleSelectCategory}
            selectedCategoryId={selectedCategoryId}
            month={budget.month}
          />
        )}

        {/* The grid region also hosts the empty states, so it renders in
            simple mode too when there's nothing to list. */}
        {(view === "grid" || showEmptyState) && (
        <div
          role="table"
          aria-label="Budget categories"
          className={cn(!showEmptyState && "hidden md:block")}
        >
          {/* Column headers */}
          <div
            role="row"
            className={cn(
              "grid grid-cols-[minmax(256px,1fr)_120px_120px_120px] items-center pl-1 pr-6 h-10 border-b border-border/50 text-[12px] font-bold text-muted-foreground uppercase tracking-[0.06em] sticky top-[55px] bg-background z-10",
              view === "simple" ? "hidden" : "max-md:hidden"
            )}
          >
            <div
              role="columnheader"
              id="col-category"
              className="flex items-center gap-1 min-w-0"
            >
              {/* Spacer matching the drag handle in group rows */}
              <div className="shrink-0 p-0.5 -mr-0.5">
                <div className="h-3.5 w-3.5" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setExpandedGroups((prev) => {
                    const anyExpanded = Object.values(prev).some(Boolean);
                    const next = !anyExpanded;
                    return Object.fromEntries(
                      Object.keys(prev).map((id) => [id, next])
                    );
                  });
                }}
                className="shrink-0 flex items-center text-foreground/60 hover:text-foreground/90 transition-colors"
                aria-label={Object.values(expandedGroups).some(Boolean) ? "Collapse all groups" : "Expand all groups"}
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-150",
                    Object.values(expandedGroups).some(Boolean) && "rotate-90"
                  )}
                  strokeWidth={2}
                />
              </button>
              <div className="shrink-0 h-3.5 w-3.5 flex items-center justify-center">
                <SelectCheckbox
                  checked={allVisibleSelected}
                  indeterminate={allHeaderIndeterminate}
                  onClick={() =>
                    setManySelected(visibleCategoryIds, !allVisibleSelected)
                  }
                  ariaLabel={
                    allVisibleSelected
                      ? "Deselect all categories"
                      : "Select all categories"
                  }
                />
              </div>
              <span className="ml-1">Category</span>
            </div>
            <span id="col-assigned" role="columnheader" className="text-right">Assigned</span>
            <span id="col-activity" role="columnheader" className="text-right">Activity</span>
            <span id="col-available" role="columnheader" className="text-right">Available</span>
          </div>

          {/* Category groups */}
          {budget.groups.length === 0 ? (
            <EmptyState
              icon={FolderPlus}
              message="Create your first category group to start budgeting."
              primaryAction={{ label: "Add category group", onClick: () => setDialogOpen(true) }}
            />
          ) : isFiltering && visibleCategoryIds.length === 0 ? (
            <EmptyState
              icon={
                activeFilter === "overspent" || activeFilter === "underfunded"
                  ? CircleCheck
                  : Receipt
              }
              message={
                activeFilter === "overspent"
                  ? "No overspent categories — you're all caught up."
                  : activeFilter === "underfunded"
                    ? "No underfunded categories — you're all set."
                    : activeFilter === "overfunded"
                      ? "No overfunded categories."
                      : "No categories with money available."
              }
              primaryAction={{ label: "Clear filter", onClick: () => setActiveFilter("all") }}
            />
          ) : (
            <div className="pb-8" ref={groupContainerRef}>
              {localGroupOrder.map((groupId, idx) => {
                const group = budget.groups.find((g) => g.id === groupId);
                if (!group) return null;
                const cats = localCategories[group.id] ?? group.categories;
                const filteredCats = isFiltering
                  ? cats.filter((c) => matchesFilter(c, activeFilter))
                  : cats;
                if (isFiltering && filteredCats.length === 0) return null;
                // Other (non-system) groups a category in THIS group can be
                // moved to. Uses localGroupOrder for stable ordering and
                // mirrors the system-group exclusion that reassignOptions
                // (above) applies for bulk-delete reassignment targets.
                const otherGroupsForThisGroup = localGroupOrder
                  .map((id) => budget.groups.find((g) => g.id === id))
                  .filter(
                    (g): g is typeof budget.groups[number] =>
                      !!g && g.id !== group.id && !g.is_system
                  )
                  .map((g) => ({ id: g.id, name: g.name }));
                return (
                  <div key={group.id} data-group-id={group.id}>
                    <CategoryGroupRow
                      group={group}
                      categories={filteredCats}
                      month={budget.month}
                      expanded={expandedGroups[group.id] ?? true}
                      onToggle={handleToggle}
                      onSelectCategory={handleSelectCategory}
                      onMutate={pushMutation}
                      undoEntry={undoEntry}
                      onDragEnd={handleDragEnd}
                      isFirst={idx === 0}
                      isLast={idx === localGroupOrder.length - 1}
                      accounts={accounts}
                      selectedIds={selectedCategoryIds}
                      openCategoryId={selectedCategoryId}
                      isGroupSelected={selectedGroupIds.has(group.id)}
                      onToggleSelection={toggleSelection}
                      onToggleGroupSelection={toggleGroupSelection}
                      otherGroups={otherGroupsForThisGroup}
                      onMoveToGroup={handleMoveToGroup}
                      reassignOptions={allReassignOptions}
                      allDestinations={allDestinations}
                      closeSidePanel={() => setPanelOpen(false)}
                    />
                  </div>
                );
              })}
              {/* Archived categories live outside the drag/reorder/selection
                  machinery — rendered as a sibling after the group loop, only
                  when something is hidden (empty-state = section absent).
                  Suppressed under any active filter: hidden items are hidden
                  by intent and shouldn't surface in Overspent/Underfunded/etc. */}
              {!isFiltering &&
                (budget.hiddenCategories.length > 0 ||
                  budget.hiddenGroups.length > 0) && (
                <HiddenCategoriesSection
                  categories={budget.hiddenCategories}
                  groups={budget.hiddenGroups}
                  groupNamesById={visibleGroupNamesById}
                  month={budget.month}
                  onMutate={pushMutation}
                  selectedGroupIds={selectedHiddenGroupIds}
                  selectedCategoryIds={selectedHiddenCategoryIds}
                  onToggleGroup={toggleHiddenGroupSelection}
                  onToggleCategory={toggleHiddenCategorySelection}
                />
              )}
            </div>
          )}
        </div>
        )}
      </div>

      {/* Side panel — one slot on the right that shows the overview by
          default and swaps to a category's detail when one is selected. At
          1400px+ it's a docked column that pushes content over (never covers
          it, so the list stays readable and clickable while inspecting).
          Below 1400px it's a drawer — see below. */}
      {wideColumnOpen && (
        <div className="hidden min-[1400px]:flex w-[420px] shrink-0 border-l border-border bg-background">
          {selectedCategory ? (
            <CategoryDetailPanel
              key={selectedCategory.id}
              category={selectedCategory}
              groupName={selectedGroupName}
              month={budget.month}
              onClose={() => handleSelectCategory(null)}
              onMutate={pushMutation}
              undoEntry={undoEntry}
            />
          ) : (
            <BudgetOverviewPanel
              className="w-full border-l-0"
              budget={budget}
              onMutate={pushMutation}
              undoEntry={undoEntry}
              filteredCategories={filteredForOverview}
            />
          )}
        </div>
      )}

      {/* Drawer below 1400px. Non-modal with no backdrop and no click-outside
          dismissal: the list behind stays usable, so clicking another row
          swaps the detail instead of closing the drawer first. Closes via its
          X, Escape, or the Overview button. */}
      <Sheet
        open={panelOpen && isNarrow}
        onOpenChange={(open) => {
          setPanelOpen(open);
          if (!open && selectedCategoryId) handleSelectCategory(null);
        }}
        modal={false}
        disablePointerDismissal
      >
        <SheetContent
          side="right"
          showOverlay={false}
          className="min-[1400px]:hidden p-0 data-[side=right]:sm:max-w-[420px] gap-0"
          showCloseButton={!selectedCategory}
        >
          <SheetTitle className="sr-only">
            {selectedCategory ? selectedCategory.name : "Budget overview"}
          </SheetTitle>
          {selectedCategory ? (
            <CategoryDetailPanel
              key={selectedCategory.id}
              category={selectedCategory}
              groupName={selectedGroupName}
              month={budget.month}
              onClose={() => {
                setPanelOpen(false);
                handleSelectCategory(null);
              }}
              onMutate={pushMutation}
              undoEntry={undoEntry}
            />
          ) : (
            <BudgetOverviewPanel
              className="w-full border-l-0"
              budget={budget}
              onMutate={pushMutation}
              undoEntry={undoEntry}
              filteredCategories={filteredForOverview}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Add category group dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add category group</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveNewGroup();
            }}
          >
            <Input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Housing, Food, Savings"
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewGroupName("");
                  setDialogOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!newGroupName.trim()}>
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Floating bulk-action toolbar — only visible when at least one
          category is checked. */}
      <BudgetSelectionToolbar
        selectedCount={selectedCategoryIds.size + selectedGroupIds.size}
        accounts={accounts}
        onClear={clearSelection}
        onPickAccount={handleBulkPickAccount}
        onDelete={handleBulkDeleteOpen}
        disabled={bulkPending}
      />

      {/* Hidden-selection variant — mutually exclusive with the active toolbar
          above, so only one shows at a time. */}
      <BudgetSelectionToolbar
        variant="unhide"
        selectedCount={selectedHiddenGroupIds.size + selectedHiddenCategoryIds.size}
        accounts={accounts}
        onClear={clearHiddenSelection}
        onPickAccount={() => {}}
        onDelete={() => {}}
        onUnhide={handleBulkUnhide}
        disabled={bulkPending}
      />

      <BulkDeleteCategoriesDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        categoryCount={selectedDeletionIds.length}
        groupCount={selectedGroupDeletionIds.length}
        transactionCount={bulkDeleteImpact.transactionCount}
        reassignOptions={reassignOptions}
        onConfirm={handleBulkDeleteConfirm}
        pending={bulkPending}
        requireReassign={bulkDeleteImpact.budgetHistoryCount > 0}
      />
    </div>
  );
}
