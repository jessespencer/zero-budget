"use client";

import { useState, useRef, useEffect, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Undo2, Redo2, Search as SearchIcon, X as XIcon } from "lucide-react";
import { ViewFilter } from "./view-filter";
import { formatDate, formatMonthYear } from "@/lib/format";
import { ToolbarIconButton } from "@/components/shared/toolbar-icon-button";

type TransactionToolbarProps = {
  // Page actions (import, export…) shown on the right, before undo/redo.
  actions?: ReactNode;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  isUndoPending?: boolean;
  earliestTransactionYear: number;
  defaultRange?: { start: string | null; end: string | null };
  categories: { id: string; name: string }[];
  searchPlaceholder?: string;
  /**
   * The page's navigation transition, so filter/search pushes share one
   * pending state with the table (which dims while results load).
   */
  startNavigation?: (fn: () => void) => void;
};

export function TransactionToolbar({
  actions,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  isUndoPending = false,
  earliestTransactionYear,
  defaultRange,
  categories,
  searchPlaceholder = "Search transactions",
  startNavigation,
}: TransactionToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startLocalTransition] = useTransition();
  const startTransition = startNavigation ?? startLocalTransition;

  const [searchText, setSearchText] = useState(searchParams.get("search") ?? "");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);
  // Tracks the last value we pushed to the URL. The URL→state sync below
  // skips its own echo so it can't clobber keystrokes typed during the
  // debounce/revalidate roundtrip, while still honoring external changes
  // (back/forward, links).
  const lastPushedRef = useRef(searchParams.get("search") ?? "");

  useEffect(() => {
    const urlValue = searchParams.get("search") ?? "";
    if (urlValue === lastPushedRef.current) return;
    lastPushedRef.current = urlValue;
    setSearchText(urlValue);
  }, [searchParams]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Search should span all transaction history, not just the route's default
  // "this month" window. So when the user searches without an explicitly
  // pinned month range, widen to ?range=all; clearing the search drops that
  // auto-widen so we fall back to the fast default. A pinned range (start/end)
  // is left alone — searching inside it stays scoped to it intentionally.
  const routeDefaultsToMonth = Boolean(defaultRange?.start || defaultRange?.end);
  const navigateSearch = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const hasPinnedRange = Boolean(params.get("start") || params.get("end"));
    if (value) {
      params.set("search", value);
      if (routeDefaultsToMonth && !hasPinnedRange) params.set("range", "all");
    } else {
      params.delete("search");
      if (routeDefaultsToMonth && !hasPinnedRange) params.delete("range");
    }
    lastPushedRef.current = value;
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  const dropParams = (...keys: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    keys.forEach((k) => params.delete(k));
    const next = params.toString();
    startTransition(() => {
      router.push(next ? `?${next}` : "?");
    });
  };

  // Build the active-filter chips from URL params, mirroring the same effective
  // range logic as page.tsx so a cookie-only default still surfaces as a chip.
  // Kept in sync with /transactions and /accounts/[id] param names — both
  // routes feed the same chip strip.
  const category = searchParams.get("category");
  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");
  const range = searchParams.get("range");
  const importSource = searchParams.get("import_source");
  const sourceGroup = searchParams.get("source_group");
  const sourceCategory = searchParams.get("source_category");
  const search = searchParams.get("search");
  // `?date=` is the Insights calendar's single-day drill. It overrides the month
  // range in the query (page.tsx), so the chip has to reflect it too — otherwise
  // the strip advertises the saved range ("May 2026 – Jul 2026") while the table
  // shows one day in March, and there's no control that clears the day.
  const dateParam = searchParams.get("date");
  const singleDay = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;

  const effectiveStart =
    range === "all" ? null : (urlStart ?? defaultRange?.start ?? null);
  const effectiveEnd =
    range === "all" ? null : (urlEnd ?? defaultRange?.end ?? null);

  const filterChips: { key: string; value: string; onRemove: () => void }[] = [];

  if (category && category !== "uncategorized") {
    const cat = categories.find((c) => c.id === category);
    if (cat)
      filterChips.push({
        key: "category",
        value: cat.name,
        onRemove: () => dropParams("category"),
      });
  }
  if (category === "uncategorized") {
    filterChips.push({
      key: "category",
      value: "Uncategorized",
      // Mirror the banner: clearing the uncategorized filter also reverts the
      // date axis "View" widened to all dates, so we land on the saved default
      // (generally this month) rather than the slow all-time list. A search
      // intentionally spans all history, so keep the range when one is active.
      onRemove: () =>
        search ? dropParams("category") : dropParams("category", "range", "start", "end"),
    });
  }
  if (singleDay) {
    // The day wins over the month range — same precedence as the query. Removing
    // it drops `date` only, landing back on whatever range was already saved.
    filterChips.push({
      key: "dates",
      value: formatDate(singleDay),
      onRemove: () => dropParams("date"),
    });
  } else if (effectiveStart || effectiveEnd) {
    const startLabel = effectiveStart
      ? formatMonthYear(`${effectiveStart}-01`)
      : "earliest";
    const endLabel = effectiveEnd
      ? formatMonthYear(`${effectiveEnd}-01`)
      : "latest";
    filterChips.push({
      key: "dates",
      value:
        effectiveStart === effectiveEnd
          ? startLabel
          : `${startLabel} – ${endLabel}`,
      // Force ?range=all to override the saved cookie default — matches the
      // old "Clear filters" semantic for the date axis.
      onRemove: () => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("start");
        params.delete("end");
        params.set("range", "all");
        startTransition(() => {
          router.push(`?${params.toString()}`);
        });
      },
    });
  }
  if (importSource === "everydollar" || importSource === "ynab") {
    filterChips.push({
      key: "import_source",
      value: importSource === "everydollar" ? "EveryDollar" : "YNAB",
      onRemove: () => dropParams("import_source"),
    });
  }
  if (sourceGroup)
    filterChips.push({
      key: "source_group",
      value: sourceGroup,
      onRemove: () => dropParams("source_group"),
    });
  if (sourceCategory)
    filterChips.push({
      key: "source_category",
      value: sourceCategory,
      onRemove: () => dropParams("source_category"),
    });
  if (search)
    filterChips.push({
      key: "search",
      value: `"${search}"`,
      onRemove: () => {
        setSearchText("");
        navigateSearch("");
      },
    });

  return (
    // One control row, same shape as the budget page: filters and active
    // filter chips on the left; quiet icon actions, then search, on the right.
    <div className="sticky top-0 z-20 border-b border-border/50 bg-background">
      <div className="flex items-center gap-3 pl-2 pr-3 h-toolbar">
        <div className="flex items-center gap-1.5 shrink-0">

          <ViewFilter
            earliestTransactionYear={earliestTransactionYear}
            defaultRange={defaultRange}
            activeFilterCount={filterChips.length}
          />

          {filterChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 h-8 shrink-0 pl-3 pr-1 rounded-lg border border-primary/30 bg-primary/15 text-[14px] text-foreground whitespace-nowrap"
            >
              <span className="font-action">{chip.value}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove ${chip.value} filter`}
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:bg-primary/25 hover:text-foreground transition-colors"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-0.5 min-w-0">
          {actions}
          <ToolbarIconButton
            label="Undo"
            keys={["⌘", "Z"]}
            disabled={!canUndo || isUndoPending}
            onClick={onUndo}
          >
            <Undo2 />
          </ToolbarIconButton>
          <ToolbarIconButton
            label="Redo"
            keys={["⇧", "⌘", "Z"]}
            disabled={!canRedo || isUndoPending}
            onClick={onRedo}
          >
            <Redo2 />
          </ToolbarIconButton>
          <label className="ml-1.5 inline-flex items-center gap-1.5 w-56 min-w-36 shrink h-8 pl-3 pr-3 rounded-lg border border-input bg-muted text-[14px] text-foreground transition-colors focus-within:ring-2 focus-within:ring-ring/40">
            <SearchIcon
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              aria-label="Search transactions"
              placeholder={searchPlaceholder}
              value={searchText}
              onChange={(e) => {
                const value = e.target.value;
                setSearchText(value);
                if (searchTimeout.current) clearTimeout(searchTimeout.current);
                searchTimeout.current = setTimeout(() => navigateSearch(value), 300);
              }}
              className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
            />
            <kbd className="shrink-0 text-[10px] font-medium text-muted-foreground tracking-wider">
              ⌘K
            </kbd>
          </label>
        </div>
      </div>
    </div>
  );
}
