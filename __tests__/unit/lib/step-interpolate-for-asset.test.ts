import { describe, it, expect } from "vitest";
import { stepInterpolateForAsset } from "@/lib/net-worth-series";
import type { TrackedAssetHistory } from "@/lib/types";

// Pure-function unit tests for stepInterpolateForAsset — the helper that
// powers the per-asset chart on /assets/[id]. Shared with the insights's
// deriveSeries so step semantics live in a single source of truth (HIGH fix
// H2 from Plan 08-04).

const h = (
  recorded_at: string,
  value: number,
  created_at = `${recorded_at}T00:00:00.000Z`
): TrackedAssetHistory => ({
  id: `h-${recorded_at}-${value}`,
  asset_id: "asset-1",
  value,
  recorded_at,
  note: null,
  created_at,
});

describe("stepInterpolateForAsset", () => {
  it("returns a single trailing point when history is empty", () => {
    const points = stepInterpolateForAsset([], 12345.67, { to: "2026-05-15" });
    expect(points).toEqual([{ date: "2026-05-15", value: 12345.67 }]);
  });

  it("emits two flat points when history is empty AND a from range is given", () => {
    const points = stepInterpolateForAsset([], 9876, {
      from: "2026-01-01",
      to: "2026-05-15",
    });
    expect(points).toEqual([
      { date: "2026-01-01", value: 9876 },
      { date: "2026-05-15", value: 9876 },
    ]);
  });

  it("emits one point per history row plus a trailing point at to", () => {
    const points = stepInterpolateForAsset(
      [h("2026-01-15", 100), h("2026-03-01", 150), h("2026-04-20", 200)],
      200,
      { to: "2026-05-15" }
    );
    expect(points).toEqual([
      { date: "2026-01-15", value: 100 },
      { date: "2026-03-01", value: 150 },
      { date: "2026-04-20", value: 200 },
      { date: "2026-05-15", value: 200 },
    ]);
  });

  it("prepends a flat-zero point when from predates the first history row", () => {
    // First history is 2026-03-01 ($150). from=2026-01-01 → no prior value.
    const points = stepInterpolateForAsset(
      [h("2026-03-01", 150), h("2026-04-20", 200)],
      200,
      { from: "2026-01-01", to: "2026-05-15" }
    );
    expect(points[0]).toEqual({ date: "2026-01-01", value: 0 });
    expect(points[1]).toEqual({ date: "2026-03-01", value: 150 });
    expect(points[points.length - 1]).toEqual({ date: "2026-05-15", value: 200 });
  });

  it("carries an earlier value forward when from is AFTER the first history row", () => {
    // First history is 2026-01-15 ($100); from=2026-02-01 → carry 100 to 02-01.
    const points = stepInterpolateForAsset(
      [h("2026-01-15", 100), h("2026-03-01", 150), h("2026-04-20", 200)],
      200,
      { from: "2026-02-01", to: "2026-05-15" }
    );
    // The 2026-01-15 row should NOT appear in the visible window.
    expect(points.find((p) => p.date === "2026-01-15")).toBeUndefined();
    expect(points[0]).toEqual({ date: "2026-02-01", value: 100 });
    expect(points[1]).toEqual({ date: "2026-03-01", value: 150 });
  });

  it("dedupes when from EXACTLY matches a history row date", () => {
    const points = stepInterpolateForAsset(
      [h("2026-02-01", 120), h("2026-03-01", 150)],
      150,
      { from: "2026-02-01", to: "2026-05-15" }
    );
    // Should not produce two consecutive entries at 2026-02-01.
    const dateCount = points.filter((p) => p.date === "2026-02-01").length;
    expect(dateCount).toBe(1);
    expect(points[0]).toEqual({ date: "2026-02-01", value: 120 });
  });

  it("clips history rows after to", () => {
    const points = stepInterpolateForAsset(
      [h("2026-01-15", 100), h("2026-06-01", 200)],
      200,
      { from: "2026-01-01", to: "2026-05-15" }
    );
    // 2026-06-01 falls outside the [from,to] window — must not appear.
    expect(points.find((p) => p.date === "2026-06-01")).toBeUndefined();
    expect(points[points.length - 1]).toEqual({
      date: "2026-05-15",
      value: 200, // currentValue used for the trailing point
    });
  });

  it("rounds values via roundCents", () => {
    // Untrustworthy floats: 100.005 + ... — make sure the helper rounds.
    const points = stepInterpolateForAsset(
      [h("2026-01-15", 100.005), h("2026-03-01", 150.999)],
      150.999,
      { from: "2026-01-01", to: "2026-05-15" }
    );
    for (const p of points) {
      // No more than 2 decimal places.
      expect(Math.round(p.value * 100) / 100).toBe(p.value);
    }
  });
});
