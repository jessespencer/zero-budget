"use client";

import { useCallback, useMemo, useState } from "react";
import { Receipt, Search } from "lucide-react";
// eslint-disable-next-line no-restricted-imports -- custom whole-dollar (.dollars) format that already gates on `hidden` via maskCurrency below.
import { formatCurrencyParts, maskCurrency } from "@/lib/format";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { colorForName } from "@/lib/chart-colors";
import { InsightsSectionHeader } from "./insights-section-header";
import { CardFilterBar } from "./card-filter-bar";
import { RangeStepper } from "./range-stepper";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { heatColorFor } from "./heat-ramp";
import type {
  AuditPivotData,
  SeasonalityData,
  SeasonalityCell,
  PayeeTrendsData,
} from "@/app/(app)/insights/actions";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Whole-dollar display (matches formatCurrencyParts(x).dollars) that masks to
// "$••••••" in privacy mode. Preserves the exact non-hidden rendering.
function useMaskedDollars() {
  const { hidden } = useAmountsHidden();
  return useCallback(
    (n: number) => (hidden ? maskCurrency(n) : formatCurrencyParts(n).dollars),
    [hidden]
  );
}

type TrendRow = {
  rowKey: string;
  displayName: string;
  archived: boolean;
  total: number; // absolute lifetime spend
  monthlyAvg: number;
  minYear: number;
  maxYear: number;
  percent: number; // bar width, relative to the largest category
};

// One lifetime-spend aggregate before it's ranked into a TrendRow. The year
// dimension is still present; toTrendRows collapses it.
type RankableTotals = {
  rowKey: string;
  displayName: string;
  archived: boolean;
  yearTotals: Record<number, number>;
  total: number; // signed
};

// Collapse year-granular aggregates into one ranked, bar-scaled list. Shared by
// the category grouping (audit pivot) and the payee grouping (payee pivot) so
// both compute $/mo, the active-year range, sorting, and bar width identically
// — the only difference between the two views is what feeds in here.
//
// $/mo averages over the full active span (span years × 12), NOT just months
// with activity — both pivots are year-granular, so per-month counts aren't
// available. $84,000 over ten years → $700/mo. Bars scale to the largest row
// in the whole set, so a payee's width stays stable across the top-25 cap and
// search filtering (same as category bars scaling to the top category).
function toTrendRows(items: RankableTotals[]): TrendRow[] {
  const partial: Omit<TrendRow, "percent">[] = [];
  for (const it of items) {
    const activeYears = Object.entries(it.yearTotals)
      .filter(([, v]) => v !== 0)
      .map(([y]) => Number(y));
    const total = Math.abs(it.total);
    if (activeYears.length === 0 || total === 0) continue;
    const minYear = Math.min(...activeYears);
    const maxYear = Math.max(...activeYears);
    const spanMonths = (maxYear - minYear + 1) * 12;
    partial.push({
      rowKey: it.rowKey,
      displayName: it.displayName,
      archived: it.archived,
      total,
      monthlyAvg: total / spanMonths,
      minYear,
      maxYear,
    });
  }
  partial.sort((a, b) => b.total - a.total);
  const max = partial.length > 0 ? partial[0].total : 0;
  return partial.map((r) => ({
    ...r,
    percent: max > 0 ? (r.total / max) * 100 : 0,
  }));
}

// Category grouping — flatten every group's categories into one ranked list.
function buildTrendRows(data: AuditPivotData): TrendRow[] {
  return toTrendRows(
    data.groups.flatMap((group) =>
      group.categories.map((cat) => ({
        rowKey: cat.rowKey,
        displayName: cat.displayName,
        archived: cat.archived,
        yearTotals: cat.yearTotals,
        total: cat.total,
      }))
    )
  );
}

// Payee grouping — same shape, payee swapped for category. Payees have no
// hidden/archived concept, so the badge never renders.
function buildPayeeTrendRows(data: PayeeTrendsData): TrendRow[] {
  return toTrendRows(
    data.payees.map((p) => ({
      rowKey: `payee::${p.payee}`,
      displayName: p.payee,
      archived: false,
      yearTotals: p.yearTotals,
      total: p.total,
    }))
  );
}

