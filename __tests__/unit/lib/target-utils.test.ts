import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeMonthlyNeeded,
  effectiveTargetDate,
  computeCategoryOverspending,
  computeCategoryTargetDeficit,
  computeCategoryUnderfunded,
} from "@/lib/target-utils";
import type { Target } from "@/lib/types";

// Minimal category shape the two split helpers read. cumulative_assigned only
// matters for non-recurring dated targets; defaults keep the common cases terse.
function cat(overrides: {
  assigned?: number;
  available?: number;
  cumulative_assigned?: number;
  target?: Target | null;
}) {
  return {
    assigned: 0,
    available: 0,
    cumulative_assigned: 0,
    target: null,
    ...overrides,
  } as Parameters<typeof computeCategoryTargetDeficit>[0];
}

function target(overrides: Partial<Target> & Pick<Target, "type" | "target_amount">): Target {
  return {
    target_date: null,
    monthly_contribution: null,
    recurring: false,
    ...overrides,
  } as Target;
}

describe("computeMonthlyNeeded", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 when toGo is 0", () => {
    const target = { type: "monthly_funding", target_amount: 100, target_date: null, monthly_contribution: null };
    expect(computeMonthlyNeeded(target, 0)).toBe(0);
  });

  it("returns 0 when toGo is negative", () => {
    const target = { type: "monthly_funding", target_amount: 100, target_date: null, monthly_contribution: null };
    expect(computeMonthlyNeeded(target, -50)).toBe(0);
  });

  // monthly_funding
  it("monthly_funding returns target_amount regardless of toGo", () => {
    const target = { type: "monthly_funding", target_amount: 250, target_date: null, monthly_contribution: null };
    expect(computeMonthlyNeeded(target, 1000)).toBe(250);
  });

  // target_by_date
  it("target_by_date divides toGo by months remaining", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15)); // Jan 15, 2026

    const target = { type: "target_by_date", target_amount: 0, target_date: "2026-04-01", monthly_contribution: null };
    // From Jan 2026 to Apr 2026 = 4 months
    // 1200 / 4 = 300
    expect(computeMonthlyNeeded(target, 1200)).toBe(300);
  });

  it("target_by_date with past due date returns full toGo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026

    const target = { type: "target_by_date", target_amount: 0, target_date: "2026-04-01", monthly_contribution: null };
    expect(computeMonthlyNeeded(target, 500)).toBe(500);
  });

  it("target_by_date with no date returns full toGo", () => {
    const target = { type: "target_by_date", target_amount: 0, target_date: null, monthly_contribution: null };
    expect(computeMonthlyNeeded(target, 500)).toBe(500);
  });

  it("target_by_date rounds to cents", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15)); // Jan 2026

    const target = { type: "target_by_date", target_amount: 0, target_date: "2026-04-01", monthly_contribution: null };
    // 1000 / 4 = 250 (clean divide)
    expect(computeMonthlyNeeded(target, 1000)).toBe(250);
    // 100 / 3 = 33.333... -> rounds to 33.33
    const target2 = { type: "target_by_date", target_amount: 0, target_date: "2026-03-01", monthly_contribution: null };
    expect(computeMonthlyNeeded(target2, 100)).toBe(33.33);
  });

  // savings_balance
  it("savings_balance returns toGo", () => {
    const target = { type: "savings_balance", target_amount: 1000, target_date: null, monthly_contribution: null };
    expect(computeMonthlyNeeded(target, 750)).toBe(750);
  });

  // spending — Fill up to (cap, no date)
  it("spending without date returns toGo (cap fills the gap)", () => {
    // $50 carryover, $200 cap → toGo = $150, needs $150 to fill
    const target = { type: "spending", target_amount: 200, target_date: null, monthly_contribution: null };
    expect(computeMonthlyNeeded(target, 150)).toBe(150);
  });

  it("spending with $0 toGo returns 0 (already at cap)", () => {
    // $300 carryover, $200 cap → toGo = $0 (caller already clamped), no assignment needed
    const target = { type: "spending", target_amount: 200, target_date: null, monthly_contribution: null };
    expect(computeMonthlyNeeded(target, 0)).toBe(0);
  });

  // spending — Fill up to with date (spread the gap like target_by_date)
  it("spending with date spreads toGo across months remaining", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15)); // Jan 2026

    const target = { type: "spending", target_amount: 0, target_date: "2026-04-01", monthly_contribution: null };
    // Jan→Apr 2026 = 4 months; 1200 / 4 = 300
    expect(computeMonthlyNeeded(target, 1200)).toBe(300);
  });

  it("spending with past date returns full toGo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026

    const target = { type: "spending", target_amount: 0, target_date: "2026-04-01", monthly_contribution: null };
    expect(computeMonthlyNeeded(target, 500)).toBe(500);
  });

  // recurring — paces against the rolled-forward effective deadline, not full toGo
  it("recurring target after anchor passes prorates over the rolled deadline", () => {
    // Anchor Sep 1 2025 is in the past relative to Jun 2026; effective deadline
    // rolls to Sep 1 2026. Jun→Sep 2026 inclusive = 4 months. 1200 / 4 = 300.
    const target = {
      type: "target_by_date",
      target_amount: 0,
      target_date: "2025-09-01",
      monthly_contribution: null,
      recurring: true,
    };
    expect(computeMonthlyNeeded(target, 1200, "2026-06-01")).toBe(300);
  });

  it("non-recurring past-anchor target still returns full toGo (no roll)", () => {
    const target = {
      type: "target_by_date",
      target_amount: 0,
      target_date: "2025-09-01",
      monthly_contribution: null,
      recurring: false,
    };
    // Anchor is in the past and does not roll → monthsLeft <= 0 → full toGo.
    expect(computeMonthlyNeeded(target, 1200, "2026-06-01")).toBe(1200);
  });
});

