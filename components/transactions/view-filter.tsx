"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListFilter } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  writeTxRangeCookie,
  writeTxRangePresetCookie,
  computePresetRange,
  TX_RANGE_PRESETS,
  type TxRangePresetKey,
} from "@/lib/tx-range-cookie";

type ViewFilterProps = {
  earliestTransactionYear: number;
  /**
   * The route's default range. Bare URL = this range; user choices that match
   * it are written as bare URLs to stay clean. /accounts/[id] passes the
   * current month; /transactions omits this (default = all dates).
   */
  defaultRange?: { start: string | null; end: string | null };
  /**
   * Total number of active filters across the toolbar (date, category, search,
   * source). Shown as a "(N)" suffix on the trigger. Counted by the parent
   * because non-date filters live outside this popover.
   */
  activeFilterCount?: number;
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, "0"),
  label: format(new Date(2000, i, 1), "MMMM"),
}));

// Tailwind classes that mirror SelectTrigger's appearance for native <select>.
// Using native <select> here keeps the dropdown inside the popover's DOM tree
// — base-ui Select renders into a Portal, which the Popover treats as
// outside-click and dismisses on every interaction.
const nativeSelectClass =
  "h-8 rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

export function ViewFilter({
  earliestTransactionYear,
  defaultRange,
  activeFilterCount = 0,
}: ViewFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const defaultStart = defaultRange?.start ?? null;
  const defaultEnd = defaultRange?.end ?? null;

  const urlStart = searchParams.get("start") ?? "";
  const urlEnd = searchParams.get("end") ?? "";
  const urlRange = searchParams.get("range") ?? "";

  // Effective range: ?range=all wins (explicit override of route default);
  // otherwise URL start/end win; otherwise the route's default.
  const effectiveStart: string | null =
    urlRange === "all" ? null : urlStart || defaultStart;
  const effectiveEnd: string | null =
    urlRange === "all" ? null : urlEnd || defaultEnd;

  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState(effectiveStart ?? "");
  const [pendingEnd, setPendingEnd] = useState(effectiveEnd ?? "");

  // When the popover opens (or the effective range changes), reset pending
  // to the effective range so the From/To selects reflect what's actually
  // applied. Outside-click / Cancel discards back to this baseline (P-03).
  useEffect(() => {
    if (open) {
      setPendingStart(effectiveStart ?? "");
      setPendingEnd(effectiveEnd ?? "");
    }
  }, [open, effectiveStart, effectiveEnd]);

  // The trigger uses outline (vs ghost) when the active filter diverges from
  // the route's default. On /transactions that means "any range is set"; on
  // /accounts/[id] that means "not on this month."
  const hasFilter = effectiveStart !== defaultStart || effectiveEnd !== defaultEnd;

  // Drop ?start/?end/?range and navigate bare so the server re-reads the
  // cookie as the new default. Shared by both commit paths.
  const commitBare = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("start");
    params.delete("end");
    params.delete("range");
    const next = params.toString();
    startTransition(() => {
      router.push(next ? `?${next}` : "?");
      router.refresh();
    });
    setOpen(false);
  };

  // Custom From/To range → persisted as absolute months (the user picked exact
  // months, so they stay put).
  const commitRange = (start: string | null, end: string | null) => {
    writeTxRangeCookie({ start, end });
    commitBare();
  };

  // Named preset → persisted as intent so "This month" (and the other relative
  // presets) re-resolve against the clock on the next render instead of
  // freezing to the month they were picked in.
  const commitPreset = (key: TxRangePresetKey) => {
    writeTxRangePresetCookie(key);
    commitBare();
  };

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const out: number[] = [];
    for (let y = currentYear; y >= earliestTransactionYear; y--) out.push(y);
    return out;
  }, [earliestTransactionYear]);

  // Keep partial selections sticky. updateStart/End stash the placeholder
  // sentinels ("____" for unset year, "__" for unset month) so the
  // half-chosen value survives a re-render — splitParts must understand
  // them, otherwise picking a month before a year (or vice versa) makes
  // the dropdown bounce back to its placeholder.
  const splitParts = (key: string) => {
    if (!key) return { year: "", month: "" };
    const m = key.match(/^(\d{4}|____)-(0[1-9]|1[0-2]|__)$/);
    if (!m) return { year: "", month: "" };
    return {
      year: m[1] === "____" ? "" : m[1],
      month: m[2] === "__" ? "" : m[2],
    };
  };
  const startParts = splitParts(pendingStart);
  const endParts = splitParts(pendingEnd);

  const startValid = pendingStart === "" || /^\d{4}-\d{2}$/.test(pendingStart);
  const endValid = pendingEnd === "" || /^\d{4}-\d{2}$/.test(pendingEnd);
  const rangeOk = !pendingStart || !pendingEnd || pendingStart <= pendingEnd;
  const datesChanged =
    (pendingStart || null) !== effectiveStart ||
    (pendingEnd || null) !== effectiveEnd;
  const applyEnabled = startValid && endValid && rangeOk && datesChanged;

  const updateStart = (year: string, month: string) => {
    if (!year && !month) setPendingStart("");
    else if (year && month) setPendingStart(`${year}-${month}`);
    else setPendingStart(`${year || "____"}-${month || "__"}`);
  };
  const updateEnd = (year: string, month: string) => {
    if (!year && !month) setPendingEnd("");
    else if (year && month) setPendingEnd(`${year}-${month}`);
    else setPendingEnd(`${year || "____"}-${month || "__"}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant={hasFilter || activeFilterCount > 0 ? "outline" : "ghost"}
            size="sm"
            // h-8 / rounded-lg to match the search field and the control
            // row's other controls.
            className="h-8 rounded-lg shrink-0"
            aria-label="Open filters"
          >
            <ListFilter className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
        }
      />
      <PopoverContent align="start" sideOffset={6} className="w-[580px] p-4 gap-0">
        <div className="flex flex-nowrap items-center gap-1 pb-3">
          {TX_RANGE_PRESETS.map((preset) => {
            const target = computePresetRange(preset.key, new Date());
            const isActive =
              (target.start ?? null) === effectiveStart &&
              (target.end ?? null) === effectiveEnd;
            return (
              <Button
                key={preset.key}
                size="sm"
                variant={isActive ? "default" : "ghost"}
                className="h-7 text-[12px]"
                onClick={() => commitPreset(preset.key)}
              >
                {preset.label}
              </Button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3 py-3 border-t border-border/50">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              From
            </label>
            <div className="flex gap-1.5">
              <select
                aria-label="From month"
                value={startParts.month}
                onChange={(e) => updateStart(startParts.year, e.target.value)}
                className={cn(nativeSelectClass, "flex-1")}
              >
                <option value="" disabled>
                  Month
                </option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="From year"
                value={startParts.year}
                onChange={(e) => updateStart(e.target.value, startParts.month)}
                className={cn(nativeSelectClass, "w-24")}
              >
                <option value="" disabled>
                  Year
                </option>
                {yearOptions.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              To
            </label>
            <div className="flex gap-1.5">
              <select
                aria-label="To month"
                value={endParts.month}
                onChange={(e) => updateEnd(endParts.year, e.target.value)}
                className={cn(nativeSelectClass, "flex-1")}
              >
                <option value="" disabled>
                  Month
                </option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="To year"
                value={endParts.year}
                onChange={(e) => updateEnd(e.target.value, endParts.month)}
                className={cn(nativeSelectClass, "w-24")}
              >
                <option value="" disabled>
                  Year
                </option>
                {yearOptions.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {!rangeOk ? (
          <p className="text-xs text-negative pb-2">
            From must be on or before to.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPendingStart(effectiveStart ?? "");
              setPendingEnd(effectiveEnd ?? "");
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={!applyEnabled}
            onClick={() =>
              commitRange(pendingStart || null, pendingEnd || null)
            }
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
