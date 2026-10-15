"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatDate, maskCurrency } from "@/lib/format";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { cn } from "@/lib/utils";
import type { NetWorthPoint } from "@/lib/net-worth-series";
import {
  filterByRange,
  computeHeader,
  computeYDomain,
  type RangeKey,
} from "./net-worth-chart-utils";

type NetWorthChartProps = {
  points: NetWorthPoint[];
};

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function compactMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${Math.round(v)}`;
}

const RANGES: RangeKey[] = ["1M", "3M", "6M", "1Y", "All"];

const RANGE_LABEL: Record<RangeKey, string> = {
  "1M": "past month",
  "3M": "past 3 months",
  "6M": "past 6 months",
  "1Y": "past year",
  "All": "all time",
};

type TooltipPayload = { value: number };

function NetWorthTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: unknown;
}) {
  const fmt = useMaskedCurrency();
  if (!active || !payload?.length) return null;
  const value = Number(payload[0].value);

  let dateLabel = "";
  if (typeof label === "string") {
    try {
      dateLabel = formatDate(label);
    } catch {
      dateLabel = label;
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-popover px-3 py-2 shadow-sm">
      <div className="text-xs text-muted-foreground">{dateLabel}</div>
      <Badge intent={value < 0 ? "negative" : "brand"} className="tabular-nums zero-amount">
        {fmt(value)}
      </Badge>
    </div>
  );
}

export function NetWorthChart({ points }: NetWorthChartProps) {
  const fmt = useMaskedCurrency();
  const { hidden } = useAmountsHidden();
  const today = todayDateStr();
  const [range, setRange] = useState<RangeKey>("All");

  const visiblePoints = useMemo(
    () => filterByRange(points, range, today),
    [points, range, today]
  );
  const header = useMemo(() => computeHeader(visiblePoints), [visiblePoints]);
  const yAxis = useMemo(() => computeYDomain(visiblePoints), [visiblePoints]);

  const deltaSign =
    header.delta > 0 ? "positive" : header.delta < 0 ? "negative" : "neutral";

  const pctLabel =
    header.pct === null
      ? "—"
      : `${header.pct >= 0 ? "+" : ""}${header.pct.toFixed(1)}%`;

  const deltaLabel = `${header.delta >= 0 ? "+" : ""}${fmt(header.delta)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="text-xs font-medium text-muted-foreground">Net worth</div>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground zero-amount">
            {fmt(header.current)}
          </span>
          {header.hasData ? (
            <span
              className={cn(
                "text-sm tabular-nums font-medium",
                deltaSign === "positive" && "text-positive",
                deltaSign === "negative" && "text-negative",
                deltaSign === "neutral" && "text-muted-foreground"
              )}
            >
              <span className="zero-amount">{deltaLabel}</span> ({pctLabel})
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {RANGE_LABEL[range]}
          </span>
        </div>
      </div>

      <Tabs value={range} onValueChange={(v) => setRange(v as RangeKey)}>
        <TabsList variant="line">
          {RANGES.map((r) => (
            <TabsTrigger key={r} value={r}>
              {r}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visiblePoints.length === 0 ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
          Add an account or tracked asset to start tracking your net worth.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={visiblePoints} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <defs>
              <linearGradient id="net-worth-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--color-primary)", stopOpacity: 0.28 }} />
                <stop offset="100%" style={{ stopColor: "var(--color-primary)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
              stroke="var(--color-border)"
              tickFormatter={(d: unknown) => {
                if (typeof d !== "string") return "";
                try {
                  return formatDate(d);
                } catch {
                  return d;
                }
              }}
              minTickGap={32}
            />
            <YAxis
              domain={yAxis.domain}
              ticks={yAxis.ticks}
              allowDataOverflow
              tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
              stroke="var(--color-border)"
              tickFormatter={(v: unknown) =>
                typeof v === "number"
                  ? hidden
                    ? maskCurrency(v)
                    : compactMoney(v)
                  : ""
              }
              width={60}
            />
            <Tooltip content={<NetWorthTooltip />} />
            <Area
              type="linear"
              dataKey="value"
              stroke="var(--color-primary)"
              strokeWidth={2}
              fill="url(#net-worth-fill)"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