describe("effectiveTargetDate", () => {
  const base = {
    type: "target_by_date",
    target_amount: 1100,
    monthly_contribution: null,
  };

  it("returns the stored date unchanged for non-recurring targets", () => {
    const target = { ...base, target_date: "2025-09-01", recurring: false };
    expect(effectiveTargetDate(target, "2026-06-01")).toBe("2025-09-01");
  });

  it("returns null when there is no target_date", () => {
    const target = { ...base, target_date: null, recurring: true };
    expect(effectiveTargetDate(target, "2026-06-01")).toBeNull();
  });

  it("leaves a future anchor unchanged", () => {
    const target = { ...base, target_date: "2026-09-01", recurring: true };
    expect(effectiveTargetDate(target, "2026-06-01")).toBe("2026-09-01");
  });

  it("rolls a past anchor forward to the next future year", () => {
    const target = { ...base, target_date: "2025-09-01", recurring: true };
    expect(effectiveTargetDate(target, "2026-06-01")).toBe("2026-09-01");
  });

  it("rolls forward multiple years when the anchor is far in the past", () => {
    const target = { ...base, target_date: "2020-09-01", recurring: true };
    expect(effectiveTargetDate(target, "2026-06-01")).toBe("2026-09-01");
  });

  it("treats an anchor in the current month as still this cycle (no roll)", () => {
    const target = { ...base, target_date: "2026-06-15", recurring: true };
    expect(effectiveTargetDate(target, "2026-06-01")).toBe("2026-06-15");
  });
});

describe("computeCategoryOverspending", () => {
  it("is zero when available is positive", () => {
    expect(computeCategoryOverspending(cat({ available: 50 }))).toBe(0);
  });

  it("is zero when available is exactly zero", () => {
    expect(computeCategoryOverspending(cat({ available: 0 }))).toBe(0);
  });

  it("returns the amount needed to reach zero when overspent", () => {
    expect(computeCategoryOverspending(cat({ available: -86 }))).toBe(86);
  });

  it("ignores targets entirely — only available matters", () => {
    const c = cat({
      available: -20,
      target: target({ type: "monthly_funding", target_amount: 100 }),
    });
    expect(computeCategoryOverspending(c)).toBe(20);
  });
});

