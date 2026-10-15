import type { NetWorthPoint } from "@/lib/net-worth-series";

/**
 * Time-range key for the hero net-worth chart. The labels themselves are
 * duration acronyms (1M, 3M, 6M, 1Y, All) and are exempt from sentence-case
 * capitalization per the SPEC requirement 5 note that mirrors CLAUDE.md's
 * "no ALL CAPS in body prose" — i.e. acronyms/abbreviations are fine in chart
 * UI like this.
 */
export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "All";

const RANGE_DAYS: Record<Exclude<RangeKey, "All">, number> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
};

/**
 * Filter `points` to those dated within the selected range relative to
 * `today` (an ISO YYYY-MM-DD string). "All" returns the input unchanged.
 *
 * Pure — no DB access, no clock reads. Tests pass `today` explicitly.
 */
export function filterByRange(
  points: NetWorthPoint[],
  range: RangeKey,
  today: string
): NetWorthPoint[] {
  if (range === "All") return points;
  const days = RANGE_DAYS[range];
  // Compute cutoff = today - N days. We construct the Date in UTC to avoid
  // timezone-induced off-by-one when `today` straddles midnight locally.
  const [y, m, d] = today.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - days);
  const cutoff = t.toISOString().slice(0, 10);
  return points.filter((p) => p.date >= cutoff);
}

export type ChartHeader = {
  current: number;
  delta: number;
  pct: number | null; // null when first value is zero or when there is <2 points
  hasData: boolean;
};

/**
 * Compute the header total + delta + percent for the visible range.
 * - current = value at the last visible point
 * - delta = last - first
 * - pct = (delta / |first|) * 100, or null when first === 0 or single point
 */
export function computeHeader(points: NetWorthPoint[]): ChartHeader {
  if (points.length === 0) {
    return { current: 0, delta: 0, pct: null, hasData: false };
  }
  const last = points[points.length - 1];
  const first = points[0];
  const current = last.value;
  if (points.length === 1) {
    return { current, delta: 0, pct: null, hasData: true };
  }
  const delta = current - first.value;
  const pct =
    first.value === 0 ? null : (delta / Math.abs(first.value)) * 100;
  return { current, delta, pct, hasData: true };
}

/**
 * Y-axis bounds fitted to the data rather than anchored at $0. Net worth moves
 * a few percent a year; from zero, a $95k year on a $500k balance sheet reads
 * as a flat line. Pads the data range by 15% on each side (at least 1% of the
 * largest value, so a flat series still gets room) and snaps both ends to a
 * round step, with ticks on that step. Never dips below zero for an
 * all-positive series.
 */
export function computeYDomain(points: NetWorthPoint[]): {
  domain: [number, number];
  ticks: number[];
} {
  if (points.length === 0) return { domain: [0, 1], ticks: [0, 1] };
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.01, 1);
  const rawStep = (max - min + 2 * pad) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? 10 * magnitude;
  let lo = Math.floor((min - pad) / step) * step;
  const hi = Math.ceil((max + pad) / step) * step;
  if (min >= 0 && lo < 0) lo = 0;
  // Ticks on the same round step, so labels read $450k / $475k / $500k.
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { domain: [lo, hi], ticks };
}

// Exported under __test_ prefix so unit tests can exercise the math without
// pulling in the React/Recharts component tree.
export const __test_filterByRange = filterByRange;
export const __test_computeHeader = computeHeader;
export const __test_computeYDomain = computeYDomain;
