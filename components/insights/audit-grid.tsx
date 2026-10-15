"use client";

import { Fragment, useState, useMemo } from "react";
import Link from "next/link";
import { LineChart, Line, YAxis } from "recharts";
import { ArrowDown, ArrowUp, ChevronRight, Receipt } from "lucide-react";
import { cn, tableHeaderRow, stickyColShadow, stickyColScroll } from "@/lib/utils";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import type {
  AuditPivotData,
  AuditCategoryRow,
} from "@/app/(app)/insights/actions";

type SortKey = "budget" | "name" | "total" | number; // "budget" = budget-page order; number = column key (year or month index)

type AuditGridProps = {
  data: AuditPivotData;
};

// colKey is a calendar year (year mode) or a 0–11 month index (month mode).
function drillHref(
  row: AuditCategoryRow,
  colKey: number,
  monthlyYear: number | undefined
): string {
  if (row.drill.kind === "zero") {
    const cat = encodeURIComponent(row.drill.categoryId);
    if (monthlyYear != null) {
      const mm = String(colKey + 1).padStart(2, "0");
      return `/transactions?category=${cat}&start=${monthlyYear}-${mm}&end=${monthlyYear}-${mm}`;
    }
    return `/transactions?category=${cat}&start=${colKey}-01&end=${colKey}-12`;
  }
  return `/transactions?import_source=${row.drill.importSource}&source_category=${encodeURIComponent(row.drill.sourceCategory)}&start=${colKey}-01&end=${colKey}-12`;
}

const cellClass =
  "h-12 px-3 text-right tabular-nums whitespace-nowrap min-w-[88px]";
const sparkClass = "h-12 px-3 whitespace-nowrap w-[120px]";

function AuditAmount({ amount }: { amount: number }) {
  const fmt = useMaskedCurrency();
  if (amount === 0) return <span className="text-muted-foreground/50">—</span>;
  // Net spending: outflows render negative. Display as absolute positive
  // (audit reads as "spent $X" not "−$X"). Refunds-net cells that come out
  // positive are unusual — tint them so they stand out.
  const isNetInflow = amount > 0;
  const display = Math.abs(amount);
  return (
    <span
      className={cn(
        "zero-amount",
        isNetInflow && "text-[color:var(--color-positive)]"
      )}
    >
      {fmt(display)}
    </span>
  );
}

const SPARK_W = 96;
const SPARK_H = 24;

// Trend sparkline values depend on the granularity:
// - Month view: the running-balance trajectory (signed) — savings envelopes
//   climb, expense envelopes hover near zero. Balance flow is post-cutoff only,
//   which is meaningful within a single year.
// - Year view: per-year spend magnitude. The balance series is flat across
//   pre-cutoff years (no post-cutoff data), so we plot |yearly net| instead —
//   restoring the year-over-year wavy shape (bigger spend = higher peak).
function trendValues(
  row: { balances?: number[]; yearTotals: Record<number, number> },
  years: number[],
  monthlyYear: number | undefined
): number[] {
  if (monthlyYear != null) {
    return row.balances ?? years.map((y) => row.yearTotals[y] ?? 0);
  }
  return years.map((y) => Math.abs(row.yearTotals[y] ?? 0));
}

