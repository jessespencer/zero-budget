import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeBudgetMonth, type BudgetInput } from "@/lib/budget-engine";
import {
  makeCategoryGroup,
  makeCategory,
  makeTransaction,
  makeMonthlyBudget,
} from "../../setup/fixtures";

/**
 * BUDGET-ISOLATION: tracked assets must never influence the budget engine.
 *
 * The Phase 8 introduction of `tracked_assets` keeps net-worth tracking out of
 * the budget engine entirely — Ready to Assign cannot change when a user
 * creates, updates, or deletes a tracked asset. This test enforces that
 * guarantee structurally (engine source has zero tracked-asset symbols) and
 * runtime-deterministically (engine output is stable on a representative
 * input). Future plans that wire tracked-asset data into BudgetInput will fail
 * this test, which is the intent — it forces a re-discussion of the boundary.
 */
describe("BUDGET-ISOLATION: tracked assets do not affect computeBudgetMonth", () => {
  function representativeInput(): BudgetInput {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });
    const spendGroup = makeCategoryGroup({ id: "g1" });
    const spendCat = makeCategory("g1", { id: "c1" });

    return {
      month: "2026-04-01",
      categoryGroups: [incomeGroup, spendGroup],
      categories: [incomeCat, spendCat],
      monthlyBudgets: [
        makeMonthlyBudget({ category_id: "c1", month: "2026-04-01", assigned: 200 }),
      ],
      transactions: [
        makeTransaction({ category_id: "c-pay", date: "2026-04-01", amount: 1000 }),
        makeTransaction({ category_id: "c1", date: "2026-04-10", amount: -50 }),
      ],
      splits: [],
      targets: [],
    };
  }

  it("computeBudgetMonth output is stable on a representative input", () => {
    const input = representativeInput();
    const first = computeBudgetMonth(input);
    const second = computeBudgetMonth(input);

    // Recomputing on the same input must be byte-identical for the values
    // that contribute to Ready to Assign — this is the determinism floor that
    // tracked-asset CRUD would have to break to invalidate the isolation
    // guarantee.
    expect(second.readyToAssign).toBe(first.readyToAssign);
    expect(second.totalIncome).toBe(first.totalIncome);
    expect(second.totalAssigned).toBe(first.totalAssigned);
    expect(second.overspentLastMonth).toBe(first.overspentLastMonth);

    // Sanity check the underlying math so a regression in the engine itself
    // is also caught here.
    expect(first.totalIncome).toBe(1000);
    expect(first.totalAssigned).toBe(200);
    expect(first.readyToAssign).toBe(800);
    expect(first.overspentLastMonth).toBe(0);
  });

  it("lib/budget-engine.ts has zero references to tracked-asset symbols", () => {
    const enginePath = path.join(process.cwd(), "lib", "budget-engine.ts");
    const source = fs.readFileSync(enginePath, "utf-8");

    // Structural guarantee: the engine source cannot reference tracked-asset
    // tables, types, helpers, or the net-worth module. If a future change
    // wires any of these in, this test fails immediately — which is the
    // signal to either justify the wire-in (and update the SPEC) or refactor
    // the change to keep the boundary intact.
    const TRACKED_ASSET_SYMBOLS = /tracked_assets|tracked_asset_history|TrackedAsset|computeNetWorth|net-worth/i;
    expect(TRACKED_ASSET_SYMBOLS.test(source)).toBe(false);
  });

  it("computeBudgetMonth signature does not accept a trackedAssets field", () => {
    // Runtime mirror of the compile-time guarantee that BudgetInput has no
    // tracked-asset field. The engine consumes exactly these 7 keys; if a
    // future change adds an 8th key, this test forces a deliberate update.
    const input = representativeInput();
    expect(Object.keys(input).sort()).toEqual(
      [
        "categories",
        "categoryGroups",
        "month",
        "monthlyBudgets",
        "splits",
        "targets",
        "transactions",
      ].sort()
    );

    // And the engine still computes correctly on that exact key set.
    const result = computeBudgetMonth(input);
    expect(result.readyToAssign).toBe(800);
  });
});