describe("computeCategoryTargetDeficit", () => {
  it("is zero for a category with no target, even when overspent", () => {
    // The key fix: no-target overspend belongs to Cover overspending, not here.
    expect(computeCategoryTargetDeficit(cat({ available: -86 }))).toBe(0);
  });

  it("is zero for open-ended savings (no date), even when overspent", () => {
    const c = cat({
      available: -50,
      target: target({ type: "savings_balance", target_amount: 5000 }),
    });
    expect(computeCategoryTargetDeficit(c)).toBe(0);
  });

  it("monthly_funding: tops this month's assignment up to target_amount", () => {
    const c = cat({
      assigned: 40,
      available: 40,
      target: target({ type: "monthly_funding", target_amount: 100 }),
    });
    expect(computeCategoryTargetDeficit(c)).toBe(60);
  });

  it("monthly_funding: does NOT add overspend on top of the monthly need", () => {
    // assigned 40 toward a 100 monthly goal, but spent into the red.
    // Deficit is just 100 - 40 = 60; the -30 overspend is Cover overspending's job.
    const c = cat({
      assigned: 40,
      available: -30,
      target: target({ type: "monthly_funding", target_amount: 100 }),
    });
    expect(computeCategoryTargetDeficit(c)).toBe(60);
  });

  it("monthly_funding: zero once this month's assignment meets the target", () => {
    const c = cat({
      assigned: 100,
      available: 100,
      target: target({ type: "monthly_funding", target_amount: 100 }),
    });
    expect(computeCategoryTargetDeficit(c)).toBe(0);
  });

  it("dated target_by_date: paces the remaining gap, net of this month's assignment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15)); // Jan 2026
    // Non-recurring: toGo measured against cumulative_assigned (200 of 1400).
    // Jan→Apr = 4 months, 1200/4 = 300 monthly need, minus 100 already assigned this month.
    const c = cat({
      assigned: 100,
      cumulative_assigned: 200,
      target: target({
        type: "target_by_date",
        target_amount: 1400,
        target_date: "2026-04-01",
      }),
    });
    expect(computeCategoryTargetDeficit(c)).toBe(200);
    vi.useRealTimers();
  });

  it("spending without date: fills cumulative up to the cap", () => {
    const c = cat({
      assigned: 0,
      cumulative_assigned: 50,
      available: 50,
      target: target({ type: "spending", target_amount: 200 }),
    });
    expect(computeCategoryTargetDeficit(c)).toBe(150);
  });
});

describe("computeCategoryUnderfunded", () => {
  it("covers a no-target overspend (pure overspend term)", () => {
    expect(computeCategoryUnderfunded(cat({ available: -86 }))).toBe(86);
  });

  it("is zero when funded and not overspent", () => {
    const c = cat({
      assigned: 100,
      available: 100,
      target: target({ type: "monthly_funding", target_amount: 100 }),
    });
    expect(computeCategoryUnderfunded(c)).toBe(0);
  });

  it("monthly_funding: takes the larger of overspend cover and target deficit", () => {
    // deficit = 100 - 40 = 60; overspend cover = 30 → max is the 60 deficit,
    // and adding 60 to assigned lands available at -30 + 60 = +30 (≥ 0).
    const c = cat({
      assigned: 40,
      available: -30,
      target: target({ type: "monthly_funding", target_amount: 100 }),
    });
    expect(computeCategoryUnderfunded(c)).toBe(60);
  });

  it("monthly_funding: overspend dominates when it exceeds the target deficit", () => {
    // deficit = 100 - 90 = 10; overspend cover = 200 → max is 200, which also
    // clears the red and overshoots the monthly target (acceptable: out of red wins).
    const c = cat({
      assigned: 90,
      available: -200,
      target: target({ type: "monthly_funding", target_amount: 100 }),
    });
    expect(computeCategoryUnderfunded(c)).toBe(200);
  });

  it("savings_balance with date: deficit already absorbs the overspend (no double-count)", () => {
    // basis = available = -50; deficit = 5000 - (-50) = 5050, which is ≥ the 50
    // overspend cover, so max = 5050 and we never add overspend on top.
    const c = cat({
      available: -50,
      target: target({
        type: "savings_balance",
        target_amount: 5000,
        target_date: "2026-12-01",
      }),
    });
    expect(computeCategoryUnderfunded(c)).toBe(5050);
  });
});
