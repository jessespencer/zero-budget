import { describe, it, expect } from "vitest";
import { availableCents } from "@/lib/db-utils";
import {
  computeCategoryOverspending,
  computeCategoryUnderfunded,
} from "@/lib/target-utils";
import { matchesFilter } from "@/components/budget/budget-filter-bar";
import { computeBudgetMonth } from "@/lib/budget-engine";
import type { CategoryWithBudget } from "@/lib/types";

// The exact residual observed in the prod DB on 2026-07-27: 🚗 Gas, funded to
// break-even via the Auto-assign "Underfunded" row, landed here instead of 0.
// `available` is a raw float sum out of the budget engine, so this is the
// normal outcome of covering an overspend — not a corrupt value.
const EPSILON = -1.136868e-13;

function category(available: number): CategoryWithBudget {
  return {
    id: "cat-1",
    category_group_id: "grp-1",
    user_id: "user-1",
    name: "🚗 Gas",
    sort_order: 0,
    archived: false,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    allocation_account_id: null,
    is_buffer: false,
    pinned_quick: false,
    notes: "",
    assigned: 564.04,
    activity: -564.04,
    available,
    cumulative_assigned: 564.04,
    target: null,
    autoAssign: {
      assignedLastMonth: 0,
      spentLastMonth: 0,
      averageAssigned: 0,
      averageSpent: 0,
    },
  } as CategoryWithBudget;
}

describe("break-even category with float residue", () => {
  it("rounds to the $0.00 the user sees", () => {
    expect(availableCents(EPSILON)).toBe(0);
    expect(availableCents(EPSILON).toFixed(2)).toBe("0.00");
  });

  it("is not matched by the Overspent filter", () => {
    expect(matchesFilter(category(EPSILON), "overspent")).toBe(false);
  });

  it("is not matched by the Money available filter", () => {
    // The positive-side twin: +1e-13 must not read as spendable money either.
    expect(matchesFilter(category(-EPSILON), "money_available")).toBe(false);
  });

  it("offers no overspend to cover", () => {
    expect(computeCategoryOverspending(category(EPSILON))).toBe(0);
  });

  it("renders no Auto-assign 'Underfunded' row", () => {
    // The panel gates the row on `underfunded > 0`, so a sub-cent need would
    // surface a button labelled "Underfunded $0.00".
    expect(computeCategoryUnderfunded(category(EPSILON))).toBe(0);
  });

  it("triggers no 'This will overspend by' warning when moving $0", () => {
    // Mirrors move-money-popover: parsed amount minus the rounded source.
    const overspendBy = 0 - availableCents(EPSILON);
    expect(overspendBy > 0).toBe(false);
  });

  it("colors the detail-panel Available row neither red nor green", () => {
    expect(availableCents(EPSILON) > 0).toBe(false);
    expect(availableCents(EPSILON) < 0).toBe(false);
  });

  it("still flags a genuine one-cent overspend", () => {
    // Guard against over-rounding: the fix must not swallow real cents.
    expect(matchesFilter(category(-0.01), "overspent")).toBe(true);
    expect(computeCategoryOverspending(category(-0.01))).toBe(0.01);
  });
});

describe("budget engine: prior-month overspend deduction", () => {
  // Three categories each funded to exact break-even. Summed raw, their
  // residuals deducted ghost sub-cents from Ready to Assign every month.
  const groups = [
    { id: "grp-1", user_id: "u", name: "Food", sort_order: 0, is_income: false, is_system: false, archived: false },
    { id: "grp-inc", user_id: "u", name: "Income", sort_order: 1, is_income: true, is_system: false, archived: false },
  ];

  const cents = (n: number) => ({
    id: `t-${n}`,
    user_id: "u",
    account_id: "acct",
    date: "2026-06-15",
    amount: -0.1,
    category_id: `c-${n}`,
    is_split_parent: false,
  });

  it("does not deduct sub-cent residuals from Ready to Assign", () => {
    const categories = [1, 2, 3].map((n) => ({
      id: `c-${n}`,
      user_id: "u",
      category_group_id: "grp-1",
      name: `Cat ${n}`,
      sort_order: n,
      archived: false,
    }));

    const result = computeBudgetMonth({
      month: "2026-07-01",
      categoryGroups: groups as never,
      categories: categories as never,
      // 0.1 * 3 assigned vs three -0.1 transactions: classic float pairing that
      // leaves each category a hair off zero at the end of June.
      monthlyBudgets: [1, 2, 3].map((n) => ({
        id: `mb-${n}`,
        user_id: "u",
        category_id: `c-${n}`,
        month: "2026-06-01",
        assigned: 0.1 + 0.2 - 0.2,
      })) as never,
      transactions: [1, 2, 3].map(cents) as never,
      splits: [],
      targets: [],
    });

    expect(result.overspentLastMonth).toBe(0);
  });
});
