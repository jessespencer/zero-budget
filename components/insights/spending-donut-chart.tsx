"use client";

import { useState, useCallback, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Sector } from "recharts";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import type { SpendingItem } from "@/app/(app)/insights/actions";
import { colorForName, BUCKET_COLOR } from "@/lib/chart-colors";

type SpendingDonutChartProps = {
  data: SpendingItem[];
  totalSpending: number;
  onSliceClick?: (item: SpendingItem) => void;
};

const RADIAN = Math.PI / 180;
// Minimum share-of-total to draw an outer label. Smaller slices stay quiet by
// default and surface only on hover, via the active-shape center label.
const LABEL_THRESHOLD = 5;

// Entry-animation timing. Recharts paints slice growth over
// ENTRY_ANIMATION_MS using ease-out, then needs a buffer before we flip
// isAnimationActive off — without the buffer, the flip lands mid-decel
// and the last few frames snap to the final geometry instead of rolling
// to a stop. 400ms past the stated duration covers raf jitter + the final
// settle frame.
const ENTRY_ANIMATION_MS = 1300;
const ENTRY_FREEZE_DELAY_MS = ENTRY_ANIMATION_MS + 400;

// Per-slice adaptive cornerRadius. recharts' Pie passes a single cornerRadius
// to every slice and drops it entirely when the inner arc can't fit
// 2 × radius — so thin slices come out rectangular. We render via custom
// `shape` and compute the radius per-slice from actual inner-arc length:
// big slices land at the full 4px pill, thin slices smoothly fall to ~0.5.
function adaptiveCornerRadius(innerRadius: number, angularExtentDeg: number) {
  const innerArcPx = (innerRadius * angularExtentDeg * Math.PI) / 180;
  // /2.4 (not /2) leaves a hair of straight edge between corners so the
  // rounded ends don't visually overlap. Floor at 0.5 — below that recharts
  // gives up entirely. Cap at 4 to match the Pie's nominal cornerRadius.
  return Math.max(0.5, Math.min(4, innerArcPx / 2.4));
}