function TrendBar({ row }: { row: TrendRow }) {
  const dollars = useMaskedDollars();
  const total = dollars(row.total);
  const monthly = dollars(row.monthlyAvg);
  const range =
    row.minYear === row.maxYear
      ? `${row.minYear}`
      : `${row.minYear}–${row.maxYear}`;
  return (
    <div className="py-2.5 space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium truncate">
          {row.displayName}
          {row.archived && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              hidden
            </span>
          )}
        </span>
        <span className="text-sm tabular-nums shrink-0 zero-amount">{total}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 rounded-full bg-muted/30 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${row.percent}%`,
              backgroundColor: colorForName(row.displayName),
            }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0 whitespace-nowrap">
          ~<span className="zero-amount">{monthly}</span>/mo · {range}
        </span>
      </div>
    </div>
  );
}

// One heatmap cell. Color uses the shared heat ramp (same as the spending
// calendar), normalized per row (intensity = avg ÷ rowMax) so each category's
// peak month runs darkest and low-spend months stay pale. Zero months stay
// neutral gray. Hover/tap surfaces the average + the per-year values behind it.
function SeasonCell({
  cell,
  monthName,
  rowMax,
}: {
  cell: SeasonalityCell;
  monthName: string;
  rowMax: number;
}) {
  const dollars = useMaskedDollars();
  const hasValue = cell.avg > 0;
  const intensity = rowMax > 0 ? cell.avg / rowMax : 0;
  const background = hasValue ? heatColorFor(intensity) : undefined;

  return (
    <td className="p-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              className={cn(
                "size-6 rounded-[3px] transition-shadow",
                "hover:ring-2 hover:ring-ring/40",
                // Empty months get a neutral gray tile (GitHub-style) so the
                // grid reads as a full matrix, not floating green cells.
                !hasValue && "bg-muted-foreground/20"
              )}
              style={background ? { backgroundColor: background } : undefined}
            />
          }
        />
        <TooltipContent className="flex-col items-stretch gap-1.5 p-2.5">
          <div className="font-medium">
            {monthName} · avg <span className="zero-amount">{dollars(cell.avg)}</span>
          </div>
          {cell.perYear.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {cell.perYear.map((p) => (
                <div
                  key={p.year}
                  className="flex justify-between gap-4 tabular-nums"
                >
                  <span className="text-background/60">{p.year}</span>
                  <span className="zero-amount">{dollars(p.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-background/60">No spending</div>
          )}
        </TooltipContent>
      </Tooltip>
    </td>
  );
}

function SeasonalitySection({ data }: { data: SeasonalityData }) {
  const dollars = useMaskedDollars();
  return (
    <section className="px-6 py-5">
      <TooltipProvider delay={120}>
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="w-[200px]" />
                {MONTH_LABELS.map((label) => (
                  <th
                    key={label}
                    className="w-6 pb-1 text-xs font-medium text-muted-foreground text-center"
                  >
                    {label}
                  </th>
                ))}
                <th className="pl-3 pb-1 text-[11px] font-medium text-muted-foreground/70 text-right whitespace-nowrap">
                  peak
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.categoryId}>
                  <td className="pr-3 align-middle">
                    <div className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {row.displayName}
                      {row.archived && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                          hidden
                        </span>
                      )}
                    </div>
                  </td>
                  {row.months.map((cell, i) => (
                    <SeasonCell
                      key={i}
                      cell={cell}
                      monthName={MONTH_NAMES[i]}
                      rowMax={row.rowMax}
                    />
                  ))}
                  <td className="pl-3 align-middle text-right">
                    <span className="text-[11px] tabular-nums text-muted-foreground/70 whitespace-nowrap zero-amount">
                      {dollars(row.rowMax)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TooltipProvider>
    </section>
  );
}

type TrendsTabProps = {
  data: AuditPivotData;
  payeeData: PayeeTrendsData;
  selectedGroupKeys: string[];
  includeArchived: boolean;
};

type GroupBy = "category" | "payee";

// Default render caps the payee list — a household racks up hundreds of distinct
// merchant strings. Searching lifts the cap (show every match).
const PAYEE_TOP_N = 25;

export function TrendsTab({
  data,
  payeeData,
  selectedGroupKeys,
  includeArchived,
}: TrendsTabProps) {
  const rows = useMemo(() => buildTrendRows(data), [data]);
  const payeeRows = useMemo(() => buildPayeeTrendRows(payeeData), [payeeData]);

  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visiblePayeeRows = useMemo(
    () =>
      q
        ? payeeRows.filter((r) => r.displayName.toLowerCase().includes(q))
        : payeeRows.slice(0, PAYEE_TOP_N),
    [payeeRows, q]
  );


  return (
    <div className="flex flex-col gap-4">
      <InsightsSectionHeader
        title="All-time spending"
        subtitle={
          groupBy === "category"
            ? "Lifetime total spent per category."
            : "Lifetime total spent per payee — search to find any merchant."
        }
        calendarControl={<RangeStepper label="All years" />}
        controls={
          <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <TabsList>
              <TabsTrigger value="category">By category</TabsTrigger>
              <TabsTrigger value="payee">By payee</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <CardFilterBar
          allGroups={data.allGroups}
          selectedGroupKeys={selectedGroupKeys}
          includeArchived={includeArchived}
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            message="No spending history to chart yet. Import some history or wait for activity to land."
          />
        ) : (
          <div className="px-6 py-5">
            {/* Search field matches the transactions-page toolbar field. */}
            {groupBy === "payee" && (
              <label className="mb-4 inline-flex h-9 w-56 items-center gap-1.5 rounded-pill border border-input bg-muted pl-3 pr-3 text-[14px] text-foreground transition-colors focus-within:ring-2 focus-within:ring-ring/40">
                <Search
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search payees"
                  aria-label="Search payees"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </label>
            )}
            {groupBy === "payee" && visiblePayeeRows.length === 0 ? (
              <EmptyState
                variant="compact"
                message={
                  q
                    ? `No payees match “${query.trim()}”.`
                    : "No payee data for this selection yet."
                }
              />
            ) : (
              <div className="flex flex-col divide-y divide-border/30">
                {(groupBy === "category" ? rows : visiblePayeeRows).map((row) => (
                  <TrendBar key={row.rowKey} row={row} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type SeasonalityTabProps = {
  data: SeasonalityData;
};

export function SeasonalityTab({ data }: SeasonalityTabProps) {
  return (
    <div className="flex flex-col">
      {data.rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          message="No spending history to chart yet. Import some history or wait for activity to land."
        />
      ) : (
        <SeasonalitySection data={data} />
      )}
    </div>
  );
}
