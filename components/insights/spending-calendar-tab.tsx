"use client";

import { useMemo } from "react";
import Link from "next/link";
// eslint-disable-next-line no-restricted-imports -- custom compact/parts format that already gates on `hidden` via maskCurrency below.
import { formatCurrencyParts, formatDate, maskCurrency } from "@/lib/format";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { heatColorFor } from "./heat-ramp";
import type { SpendingCalendarData } from "@/app/(app)/insights/actions";
import { Receipt } from "lucide-react";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
// Weekday strip reads Mon→Sun (weekend on the right). Data is indexed
// Sun(0)…Sat(6), so map display position → data index.
const STRIP_ORDER = [1, 2, 3, 4, 5, 6, 0];
const STRIP_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Grid rows are weekdays Sun(0, top)…Sat(6, bottom); label every row.
const ROW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Cell = { date: string; total: number } | null;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// GitHub layout: column-major weeks. Cells are emitted top→bottom within a week
// then to the next column, so a CSS grid with `grid-flow-col` + 7 rows lays them
// out correctly. Lead with empty cells so Jan 1 lands on its real weekday row.
function buildCalendar(data: SpendingCalendarData): {
  cells: Cell[];
  monthLabels: string[];
  numColumns: number;
} {
  const totalsByDate = new Map(data.days.map((d) => [d.date, d.total]));
  const year = data.year;
  const jan1 = new Date(`${year}-01-01T00:00:00`);
  const firstWeekday = jan1.getDay();

  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);

  const cursor = new Date(jan1);
  while (cursor.getFullYear() === year) {
    const key = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
    cells.push({ date: key, total: totalsByDate.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const numColumns = cells.length / 7;
  const monthLabels = new Array(numColumns).fill("");
  let lastMonth = -1;
  for (let c = 0; c < numColumns; c++) {
    for (let r = 0; r < 7; r++) {
      const cell = cells[c * 7 + r];
      if (cell) {
        const m = Number(cell.date.slice(5, 7)) - 1;
        if (m !== lastMonth) {
          monthLabels[c] = MONTH_LABELS[m];
          lastMonth = m;
        }
        break;
      }
    }
  }
  return { cells, monthLabels, numColumns };
}

// Heat ramp: cool green (calm) → gold → orange → red (extreme), swept in oklch
// so the hue itself carries magnitude. Position is on a LOG scale anchored to
// the data's p5…p95 — magnitude-aware (a genuinely huge day runs red) and
// robust to outliers at both ends. Spans ~$100 → ~$100k cleanly.
type HeatDomain = { loLog: number; hiLog: number };

function heatDomain(totals: number[]): HeatDomain {
  const sorted = totals.filter((t) => t > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { loLog: 2, hiLog: 5 };
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  // Floor at the 10th percentile (a sensible "ordinary day"), ceiling at the
  // single biggest day. Keeps the median green and reserves red for the genuine
  // blow-out days, while the log scale spreads everything between.
  const lo = q(0.1);
  let hi = sorted[sorted.length - 1];
  if (hi <= lo) hi = lo * 2; // single distinct value
  return { loLog: Math.log10(lo), hiLog: Math.log10(hi) };
}

// Compact currency for the legend endpoints: $101, $7k, $387k.
function compactDollars(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

function heatBg(total: number, domain: HeatDomain): string | undefined {
  if (total <= 0) return undefined;
  const t = (Math.log10(total) - domain.loLog) / (domain.hiLog - domain.loLog);
  return heatColorFor(t);
}

function CalendarTile({ cell, domain }: { cell: { date: string; total: number }; domain: HeatDomain }) {
  const fmt = useMaskedCurrency();
  const { date, total } = cell;
  const hasValue = total > 0;
  const bg = heatBg(total, domain);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          hasValue ? (
            <Link
              href={`/transactions?date=${date}`}
              className="block aspect-square w-full rounded-[3px] transition-shadow hover:ring-2 hover:ring-ring/40"
              style={{ backgroundColor: bg }}
            />
          ) : (
            <div className="aspect-square w-full rounded-[3px] bg-muted-foreground/20" />
          )
        }
      />
      <TooltipContent className="flex-col items-stretch gap-0.5 p-2.5">
        <div className="font-medium">{formatDate(date)}</div>
        <div className="tabular-nums zero-amount">
          {hasValue ? fmt(total) : "No spending"}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function WeekdayStrip({ averages }: { averages: number[] }) {
  const { hidden } = useAmountsHidden();
  const maxAvg = Math.max(...averages, 0);
  const peakIdx = averages.indexOf(maxAvg);
  return (
    <div className="flex gap-2 mb-6">
      {STRIP_ORDER.map((idx, pos) => {
        const avg = averages[idx];
        const pct = maxAvg > 0 ? (avg / maxAvg) * 100 : 0;
        const isPeak = idx === peakIdx && avg > 0;
        return (
          <div
            key={idx}
            className={cn(
              "flex-1 rounded-lg border border-border bg-card px-3 py-2.5",
              isPeak && "ring-2 ring-primary/50"
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">{STRIP_LABELS[pos]}</span>
              {isPeak && (
                <span className="text-[10px] uppercase tracking-wider text-primary">
                  peak
                </span>
              )}
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground zero-amount">
              {hidden ? maskCurrency(avg) : formatCurrencyParts(avg).dollars}
            </div>
            {/* Intensity as a bar — keeps the heatmap ranking without putting
                text on a saturated fill (unreadable in dark mode). */}
            <div className="mt-2 h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: "var(--color-primary)" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Gradient legend so the multi-hue ramp is decodable. Labels the p5…p95 anchors
// the colors are stretched across.
function HeatLegend({ domain }: { domain: HeatDomain }) {
  const { hidden } = useAmountsHidden();
  const stops = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => `${heatColorFor(t)} ${t * 100}%`)
    .join(", ");
  const lo = 10 ** domain.loLog;
  const hi = 10 ** domain.hiLog;
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-[11px] tabular-nums text-muted-foreground zero-amount">
        {hidden ? maskCurrency(lo) : compactDollars(lo)}
      </span>
      <div
        className="h-2.5 w-28 rounded-full"
        style={{ background: `linear-gradient(to right, ${stops})` }}
      />
      <span className="text-[11px] tabular-nums text-muted-foreground zero-amount">
        {hidden ? maskCurrency(hi) : compactDollars(hi)}
      </span>
    </div>
  );
}

type SpendingCalendarTabProps = {
  data: SpendingCalendarData;
};

export function SpendingCalendarTab({ data }: SpendingCalendarTabProps) {
  const { cells, monthLabels, numColumns } = useMemo(
    () => buildCalendar(data),
    [data]
  );
  const domain = useMemo(
    () => heatDomain(data.days.map((d) => d.total)),
    [data]
  );

  return (
    <div className="flex flex-col">
      {data.days.length === 0 ? (
        <EmptyState
          icon={Receipt}
          message="No spending in this year yet. Pick another year or wait for activity to land."
        />
      ) : (
        <section className="px-6 py-5">
          <WeekdayStrip averages={data.weekdayAverages} />

          <div className="flex justify-end mb-4">
            <HeatLegend domain={domain} />
          </div>

          <TooltipProvider delay={120}>
            <div className="flex gap-2 items-stretch">
              {/* Weekday row labels (Sun…Sat) — full height, one per row */}
              <div className="flex flex-col shrink-0">
                <div className="h-[22px]" />
                <div className="grid grid-rows-7 gap-1 flex-1">
                  {ROW_LABELS.map((label, i) => (
                    <div
                      key={i}
                      className="flex items-center text-xs leading-none text-muted-foreground pr-1"
                    >
                      {label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Month labels + the calendar grid — stretches to fill width */}
              <div className="flex-1 min-w-0">
                <div
                  className="grid gap-1 mb-1.5 h-[16px]"
                  style={{ gridTemplateColumns: `repeat(${numColumns}, minmax(0, 1fr))` }}
                >
                  {monthLabels.map((label, c) => (
                    <div
                      key={c}
                      className="text-xs leading-none text-muted-foreground whitespace-nowrap"
                    >
                      {label}
                    </div>
                  ))}
                </div>
                <div
                  className="grid grid-flow-col grid-rows-7 gap-1"
                  style={{ gridTemplateColumns: `repeat(${numColumns}, minmax(0, 1fr))` }}
                >
                  {cells.map((cell, i) =>
                    cell ? (
                      <CalendarTile key={i} cell={cell} domain={domain} />
                    ) : (
                      <div key={i} className="aspect-square w-full" />
                    )
                  )}
                </div>
              </div>
            </div>
          </TooltipProvider>
        </section>
      )}
    </div>
  );
}