// Auto-fit domain shows the shape regardless of scale.
function Sparkline({ values }: { values: number[] }) {
  const points = values.map((v, i) => ({ i, v }));
  return (
    <LineChart
      data={points}
      width={SPARK_W}
      height={SPARK_H}
      margin={{ top: 2, bottom: 2, left: 0, right: 0 }}
    >
      <YAxis hide domain={["dataMin", "dataMax"]} />
      <Line
        type="monotone"
        dataKey="v"
        stroke="currentColor"
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}

export function AuditGrid({ data }: AuditGridProps) {
  const { years, groups, columnLabels, monthlyYear } = data;
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.groupKey, true]))
  );

  const anyExpanded = Object.values(expanded).some(Boolean);

  const handleHeaderSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sortedGroups = useMemo(() => {
    const sortCats = (cats: AuditCategoryRow[]) => {
      const copy = [...cats];
      // "budget" preserves the server order (budget-page sort_order); archive
      // group already arrives alphabetical.
      if (sortKey === "budget") return copy;
      copy.sort((a, b) => {
        let av = 0;
        let bv = 0;
        if (sortKey === "name") {
          return sortDir === "asc"
            ? a.displayName.localeCompare(b.displayName)
            : b.displayName.localeCompare(a.displayName);
        } else if (sortKey === "total") {
          av = Math.abs(a.total);
          bv = Math.abs(b.total);
        } else {
          av = Math.abs(a.yearTotals[sortKey] ?? 0);
          bv = Math.abs(b.yearTotals[sortKey] ?? 0);
        }
        return sortDir === "asc" ? av - bv : bv - av;
      });
      return copy;
    };
    return groups.map((g) => ({ ...g, categories: sortCats(g.categories) }));
  }, [groups, sortKey, sortDir]);

  if (years.length === 0 || groups.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <EmptyState
          icon={Receipt}
          message="No envelope activity to show yet. Import some history or wait for activity to land."
        />
      </div>
    );
  }

  const SortIcon = ({ active }: { active: boolean }) => {
    if (!active) return null;
    const Icon = sortDir === "asc" ? ArrowUp : ArrowDown;
    return <Icon className="inline-block h-3 w-3 ml-1" />;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto" onScroll={stickyColScroll}>
        <table className="border-separate border-spacing-0">
          <thead>
            <tr className={tableHeaderRow}>
              <th
                className={cn(
                  "h-12 pl-6 pr-3 text-left sticky left-0 bg-card whitespace-nowrap z-20",
                  stickyColShadow
                )}
              >
                <button
                  type="button"
                  onClick={() => handleHeaderSort("name")}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-150 mr-0.5",
                      anyExpanded && "rotate-90"
                    )}
                    strokeWidth={2}
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = !anyExpanded;
                      setExpanded(
                        Object.fromEntries(groups.map((g) => [g.groupKey, next]))
                      );
                    }}
                  />
                  Category
                  <SortIcon active={sortKey === "name"} />
                </button>
              </th>
              {years.map((y) => (
                <th key={y} className={cn(cellClass, "h-12 text-right")}>
                  <button
                    type="button"
                    onClick={() => handleHeaderSort(y)}
                    className="hover:text-foreground transition-colors"
                  >
                    {columnLabels?.[y] ?? y}
                    <SortIcon active={sortKey === y} />
                  </button>
                </th>
              ))}
              <th className={cn(cellClass, "h-12 text-right")}>
                <button
                  type="button"
                  onClick={() => handleHeaderSort("total")}
                  className="hover:text-foreground transition-colors"
                >
                  Total
                  <SortIcon active={sortKey === "total"} />
                </button>
              </th>
              <th className={cn(sparkClass, "h-12 text-left")}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {sortedGroups.map((group) => {
              const groupExpanded = expanded[group.groupKey] ?? true;
              return (
                <Fragment key={group.groupKey}>
                  <tr
                    role="button"
                    tabIndex={0}
                    aria-expanded={groupExpanded}
                    onClick={() =>
                      setExpanded((p) => ({
                        ...p,
                        [group.groupKey]: !groupExpanded,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded((p) => ({
                          ...p,
                          [group.groupKey]: !groupExpanded,
                        }));
                      }
                    }}
                    className="bg-accent/40 text-[13px] font-semibold cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <th
                      scope="row"
                      className={cn(
                        "h-12 pl-6 pr-3 text-left sticky left-0 bg-accent-solid whitespace-nowrap font-semibold z-10",
                        stickyColShadow
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 text-foreground/90 transition-transform duration-150",
                            groupExpanded && "rotate-90"
                          )}
                          strokeWidth={2}
                        />
                        <span className="text-base text-foreground/90">
                          {group.groupName}
                        </span>
                        <Badge className="ml-1.5 tabular-nums">{group.categories.length}</Badge>
                      </div>
                    </th>
                    {years.map((y) => (
                      <td key={y} className={cn(cellClass, "text-muted-foreground")}>
                        <AuditAmount amount={group.yearTotals[y] ?? 0} />
                      </td>
                    ))}
                    <td className={cn(cellClass, "text-muted-foreground")}>
                      <AuditAmount amount={group.total} />
                    </td>
                    <td className={cn(sparkClass, "text-muted-foreground/60")}>
                      <Sparkline values={trendValues(group, years, monthlyYear)} />
                    </td>
                  </tr>
                  {groupExpanded &&
                    group.categories.map((cat) => (
                      <AuditCategoryRowView
                        key={cat.rowKey}
                        cat={cat}
                        years={years}
                        monthlyYear={monthlyYear}
                      />
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditCategoryRowView({
  cat,
  years,
  monthlyYear,
}: {
  cat: AuditCategoryRow;
  years: number[];
  monthlyYear: number | undefined;
}) {
  return (
    <tr className="text-[15px] border-b border-border/40 bg-card hover:bg-accent/30 h-12 text-muted-foreground">
      <td
        className={cn(
          "h-12 pl-6 pr-3 sticky left-0 bg-card whitespace-nowrap z-10",
          stickyColShadow
        )}
      >
        <span
          className={cn(
            "text-foreground/80 pl-[18px] inline-block",
            cat.archived && "italic text-muted-foreground"
          )}
        >
          {cat.displayName}
          {cat.archived && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              hidden
            </span>
          )}
        </span>
      </td>
      {years.map((y) => {
        const amount = cat.yearTotals[y] ?? 0;
        if (amount === 0) {
          return (
            <td key={y} className={cellClass}>
              <AuditAmount amount={0} />
            </td>
          );
        }
        return (
          <td key={y} className={cellClass}>
            <Link
              href={drillHref(cat, y, monthlyYear)}
              className="hover:text-foreground hover:underline underline-offset-2"
            >
              <AuditAmount amount={amount} />
            </Link>
          </td>
        );
      })}
      <td className={cn(cellClass, "text-foreground/80 font-medium")}>
        <AuditAmount amount={cat.total} />
      </td>
      <td className={cn(sparkClass, "text-muted-foreground/70")}>
        <Sparkline values={trendValues(cat, years, monthlyYear)} />
      </td>
    </tr>
  );
}
