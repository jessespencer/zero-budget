import { describe, it, expect, beforeEach } from "vitest";
import { computeBudgetMonth, type BudgetInput } from "@/lib/budget-engine";
import { STARTING_BALANCE_CATEGORY_ID } from "@/lib/db-constants";
import {
  makeCategoryGroup,
  makeCategory,
  makeTransaction,
  makeMonthlyBudget,
  makeSplit,
  makeTarget,
  resetFixtureCounter,
} from "../../setup/fixtures";

function budgetInput(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return {
    month: "2026-04-01",
    categoryGroups: [],
    categories: [],
    monthlyBudgets: [],
    transactions: [],
    splits: [],
    targets: [],
    ...overrides,
  };
}

describe("computeBudgetMonth", () => {
  beforeEach(() => resetFixtureCounter());

  // ── Basic envelope math ────────────────────────────────

  it("returns zeroes for empty input", () => {
    const result = computeBudgetMonth(budgetInput());
    expect(result.month).toBe("2026-04-01");
    expect(result.readyToAssign).toBe(0);
    expect(result.totalIncome).toBe(0);
    expect(result.totalAssigned).toBe(0);
    expect(result.overspentLastMonth).toBe(0);
    expect(result.groups).toHaveLength(0);
  });

  it("computes assigned from current month budget", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });
    const mb = makeMonthlyBudget({ category_id: "c1", month: "2026-04-01", assigned: 200 });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [cat],
        monthlyBudgets: [mb],
      })
    );

    expect(result.groups[0].categories[0].assigned).toBe(200);
    expect(result.groups[0].groupAssigned).toBe(200);
    expect(result.totalAssigned).toBe(200);
  });

  it("computes activity from current month transactions", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });
    const txn = makeTransaction({
      category_id: "c1",
      date: "2026-04-10",
      amount: -75,
    });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [cat],
        transactions: [txn],
      })
    );

    expect(result.groups[0].categories[0].activity).toBe(-75);
    expect(result.groups[0].groupActivity).toBe(-75);
  });

  it("available = cumulative assigned + cumulative activity", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });

    // Assigned $500 over two months
    const mb1 = makeMonthlyBudget({ category_id: "c1", month: "2026-03-01", assigned: 300 });
    const mb2 = makeMonthlyBudget({ category_id: "c1", month: "2026-04-01", assigned: 200 });

    // Spent $100 in March
    const txn = makeTransaction({
      category_id: "c1",
      date: "2026-03-15",
      amount: -100,
    });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [cat],
        monthlyBudgets: [mb1, mb2],
        transactions: [txn],
      })
    );

    // available = (300 + 200) + (-100) = 400
    expect(result.groups[0].categories[0].available).toBe(400);
    // current month assigned is just April
    expect(result.groups[0].categories[0].assigned).toBe(200);
    // current month activity is 0 (the txn was March)
    expect(result.groups[0].categories[0].activity).toBe(0);
  });

  // ── Income & Ready to Assign ───────────────────────────

  it("computes totalIncome from income category transactions", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-paycheck" });
    const txn = makeTransaction({
      category_id: "c-paycheck",
      date: "2026-04-01",
      amount: 5000,
    });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [incomeGroup],
        categories: [incomeCat],
        transactions: [txn],
      })
    );

    expect(result.totalIncome).toBe(5000);
    expect(result.currentMonthIncome).toBe(5000);
  });

  it("readyToAssign = totalIncome - totalAssigned - overspent", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });
    const expenseGroup = makeCategoryGroup({ id: "g1" });
    const expenseCat = makeCategory("g1", { id: "c1" });

    const income = makeTransaction({ category_id: "c-pay", date: "2026-04-01", amount: 5000 });
    const budget = makeMonthlyBudget({ category_id: "c1", month: "2026-04-01", assigned: 2000 });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [incomeGroup, expenseGroup],
        categories: [incomeCat, expenseCat],
        transactions: [income],
        monthlyBudgets: [budget],
      })
    );

    expect(result.readyToAssign).toBe(3000); // 5000 - 2000
  });

  it("income from prior months is included in totalIncome", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });

    const marchIncome = makeTransaction({ category_id: "c-pay", date: "2026-03-01", amount: 3000 });
    const aprilIncome = makeTransaction({ category_id: "c-pay", date: "2026-04-01", amount: 5000 });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [incomeGroup],
        categories: [incomeCat],
        transactions: [marchIncome, aprilIncome],
      })
    );

    expect(result.totalIncome).toBe(8000);
    expect(result.currentMonthIncome).toBe(5000);
  });

  // ── Future-month assignments drain Ready to Assign ─────

  it("future assignment drains a past month's Ready to Assign toward zero", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });

    // Pool of 1000 in April (month M)
    const income = makeTransaction({ category_id: "c-pay", date: "2026-04-01", amount: 1000 });
    // Assign 300 in May (month M+1)
    const futureBudget = makeMonthlyBudget({ category_id: "c1", month: "2026-05-01", assigned: 300 });

    const result = computeBudgetMonth(
      budgetInput({
        month: "2026-04-01",
        categoryGroups: [incomeGroup, group],
        categories: [incomeCat, cat],
        transactions: [income],
        monthlyBudgets: [futureBudget],
      })
    );

    // 1000 pool, 300 assigned in a later month → 700 free now
    expect(result.readyToAssign).toBe(700);
    expect(result.futureAssigned).toBe(300);
  });

  it("future OVER-assignment floors a past month's Ready to Assign at zero", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });

    // Pool of 1000 in April
    const income = makeTransaction({ category_id: "c-pay", date: "2026-04-01", amount: 1000 });
    // Assign 1500 in May (more than the pool)
    const futureBudget = makeMonthlyBudget({ category_id: "c1", month: "2026-05-01", assigned: 1500 });

    const result = computeBudgetMonth(
      budgetInput({
        month: "2026-04-01",
        categoryGroups: [incomeGroup, group],
        categories: [incomeCat, cat],
        transactions: [income],
        monthlyBudgets: [futureBudget],
      })
    );

    // Floored at 0, NOT -500
    expect(result.readyToAssign).toBe(0);
    expect(result.futureAssigned).toBe(1500);
  });

  it("current-month over-assignment still shows a true negative Ready to Assign", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });

    // Pool of 1000 in April
    const income = makeTransaction({ category_id: "c-pay", date: "2026-04-01", amount: 1000 });
    // Over-assign 1500 in April itself (current month, no future)
    const currentBudget = makeMonthlyBudget({ category_id: "c1", month: "2026-04-01", assigned: 1500 });

    const result = computeBudgetMonth(
      budgetInput({
        month: "2026-04-01",
        categoryGroups: [incomeGroup, group],
        categories: [incomeCat, cat],
        transactions: [income],
        monthlyBudgets: [currentBudget],
      })
    );

    // cur < 0 path — the current-month negative is preserved, not floored
    expect(result.readyToAssign).toBe(-500);
    expect(result.futureAssigned).toBe(0);
  });

  it("net-negative future assignment does not inflate a past month", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });

    // Pool of 1000 in April
    const income = makeTransaction({ category_id: "c-pay", date: "2026-04-01", amount: 1000 });
    // Negative assignment in May (e.g. clawed back)
    const futureBudget = makeMonthlyBudget({ category_id: "c1", month: "2026-05-01", assigned: -200 });

    const result = computeBudgetMonth(
      budgetInput({
        month: "2026-04-01",
        categoryGroups: [incomeGroup, group],
        categories: [incomeCat, cat],
        transactions: [income],
        monthlyBudgets: [futureBudget],
      })
    );

    // futureAssigned clamped to 0 → RTA unchanged at 1000, NOT 1200
    expect(result.readyToAssign).toBe(1000);
    expect(result.futureAssigned).toBe(0);
  });

  // ── Overspent from prior month ─────────────────────────

  it("overspent in prior month deducts from Ready to Assign", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });

    // $1000 income
    const income = makeTransaction({ category_id: "c-pay", date: "2026-03-01", amount: 1000 });
    // Assign $100 to category in March
    const mb = makeMonthlyBudget({ category_id: "c1", month: "2026-03-01", assigned: 100 });
    // Spend $200 in March (overspent by $100)
    const overspend = makeTransaction({ category_id: "c1", date: "2026-03-15", amount: -200 });

    const result = computeBudgetMonth(
      budgetInput({
        month: "2026-04-01",
        categoryGroups: [incomeGroup, group],
        categories: [incomeCat, cat],
        transactions: [income, overspend],
        monthlyBudgets: [mb],
      })
    );

    expect(result.overspentLastMonth).toBe(100);
    // RTA = 1000 income - 100 assigned - 100 overspent = 800
    expect(result.readyToAssign).toBe(800);
  });

  it("income categories are excluded from overspent calculation", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });

    // Negative transaction in income category should not count as overspent
    const txn = makeTransaction({ category_id: "c-pay", date: "2026-03-15", amount: -500 });

    const result = computeBudgetMonth(
      budgetInput({
        month: "2026-04-01",
        categoryGroups: [incomeGroup],
        categories: [incomeCat],
        transactions: [txn],
      })
    );

    expect(result.overspentLastMonth).toBe(0);
  });

  it("positive available in prior month does NOT create overspent", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });
    const mb = makeMonthlyBudget({ category_id: "c1", month: "2026-03-01", assigned: 500 });
    const txn = makeTransaction({ category_id: "c1", date: "2026-03-15", amount: -100 });

    const result = computeBudgetMonth(
      budgetInput({
        month: "2026-04-01",
        categoryGroups: [group],
        categories: [cat],
        monthlyBudgets: [mb],
        transactions: [txn],
      })
    );

    expect(result.overspentLastMonth).toBe(0);
  });

  // ── Split transactions ─────────────────────────────────

  it("split transactions attribute activity to split categories", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat1 = makeCategory("g1", { id: "c1", name: "Groceries" });
    const cat2 = makeCategory("g1", { id: "c2", name: "Household" });

    const parent = makeTransaction({
      id: "split-parent",
      date: "2026-04-10",
      amount: -100,
      is_split_parent: true,
      category_id: null,
    });

    const split1 = makeSplit({ parent_transaction_id: "split-parent", category_id: "c1", amount: -60 });
    const split2 = makeSplit({ parent_transaction_id: "split-parent", category_id: "c2", amount: -40 });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [cat1, cat2],
        transactions: [parent],
        splits: [split1, split2],
      })
    );

    const cats = result.groups[0].categories;
    expect(cats.find((c) => c.id === "c1")!.activity).toBe(-60);
    expect(cats.find((c) => c.id === "c2")!.activity).toBe(-40);
  });

  it("split parent is excluded from activity (is_split_parent flag)", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });

    // Parent has category_id set but is_split_parent=true — should be ignored
    const parent = makeTransaction({
      id: "split-parent",
      date: "2026-04-10",
      amount: -100,
      is_split_parent: true,
      category_id: "c1",
    });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [cat],
        transactions: [parent],
      })
    );

    expect(result.groups[0].categories[0].activity).toBe(0);
  });

  // ── Group aggregation ──────────────────────────────────

  it("group totals sum their categories", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat1 = makeCategory("g1", { id: "c1", sort_order: 0 });
    const cat2 = makeCategory("g1", { id: "c2", sort_order: 1 });

    const mb1 = makeMonthlyBudget({ category_id: "c1", month: "2026-04-01", assigned: 100 });
    const mb2 = makeMonthlyBudget({ category_id: "c2", month: "2026-04-01", assigned: 200 });

    const txn1 = makeTransaction({ category_id: "c1", date: "2026-04-05", amount: -30 });
    const txn2 = makeTransaction({ category_id: "c2", date: "2026-04-05", amount: -70 });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [cat1, cat2],
        monthlyBudgets: [mb1, mb2],
        transactions: [txn1, txn2],
      })
    );

    expect(result.groups[0].groupAssigned).toBe(300);
    expect(result.groups[0].groupActivity).toBe(-100);
    expect(result.groups[0].groupAvailable).toBe(200); // 300 - 100
  });

  it("income groups are excluded from the groups array", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const expenseGroup = makeCategoryGroup({ id: "g1" });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });
    const expenseCat = makeCategory("g1", { id: "c1" });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [incomeGroup, expenseGroup],
        categories: [incomeCat, expenseCat],
      })
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].id).toBe("g1");
  });

  // ── Sort order ─────────────────────────────────────────

  it("groups are sorted by sort_order", () => {
    const g1 = makeCategoryGroup({ id: "g1", sort_order: 2 });
    const g2 = makeCategoryGroup({ id: "g2", sort_order: 1 });
    const g3 = makeCategoryGroup({ id: "g3", sort_order: 0 });

    const result = computeBudgetMonth(
      budgetInput({ categoryGroups: [g1, g2, g3] })
    );

    expect(result.groups.map((g) => g.id)).toEqual(["g3", "g2", "g1"]);
  });

  it("categories within a group are sorted by sort_order", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const c1 = makeCategory("g1", { id: "c1", sort_order: 2 });
    const c2 = makeCategory("g1", { id: "c2", sort_order: 0 });
    const c3 = makeCategory("g1", { id: "c3", sort_order: 1 });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [c1, c2, c3],
      })
    );

    expect(result.groups[0].categories.map((c) => c.id)).toEqual(["c2", "c3", "c1"]);
  });

  it("archived categories are excluded", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const active = makeCategory("g1", { id: "c1", archived: false });
    const archived = makeCategory("g1", { id: "c2", archived: true });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [active, archived],
      })
    );

    expect(result.groups[0].categories).toHaveLength(1);
    expect(result.groups[0].categories[0].id).toBe("c1");
  });

  // ── Hidden (archived) categories surfacing ─────────────

  it("archived non-income/non-system category appears in hiddenCategories with budget data", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const active = makeCategory("g1", { id: "c1", archived: false });
    const archived = makeCategory("g1", { id: "c2", archived: true });
    const mb = makeMonthlyBudget({ category_id: "c2", month: "2026-04-01", assigned: 120 });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [active, archived],
        monthlyBudgets: [mb],
      })
    );

    // Removed from its original group
    expect(result.groups[0].categories.map((c) => c.id)).toEqual(["c1"]);
    // Surfaced in hiddenCategories with its budget data and original group id
    expect(result.hiddenCategories).toHaveLength(1);
    expect(result.hiddenCategories[0].id).toBe("c2");
    expect(result.hiddenCategories[0].category_group_id).toBe("g1");
    expect(result.hiddenCategories[0].assigned).toBe(120);
    expect(result.hiddenCategories[0].available).toBe(120);
  });

  it("hiddenCategories is empty when nothing is archived", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const active = makeCategory("g1", { id: "c1", archived: false });

    const result = computeBudgetMonth(
      budgetInput({ categoryGroups: [group], categories: [active] })
    );

    expect(result.hiddenCategories).toEqual([]);
  });

  it("archived income and system categories are excluded from hiddenCategories", () => {
    const expenseGroup = makeCategoryGroup({ id: "g1" });
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const systemGroup = makeCategoryGroup({ id: "g-sys", is_system: true });
    const archivedExpense = makeCategory("g1", { id: "c-exp", archived: true });
    const archivedIncome = makeCategory("g-income", { id: "c-inc", archived: true });
    const archivedSystem = makeCategory("g-sys", { id: "c-sys", archived: true });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [expenseGroup, incomeGroup, systemGroup],
        categories: [archivedExpense, archivedIncome, archivedSystem],
      })
    );

    expect(result.hiddenCategories.map((c) => c.id)).toEqual(["c-exp"]);
  });

  it("hiddenCategories are sorted by sort_order", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const b = makeCategory("g1", { id: "c-b", archived: true, sort_order: 2 });
    const a = makeCategory("g1", { id: "c-a", archived: true, sort_order: 1 });

    const result = computeBudgetMonth(
      budgetInput({ categoryGroups: [group], categories: [b, a] })
    );

    expect(result.hiddenCategories.map((c) => c.id)).toEqual(["c-a", "c-b"]);
  });

  // ── Hidden (archived) groups surfacing ─────────────────

  it("archived group is removed from active groups and surfaced in hiddenGroups with nested categories + group totals", () => {
    const group = makeCategoryGroup({ id: "g1", archived: true });
    // Children keep archived=0 — they vanish from the grid because the GROUP is hidden.
    const c1 = makeCategory("g1", { id: "c1", archived: false, sort_order: 0 });
    const c2 = makeCategory("g1", { id: "c2", archived: false, sort_order: 1 });
    const mb1 = makeMonthlyBudget({ category_id: "c1", month: "2026-04-01", assigned: 100 });
    const mb2 = makeMonthlyBudget({ category_id: "c2", month: "2026-04-01", assigned: 50 });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [c1, c2],
        monthlyBudgets: [mb1, mb2],
      })
    );

    // Removed from the active grid
    expect(result.groups).toHaveLength(0);
    // Surfaced in hiddenGroups with its children nested
    expect(result.hiddenGroups).toHaveLength(1);
    expect(result.hiddenGroups[0].id).toBe("g1");
    expect(result.hiddenGroups[0].categories.map((c) => c.id)).toEqual(["c1", "c2"]);
    // Group totals computed like the active loop
    expect(result.hiddenGroups[0].groupAssigned).toBe(150);
    expect(result.hiddenGroups[0].groupAvailable).toBe(150);
  });

  it("hiddenGroups is empty when no group is archived", () => {
    const group = makeCategoryGroup({ id: "g1", archived: false });
    const c1 = makeCategory("g1", { id: "c1" });

    const result = computeBudgetMonth(
      budgetInput({ categoryGroups: [group], categories: [c1] })
    );

    expect(result.hiddenGroups).toEqual([]);
  });

  it("archived income and system groups are excluded from hiddenGroups", () => {
    const expenseGroup = makeCategoryGroup({ id: "g1", archived: true });
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true, archived: true });
    const systemGroup = makeCategoryGroup({ id: "g-sys", is_system: true, archived: true });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [expenseGroup, incomeGroup, systemGroup],
        categories: [],
      })
    );

    expect(result.hiddenGroups.map((g) => g.id)).toEqual(["g1"]);
  });

  it("hiddenGroups nests ALL children including individually-archived ones (whole group hidden)", () => {
    const group = makeCategoryGroup({ id: "g1", archived: true });
    const visible = makeCategory("g1", { id: "c-vis", archived: false, sort_order: 0 });
    const preHidden = makeCategory("g1", { id: "c-pre", archived: true, sort_order: 1 });

    const result = computeBudgetMonth(
      budgetInput({ categoryGroups: [group], categories: [visible, preHidden] })
    );

    expect(result.hiddenGroups[0].categories.map((c) => c.id)).toEqual([
      "c-vis",
      "c-pre",
    ]);
  });

  it("a category individually hidden inside an ACTIVE group still appears in flat hiddenCategories", () => {
    const group = makeCategoryGroup({ id: "g1", archived: false });
    const active = makeCategory("g1", { id: "c1", archived: false });
    const hidden = makeCategory("g1", { id: "c2", archived: true });

    const result = computeBudgetMonth(
      budgetInput({ categoryGroups: [group], categories: [active, hidden] })
    );

    expect(result.hiddenCategories.map((c) => c.id)).toEqual(["c2"]);
  });

  it("a category inside a HIDDEN group does NOT double-appear in flat hiddenCategories", () => {
    const group = makeCategoryGroup({ id: "g1", archived: true });
    // This category was individually hidden BEFORE the group was hidden.
    const preHidden = makeCategory("g1", { id: "c-pre", archived: true });

    const result = computeBudgetMonth(
      budgetInput({ categoryGroups: [group], categories: [preHidden] })
    );

    // It is listed under the hidden group, not in the flat list.
    expect(result.hiddenGroups[0].categories.map((c) => c.id)).toEqual(["c-pre"]);
    expect(result.hiddenCategories).toEqual([]);
  });

  // ── Targets ────────────────────────────────────────────

  it("attaches target to the matching category", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });
    const target = makeTarget({ category_id: "c1", target_amount: 500, type: "monthly_funding" });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [cat],
        targets: [target],
      })
    );

    expect(result.groups[0].categories[0].target).not.toBeNull();
    expect(result.groups[0].categories[0].target!.target_amount).toBe(500);
  });

  it("categories without targets get null", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [cat],
      })
    );

    expect(result.groups[0].categories[0].target).toBeNull();
  });

  // ── Edge cases ─────────────────────────────────────────

  it("transactions without category_id are ignored", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });
    const txn = makeTransaction({ category_id: null, date: "2026-04-10", amount: -50 });

    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [group],
        categories: [cat],
        transactions: [txn],
      })
    );

    expect(result.groups[0].categories[0].activity).toBe(0);
  });

  it("future transactions beyond current month are excluded", () => {
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });
    const futureTxn = makeTransaction({ category_id: "c1", date: "2026-05-01", amount: -100 });

    const result = computeBudgetMonth(
      budgetInput({
        month: "2026-04-01",
        categoryGroups: [group],
        categories: [cat],
        transactions: [futureTxn],
      })
    );

    expect(result.groups[0].categories[0].activity).toBe(0);
    expect(result.groups[0].categories[0].available).toBe(0);
  });

  it("handles multiple months of cumulative data correctly", () => {
    const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
    const incomeCat = makeCategory("g-income", { id: "c-pay" });
    const group = makeCategoryGroup({ id: "g1" });
    const cat = makeCategory("g1", { id: "c1" });

    // 3 months of income
    const income1 = makeTransaction({ category_id: "c-pay", date: "2026-02-01", amount: 3000 });
    const income2 = makeTransaction({ category_id: "c-pay", date: "2026-03-01", amount: 3000 });
    const income3 = makeTransaction({ category_id: "c-pay", date: "2026-04-01", amount: 3000 });

    // Budget each month
    const mb1 = makeMonthlyBudget({ category_id: "c1", month: "2026-02-01", assigned: 1000 });
    const mb2 = makeMonthlyBudget({ category_id: "c1", month: "2026-03-01", assigned: 1000 });
    const mb3 = makeMonthlyBudget({ category_id: "c1", month: "2026-04-01", assigned: 1000 });

    // Spend each month
    const txn1 = makeTransaction({ category_id: "c1", date: "2026-02-15", amount: -800 });
    const txn2 = makeTransaction({ category_id: "c1", date: "2026-03-15", amount: -800 });
    const txn3 = makeTransaction({ category_id: "c1", date: "2026-04-15", amount: -800 });

    const result = computeBudgetMonth(
      budgetInput({
        month: "2026-04-01",
        categoryGroups: [incomeGroup, group],
        categories: [incomeCat, cat],
        transactions: [income1, income2, income3, txn1, txn2, txn3],
        monthlyBudgets: [mb1, mb2, mb3],
      })
    );

    // available = cumulative assigned (3000) + cumulative activity (-2400) = 600
    expect(result.groups[0].categories[0].available).toBe(600);
    expect(result.groups[0].categories[0].assigned).toBe(1000);
    expect(result.groups[0].categories[0].activity).toBe(-800);
    expect(result.totalIncome).toBe(9000);
    expect(result.totalAssigned).toBe(3000);
    expect(result.readyToAssign).toBe(6000); // 9000 - 3000
  });

  // ── Opening credit-card debt ───────────────────────────

  // Cash starting balances flow into totalIncome via READY_TO_ASSIGN_CATEGORY_ID
  // income-category txns; credit-card opening debts are stamped
  // STARTING_BALANCE_CATEGORY_ID (a non-income system category — see migration
  // 017 / quick task 260515-n1a). Without subtracting them from RTA, the engine
  // overstates by the sum of opening CC debts — seen in practice as a card
  // opened with a large debt and RTA off by exactly that amount.

  function openingIncomeGroup() {
    return makeCategoryGroup({ id: "g-income", is_income: true });
  }
  function openingIncomeCategory() {
    return makeCategory("g-income", { id: "c-income" });
  }
  function cashOpen(amount: number, date = "2026-04-01") {
    return makeTransaction({
      category_id: "c-income",
      date,
      amount,
      payee: "Starting balance",
    });
  }
  function ccOpen(amount: number, date = "2026-04-01") {
    return makeTransaction({
      category_id: STARTING_BALANCE_CATEGORY_ID,
      date,
      amount, // negative for debt
      payee: "Starting balance",
    });
  }

  it("subtracts a single opening CC debt from RTA", () => {
    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [openingIncomeGroup()],
        categories: [openingIncomeCategory()],
        transactions: [cashOpen(100), ccOpen(-30)],
      })
    );
    expect(result.totalIncome).toBe(100);
    expect(result.openingCcDebt).toBe(30);
    expect(result.readyToAssign).toBe(70);
  });

  it("subtracts multiple opening CC debts from RTA (multi-card scenario)", () => {
    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [openingIncomeGroup()],
        categories: [openingIncomeCategory()],
        transactions: [cashOpen(100), ccOpen(-30), ccOpen(-20)],
      })
    );
    expect(result.totalIncome).toBe(100);
    expect(result.openingCcDebt).toBe(50);
    expect(result.readyToAssign).toBe(50);
  });

  it("ignores opening CC debt txns dated after monthEnd", () => {
    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [openingIncomeGroup()],
        categories: [openingIncomeCategory()],
        // ccOpen dated 2026-05-15 (after April 2026 monthEnd 2026-04-30)
        transactions: [cashOpen(100), ccOpen(-30, "2026-05-15")],
      })
    );
    expect(result.openingCcDebt).toBe(0);
    expect(result.readyToAssign).toBe(100);
  });

  it("does not deduct positive STARTING_BALANCE_CATEGORY_ID txns from RTA", () => {
    const result = computeBudgetMonth(
      budgetInput({
        categoryGroups: [openingIncomeGroup()],
        categories: [openingIncomeCategory()],
        // A credit card that opened with a positive balance (rare credit)
        transactions: [cashOpen(100), ccOpen(15)],
      })
    );
    expect(result.openingCcDebt).toBe(0);
    expect(result.readyToAssign).toBe(100);
  });

  // ── budgetStartMonth cutoff (SEED-016 historical data) ──

  describe("budgetStartMonth cutoff", () => {
    it("excludes pre-cutoff income from totalIncome and RTA", () => {
      const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
      const incomeCat = makeCategory("g-income", { id: "c-pay" });

      const result = computeBudgetMonth(
        budgetInput({
          month: "2026-05-01",
          budgetStartMonth: "2026-05-01",
          categoryGroups: [incomeGroup],
          categories: [incomeCat],
          transactions: [
            // 9 years of historical paychecks — must be invisible
            makeTransaction({ category_id: "c-pay", date: "2017-01-01", amount: 50000 }),
            makeTransaction({ category_id: "c-pay", date: "2024-12-31", amount: 80000 }),
            // First real Zero paycheck on/after cutoff
            makeTransaction({ category_id: "c-pay", date: "2026-05-15", amount: 5000 }),
          ],
        })
      );

      expect(result.totalIncome).toBe(5000);
      expect(result.readyToAssign).toBe(5000);
    });

    it("excludes pre-cutoff transactions from category activity", () => {
      const group = makeCategoryGroup({ id: "g1" });
      const cat = makeCategory("g1", { id: "c1" });

      const result = computeBudgetMonth(
        budgetInput({
          month: "2026-05-01",
          budgetStartMonth: "2026-05-01",
          categoryGroups: [group],
          categories: [cat],
          transactions: [
            makeTransaction({ category_id: "c1", date: "2020-06-01", amount: -10000 }),
            makeTransaction({ category_id: "c1", date: "2026-05-10", amount: -75 }),
          ],
        })
      );

      const row = result.groups[0].categories[0];
      expect(row.activity).toBe(-75);
      expect(row.available).toBe(-75);
    });

    it("excludes pre-cutoff assignments from totalAssigned and available", () => {
      const group = makeCategoryGroup({ id: "g1" });
      const cat = makeCategory("g1", { id: "c1" });

      const result = computeBudgetMonth(
        budgetInput({
          month: "2026-05-01",
          budgetStartMonth: "2026-05-01",
          categoryGroups: [group],
          categories: [cat],
          monthlyBudgets: [
            makeMonthlyBudget({ category_id: "c1", month: "2024-01-01", assigned: 9999 }),
            makeMonthlyBudget({ category_id: "c1", month: "2026-05-01", assigned: 200 }),
          ],
        })
      );

      expect(result.totalAssigned).toBe(200);
      expect(result.groups[0].categories[0].available).toBe(200);
    });

    it("does not cascade pre-cutoff overspending into current RTA", () => {
      const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
      const incomeCat = makeCategory("g-income", { id: "c-pay" });
      const group = makeCategoryGroup({ id: "g1" });
      const cat = makeCategory("g1", { id: "c1" });

      const result = computeBudgetMonth(
        budgetInput({
          month: "2026-05-01",
          budgetStartMonth: "2026-05-01",
          categoryGroups: [incomeGroup, group],
          categories: [incomeCat, cat],
          // April 2026 (pre-cutoff): overspent by $500 — must be ignored
          monthlyBudgets: [makeMonthlyBudget({ category_id: "c1", month: "2026-04-01", assigned: 0 })],
          transactions: [
            makeTransaction({ category_id: "c1", date: "2026-04-15", amount: -500 }),
            makeTransaction({ category_id: "c-pay", date: "2026-05-15", amount: 3000 }),
          ],
        })
      );

      expect(result.overspentLastMonth).toBe(0);
      expect(result.readyToAssign).toBe(3000);
    });

    it("omitting budgetStartMonth preserves pre-cutoff behavior", () => {
      const incomeGroup = makeCategoryGroup({ id: "g-income", is_income: true });
      const incomeCat = makeCategory("g-income", { id: "c-pay" });

      const result = computeBudgetMonth(
        budgetInput({
          month: "2026-05-01",
          // budgetStartMonth intentionally omitted
          categoryGroups: [incomeGroup],
          categories: [incomeCat],
          transactions: [
            makeTransaction({ category_id: "c-pay", date: "2017-01-01", amount: 50000 }),
            makeTransaction({ category_id: "c-pay", date: "2026-05-15", amount: 5000 }),
          ],
        })
      );

      expect(result.totalIncome).toBe(55000);
      expect(result.readyToAssign).toBe(55000);
    });
  });
});
