import { describe, it, expect } from "vitest";
import {
  __test_filterByRange,
  __test_computeHeader,
  __test_computeYDomain,
  type RangeKey,
} from "@/components/net-worth/net-worth-chart-utils";
import type { NetWorthPoint } from "@/lib/net-worth-series";

// Pure helper unit tests — JSX-free so they run under the Vitest "node"
// environment without any DOM setup. Component-level rendering is exercised
// in dev/build smoke; here we lock the math.

const today = "2026-05-15";

function pts(...rows: Array<[string, number]>): NetWorthPoint[] {
  return rows.map(([date, value]) => ({ date, value }));
}

describe("net-worth-chart utils — __test_filterByRange", () => {
  it("All returns every point unchanged", () => {
    const p = pts(["2024-01-01", 100], ["2025-06-01", 200], ["2026-05-15", 300]);
    expect(__test_filterByRange(p, "All", today)).toEqual(p);
  });

  it("1M keeps points dated within the last 30 days", () => {
    const p = pts(
      ["2026-03-01", 100],
      ["2026-04-20", 150], // ~25 days before today
      ["2026-05-10", 200],
      ["2026-05-15", 250]
    );
    const out = __test_filterByRange(p, "1M", today);
    // 30-day cutoff from 2026-05-15 is 2026-04-15. So 2026-03-01 excluded.
    expect(out.map((x) => x.date)).toEqual(["2026-04-20", "2026-05-10", "2026-05-15"]);
  });

  it("3M keeps points within ~90 days", () => {
    const p = pts(
      ["2025-12-01", 50], // way outside
      ["2026-03-01", 100], // 75 days before — kept
      ["2026-05-15", 200]
    );
    const out = __test_filterByRange(p, "3M", today);
    expect(out.map((x) => x.date)).toEqual(["2026-03-01", "2026-05-15"]);
  });

  it("returns empty array when no points are inside the range", () => {
    const p = pts(["2020-01-01", 100]);
    expect(__test_filterByRange(p, "1M", today)).toEqual([]);
  });

  const ranges: RangeKey[] = ["1M", "3M", "6M", "1Y", "All"];
  for (const r of ranges) {
    it(`accepts range ${r} without throwing`, () => {
      expect(() => __test_filterByRange([], r, today)).not.toThrow();
    });
  }
});

describe("net-worth-chart utils — __test_computeHeader", () => {
  it("returns zeroes for empty input", () => {
    expect(__test_computeHeader([])).toEqual({
      current: 0,
      delta: 0,
      pct: null,
      hasData: false,
    });
  });

  it("returns current only when a single point is visible", () => {
    const h = __test_computeHeader(pts(["2026-05-15", 1000]));
    expect(h.current).toBe(1000);
    expect(h.delta).toBe(0);
    expect(h.pct).toBe(null); // single point → no percent change
    expect(h.hasData).toBe(true);
  });

  it("computes delta and percent between first and last points", () => {
    const h = __test_computeHeader(pts(["2026-01-01", 1000], ["2026-05-15", 1500]));
    expect(h.current).toBe(1500);
    expect(h.delta).toBe(500);
    expect(h.pct).toBeCloseTo(50, 5);
  });

  it("handles negative delta (loss)", () => {
    const h = __test_computeHeader(pts(["2026-01-01", 2000], ["2026-05-15", 1500]));
    expect(h.delta).toBe(-500);
    expect(h.pct).toBeCloseTo(-25, 5);
  });

  it("returns pct=null when first value is 0 (avoid Infinity/NaN)", () => {
    const h = __test_computeHeader(pts(["2026-01-01", 0], ["2026-05-15", 500]));
    expect(h.delta).toBe(500);
    expect(h.pct).toBe(null);
  });

  it("percent is signed when first value is negative", () => {
    // first = -100, last = -50 → delta = 50, |first| = 100, pct = 50
    const h = __test_computeHeader(pts(["2026-01-01", -100], ["2026-05-15", -50]));
    expect(h.delta).toBe(50);
    expect(h.pct).toBeCloseTo(50, 5);
  });
});

describe("net-worth-chart utils — __test_computeYDomain", () => {
  it("fits the data instead of starting at zero", () => {
    const { domain: [lo, hi] } = __test_computeYDomain(pts(["2026-01-01", 418_000], ["2026-05-01", 514_000]));
    expect(lo).toBeGreaterThan(300_000);
    expect(lo).toBeLessThanOrEqual(418_000);
    expect(hi).toBeGreaterThanOrEqual(514_000);
    expect(hi).toBeLessThan(600_000);
  });

  it("gives a flat series some room on both sides", () => {
    const { domain: [lo, hi] } = __test_computeYDomain(pts(["2026-01-01", 1000], ["2026-02-01", 1000]));
    expect(lo).toBeLessThan(1000);
    expect(hi).toBeGreaterThan(1000);
  });

  it("never dips below zero for an all-positive series", () => {
    const { domain: [lo] } = __test_computeYDomain(pts(["2026-01-01", 10], ["2026-02-01", 5000]));
    expect(lo).toBe(0);
  });

  it("follows a negative net worth below zero", () => {
    const { domain: [lo, hi] } = __test_computeYDomain(pts(["2026-01-01", -20_000], ["2026-02-01", -5_000]));
    expect(lo).toBeLessThanOrEqual(-20_000);
    expect(hi).toBeGreaterThanOrEqual(-5_000);
  });

  it("puts ticks on one round step from bottom to top", () => {
    const { domain, ticks } = __test_computeYDomain(pts(["2026-01-01", 418_000], ["2026-05-01", 514_000]));
    expect(ticks[0]).toBe(domain[0]);
    expect(ticks[ticks.length - 1]).toBe(domain[1]);
    const steps = ticks.slice(1).map((t, i) => t - ticks[i]);
    expect(new Set(steps).size).toBe(1);
  });
});