export function SpendingDonutChart({ data, totalSpending, onSliceClick }: SpendingDonutChartProps) {
  const fmt = useMaskedCurrency();
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  // Animate slices/labels in on mount, then freeze so hover state changes
  // don't re-trigger the entrance animation (and the label fade-in lag).
  const [animateEntry, setAnimateEntry] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimateEntry(false), ENTRY_FREEZE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  // Ignore mouse enter while the entry animation is still painting — setting
  // activeIndex mid-animation triggers a re-render that recharts' animation
  // state can't survive, leaving slices frozen at whatever geometry they had
  // when the prop changed. After ENTRY_FREEZE_DELAY_MS the slices are settled
  // and it's safe to hover.
  const onMouseEnter = useCallback((_: unknown, index: number) => {
    if (animateEntry) return;
    setActiveIndex(index);
  }, [animateEntry]);

  const onMouseLeave = useCallback(() => {
    setActiveIndex(undefined);
  }, []);

  // Pct is derived from value/totalSpending, not the prop. Recharts spreads
  // the data row into the label props, and our SpendingItem already has a
  // `percent` field (0–100), which would shadow recharts' own 0–1 `percent`
  // and produce values like "5208%".
  const pctOf = (value: number) =>
    totalSpending > 0 ? (value / totalSpending) * 100 : 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderActiveShape(props: any) {
    const {
      cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill,
      payload, value,
    } = props;

    const pct = pctOf(value);

    const labelRadius = outerRadius + 24;
    const lx = cx + labelRadius * Math.cos(-midAngle * RADIAN);
    const ly = cy + labelRadius * Math.sin(-midAngle * RADIAN);
    const lineStart = outerRadius + 10;
    const lineEnd = outerRadius + 18;
    const x1 = cx + lineStart * Math.cos(-midAngle * RADIAN);
    const y1 = cy + lineStart * Math.sin(-midAngle * RADIAN);
    const x2 = cx + lineEnd * Math.cos(-midAngle * RADIAN);
    const y2 = cy + lineEnd * Math.sin(-midAngle * RADIAN);

    return (
      <g>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius - 3}
          outerRadius={outerRadius + 8}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
          cornerRadius={3}
          opacity={1}
        />
        {/* Center label for hovered segment — surfaces small slices on hover */}
        <text x={cx} y={cy - 16} textAnchor="middle" className="fill-foreground/80" fontSize={14}>
          {payload.emoji ? `${payload.emoji} ` : ""}{payload.name}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-foreground" fontSize={26} fontWeight={700}>
          {fmt(value)}
        </text>
        <text x={cx} y={cy + 34} textAnchor="middle" className="fill-muted-foreground" fontSize={13}>
          {pct < 1 ? "<1" : Math.round(pct)}%
        </text>
        {/* Outer label only for big-enough active slices */}
        {pct >= LABEL_THRESHOLD && (() => {
          const boxWidth = 200;
          const boxHeight = 40;
          const onRight = lx > cx;
          const fx = onRight ? x2 + 4 : x2 - boxWidth - 4;
          const fy = ly - boxHeight / 2;
          return (
            <>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-muted-foreground)" strokeWidth={1} opacity={0.5} />
              <foreignObject x={fx} y={fy} width={boxWidth} height={boxHeight}>
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    justifyContent: onRight ? "flex-start" : "flex-end",
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      lineHeight: 1.2,
                    }}
                  >
                    <span className="text-foreground text-[13px] font-semibold whitespace-nowrap">
                      {payload.name}
                    </span>
                    <span className="text-muted-foreground text-[12px] whitespace-nowrap">
                      {fmt(value)} ({Math.round(pct)}%)
                    </span>
                  </div>
                </div>
              </foreignObject>
            </>
          );
        })()}
      </g>
    );
  }

  // Unified shape: when `shape` is set on Pie, recharts uses it for every
  // slice INCLUDING the active one — the `activeShape` prop is ignored. So
  // this function has to do both jobs. For the active slice it delegates to
  // renderActiveShape (grow + center label); for the rest it draws a Sector
  // with adaptive cornerRadius so thin slices stay rounded too.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderSliceShape(props: any) {
    if (props.index === activeIndex) return renderActiveShape(props);
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    const radius = adaptiveCornerRadius(innerRadius, Math.abs(endAngle - startAngle));
    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        cornerRadius={radius}
      />
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderOuterLabel(props: any) {
    const { cx, cy, midAngle, outerRadius, name, value } = props;
    const pct = pctOf(value);
    if (pct < LABEL_THRESHOLD) return null;

    const labelRadius = outerRadius + 24;
    const x = cx + labelRadius * Math.cos(-midAngle * RADIAN);
    const y = cy + labelRadius * Math.sin(-midAngle * RADIAN);

    const lineStart = outerRadius + 4;
    const lineEnd = outerRadius + 18;
    const x1 = cx + lineStart * Math.cos(-midAngle * RADIAN);
    const y1 = cy + lineStart * Math.sin(-midAngle * RADIAN);
    const x2 = cx + lineEnd * Math.cos(-midAngle * RADIAN);
    const y2 = cy + lineEnd * Math.sin(-midAngle * RADIAN);

    const boxWidth = 200;
    const boxHeight = 40;
    const onRight = x > cx;
    const fx = onRight ? x2 + 4 : x2 - boxWidth - 4;
    const fy = y - boxHeight / 2;

    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-muted-foreground)" strokeWidth={1} opacity={0.4} />
        <foreignObject x={fx} y={fy} width={boxWidth} height={boxHeight}>
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              justifyContent: onRight ? "flex-start" : "flex-end",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "flex-start",
                lineHeight: 1.2,
              }}
            >
              <span className="text-foreground/80 text-[13px] font-semibold whitespace-nowrap">
                {name}
              </span>
              <span className="text-muted-foreground text-[12px] whitespace-nowrap">
                {fmt(value)} ({Math.round(pct)}%)
              </span>
            </div>
          </div>
        </foreignObject>
      </g>
    );
  }

  return (
    <div
      className="relative w-full flex-1 min-h-0 [&_*:focus]:outline-none"
      onMouseLeave={onMouseLeave}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 10, right: 80, bottom: 10, left: 80 }}>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="42%"
            outerRadius="64%"
            paddingAngle={1}
            // cornerRadius lives on renderSliceShape (per-slice adaptive)
            // rather than the Pie itself — see helper above for why.
            shape={renderSliceShape}
            stroke="none"
            label={renderOuterLabel}
            labelLine={false}
            isAnimationActive={animateEntry}
            animationDuration={ENTRY_ANIMATION_MS}
            animationEasing="ease-out"
            onMouseEnter={onMouseEnter}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(payload: any) => {
              if (!onSliceClick) return;
              // Recharts spreads the data row into payload.payload for Pie clicks.
              const item = payload?.payload as SpendingItem | undefined;
              if (item) onSliceClick(item);
            }}
          >
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.isBucket ? BUCKET_COLOR : colorForName(d.name)}
                opacity={activeIndex !== undefined && activeIndex !== i ? 0.4 : 1}
                style={{
                  transition: "opacity 0.2s ease",
                  cursor: onSliceClick ? "pointer" : "default",
                }}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {/* Center label — only visible when nothing is hovered */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none transition-opacity duration-200"
        style={{ opacity: activeIndex !== undefined ? 0 : 1 }}
      >
        <span className="text-xs text-muted-foreground">Total spending</span>
        <span className="text-xl font-bold tabular-nums zero-amount">
          {fmt(totalSpending)}
        </span>
      </div>
    </div>
  );
}
