import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { computeBudgetMonth } from "@/lib/budget-engine";

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  clearTestDb();
  db.close();
});

// Helper to seed data directly
function seedGroup(name: string, sortOrder = 0, isIncome = false): string {
  const id = `g-${name}`;
  db.prepare(
    "INSERT INTO category_groups (id, user_id, name, sort_order, is_income) VALUES (?, ?, ?, ?, ?)"
  ).run(id, USER_ID, name, sortOrder, isIncome ? 1 : 0);
  return id;
}

function seedCategory(groupId: string, name: string, sortOrder = 0): string {
  const id = `c-${name}`;
  db.prepare(
    "INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(id, USER_ID, groupId, name, sortOrder);
  return id;
}

describe("budget actions", () => {
  it("updateAssigned upserts monthly budget", async () => {
    const { updateAssigned } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");

    await updateAssigned("c-Rent", "2026-04-01", 1500);

    const row = db
      .prepare("SELECT assigned FROM monthly_budgets WHERE category_id = ? AND month = ?")
      .get("c-Rent", "2026-04-01") as { assigned: number };

    expect(row.assigned).toBe(1500);
  });

  it("updateAssigned updates existing budget on conflict", async () => {
    const { updateAssigned } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");

    await updateAssigned("c-Rent", "2026-04-01", 1500);
    await updateAssigned("c-Rent", "2026-04-01", 2000);

    const row = db
      .prepare("SELECT assigned FROM monthly_budgets WHERE category_id = ? AND month = ?")
      .get("c-Rent", "2026-04-01") as { assigned: number };

    expect(row.assigned).toBe(2000);
  });

  it("addCategoryGroup creates group with correct sort_order", async () => {
    const { addCategoryGroup } = await import("@/app/(app)/budget/actions");

    await addCategoryGroup("First Group");
    await addCategoryGroup("Second Group");

    const groups = db
      .prepare("SELECT name, sort_order FROM category_groups WHERE user_id = ? ORDER BY sort_order")
      .all(USER_ID) as { name: string; sort_order: number }[];

    // System group (migration 005) and Inflow group (migration 008) are
    // both is_system = 1 and don't participate in user-visible sort order.
    // The user-created groups show up at the start, sorted by sort_order.
    const userGroups = groups.filter(
      (g) => g.name !== "System" && g.name !== "Inflow"
    );
    expect(userGroups).toHaveLength(2);
    // addCategoryGroup prepends (min sort_order - 1), so newest is first
    expect(userGroups[0].name).toBe("Second Group");
    expect(userGroups[0].sort_order).toBe(-1);
    expect(userGroups[1].name).toBe("First Group");
    expect(userGroups[1].sort_order).toBe(0);
  });

  it("addCategory creates category in the specified group", async () => {
    const { addCategory } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");

    const catId = await addCategory("g-Bills", "Rent");

    const row = db
      .prepare("SELECT name, category_group_id FROM categories WHERE id = ?")
      .get(catId) as { name: string; category_group_id: string };

    expect(row.name).toBe("Rent");
    expect(row.category_group_id).toBe("g-Bills");
  });

  it("deleteCategoryGroup removes the group", async () => {
    const { deleteCategoryGroup } = await import("@/app/(app)/budget/actions");

    seedGroup("ToDelete");

    await deleteCategoryGroup("g-ToDelete");

    const row = db.prepare("SELECT id FROM category_groups WHERE id = ?").get("g-ToDelete");
    expect(row).toBeUndefined();
  });

  it("deleteCategory removes the category", async () => {
    const { deleteCategory } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");

    await deleteCategory("c-Rent");

    const row = db.prepare("SELECT id FROM categories WHERE id = ?").get("c-Rent");
    expect(row).toBeUndefined();
  });

  it("reorderCategoryGroups updates sort_order", async () => {
    const { reorderCategoryGroups } = await import("@/app/(app)/budget/actions");

    seedGroup("A", 0);
    seedGroup("B", 1);
    seedGroup("C", 2);

    await reorderCategoryGroups(["g-C", "g-A", "g-B"]);

    const groups = db
      .prepare("SELECT id, sort_order FROM category_groups WHERE user_id = ? ORDER BY sort_order")
      .all(USER_ID) as { id: string; sort_order: number }[];

    // Sort-order tail (ascending) after user-reordered groups:
    // System (migration 017, sort_order = 2147483645) → Inflow (migration 008,
    // 2147483646) → System (migration 005, 2147483647). All three is_system,
    // ordered after user-reordered groups.
    expect(groups.map((g) => g.id)).toEqual([
      "g-C",
      "g-A",
      "g-B",
      "ba1a7c00-0000-4000-8000-000000000005",
      "ba1a7c00-0000-4000-8000-000000000003",
      "ba1a7c00-0000-4000-8000-000000000001",
    ]);
  });

  it("moveCategoryToGroup moves category and returns old position", async () => {
    const { moveCategoryToGroup } = await import("@/app/(app)/budget/actions");

    seedGroup("GroupA");
    seedGroup("GroupB");
    seedCategory("g-GroupA", "Rent", 0);

    const result = await moveCategoryToGroup("c-Rent", "g-GroupB");

    expect(result.oldGroupId).toBe("g-GroupA");
    expect(result.oldSortOrder).toBe(0);

    const row = db
      .prepare("SELECT category_group_id FROM categories WHERE id = ?")
      .get("c-Rent") as { category_group_id: string };
    expect(row.category_group_id).toBe("g-GroupB");
  });

  it("copyLastMonthBudget copies previous month assignments", async () => {
    const { copyLastMonthBudget, updateAssigned } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    seedCategory("g-Bills", "Electric");

    await updateAssigned("c-Rent", "2026-03-01", 1500);
    await updateAssigned("c-Electric", "2026-03-01", 200);

    await copyLastMonthBudget("2026-04-01");

    const april = db
      .prepare("SELECT category_id, assigned FROM monthly_budgets WHERE month = ? ORDER BY category_id")
      .all("2026-04-01") as { category_id: string; assigned: number }[];

    expect(april).toHaveLength(2);
    expect(april.find((r) => r.category_id === "c-Electric")!.assigned).toBe(200);
    expect(april.find((r) => r.category_id === "c-Rent")!.assigned).toBe(1500);
  });

  it("getBudgetData returns all necessary data for budget computation", async () => {
    const { getBudgetData } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");

    const data = await getBudgetData("2026-04-01");

    expect(data.month).toBe("2026-04-01");
    // user-created Bills + system System (migration 005) + system Inflow
    // (migration 008) + system System (migration 017)
    expect(data.categoryGroups).toHaveLength(4);
    // user-created Rent + system Balance adjustment (migration 005) + system
    // Ready to assign (migration 008) + system Category not needed (017)
    expect(data.categories).toHaveLength(4);
  });
});

// Regression guard for the app-level bug where getBudgetData filtered
// monthly_budgets to `month <= current`, so the engine never saw later-month
// assignments and futureAssigned was always 0 in the running app (the pure
// budget-engine unit tests injected future rows directly, masking it). These
// tests run the REAL fetch → engine chain so a future edit can't silently
// re-add the `month <=` filter without a red test.
describe("getBudgetData → future-month RTA drain (integration)", () => {
  function seedIncomeGroup(name: string, sortOrder = 0): string {
    const id = `g-${name}`;
    db.prepare(
      "INSERT INTO category_groups (id, user_id, name, sort_order, is_income) VALUES (?, ?, ?, ?, 1)"
    ).run(id, USER_ID, name, sortOrder);
    return id;
  }

  function seedAccount(id: string, name: string): void {
    db.prepare(
      `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
       VALUES (?, ?, ?, 'checking', 1, 0, 0, 0)`
    ).run(id, USER_ID, name);
  }

  function seedTxn(
    id: string,
    accountId: string,
    date: string,
    amount: number,
    categoryId: string
  ): void {
    db.prepare(
      `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'seed', ?, ?, datetime('now'), datetime('now'))`
    ).run(id, USER_ID, accountId, date, amount, categoryId);
  }

  // Shared scene: $1000 income landed in May (the budget start month), one
  // spendable category, no May assignment. May's Ready to Assign is $1000 until
  // a later month claims it.
  function setupPool(): void {
    seedAccount("acct-1", "Checking");
    seedIncomeGroup("Income");
    seedCategory("g-Income", "Paycheck");
    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    seedTxn("txn-income", "acct-1", "2026-05-15", 1000, "c-Paycheck");
  }

  it("a June assignment drains May's Ready to Assign toward zero", async () => {
    const { getBudgetData, updateAssigned } = await import("@/app/(app)/budget/actions");
    setupPool();

    await updateAssigned("c-Rent", "2026-06-01", 300);

    const data = await getBudgetData("2026-05-01");

    // The load-bearing assertion: the fetch must include the future (June) row.
    // If someone re-adds `WHERE month <= ?`, this flips false and the drain dies.
    expect(data.monthlyBudgets.some((mb) => mb.month === "2026-06-01")).toBe(true);

    const may = computeBudgetMonth(data);
    expect(may.futureAssigned).toBeCloseTo(300, 2);
    expect(may.readyToAssign).toBeCloseTo(700, 2); // 1000 pool − 300 assigned in June
  });

  it("a June OVER-assignment floors May at zero, never negative", async () => {
    const { getBudgetData, updateAssigned } = await import("@/app/(app)/budget/actions");
    setupPool();

    await updateAssigned("c-Rent", "2026-06-01", 1500); // more than the $1000 pool

    const may = computeBudgetMonth(await getBudgetData("2026-05-01"));
    expect(may.readyToAssign).toBeCloseTo(0, 2); // floored, NOT −500
  });
});

// ─── Category deletion undo ──────────────────────────────────
//
// Deleting a category strands every transaction pointing at it (over a
// thousand for a long-lived category), so this restore is the only way back and must never
// report success it didn't achieve. Two distinct failure modes, and they
// behave differently in SQLite:
//
//   - `OR IGNORE` suppresses UNIQUE / NOT NULL / CHECK / PK violations, so a
//     row can be skipped with no error at all. That is what the returned
//     `ok` / `missing*` counts exist to catch.
//   - FOREIGN KEY violations are NOT covered by ON CONFLICT — they throw, and
//     the surrounding db.transaction() rolls everything back. That throw is
//     invisible unless the caller catches it, which is why the undo entry in
//     the budget UI wraps this call.

describe("restoreCategoryDeletionSnapshot", () => {
  const catsInGroup = (groupId: string) =>
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM categories WHERE category_group_id = ?")
        .get(groupId) as { n: number }
    ).n;

  it("reports ok and brings the group and its categories back", async () => {
    const { bulkDeleteCategoriesWithSnapshot, restoreCategoryDeletionSnapshot } =
      await import("@/app/(app)/budget/actions");

    const groupId = seedGroup("Special");
    seedCategory(groupId, "Travel");
    seedCategory(groupId, "Birthdays");

    const snapshot = await bulkDeleteCategoriesWithSnapshot({
      categoryIds: [],
      groupIds: [groupId],
      reassignToCategoryId: null,
    });
    expect(catsInGroup(groupId)).toBe(0);

    const res = await restoreCategoryDeletionSnapshot(snapshot);

    expect(res).toEqual({ ok: true, missingGroups: 0, missingCategories: 0 });
    expect(catsInGroup(groupId)).toBe(2);
  });

  it("reports a row that OR IGNORE silently skipped instead of claiming success", async () => {
    const { bulkDeleteCategoriesWithSnapshot, restoreCategoryDeletionSnapshot } =
      await import("@/app/(app)/budget/actions");

    const groupId = seedGroup("Special");
    seedCategory(groupId, "Travel");
    seedCategory(groupId, "Birthdays");

    const snapshot = await bulkDeleteCategoriesWithSnapshot({
      categoryIds: [],
      groupIds: [groupId],
      reassignToCategoryId: null,
    });

    // Force one category's insert to violate NOT NULL, which is exactly the
    // class `OR IGNORE` swallows: no error is raised, the row simply never
    // lands. Before this change the function returned void and the caller
    // reported a clean undo over a category that never came back.
    (snapshot.categories[0] as { name: string | null }).name = null;

    const res = await restoreCategoryDeletionSnapshot(snapshot);

    expect(res.ok).toBe(false);
    expect(res.missingCategories).toBe(1);
    expect(res.missingGroups).toBe(0);
    // The other category still made it — a partial restore, correctly reported.
    expect(catsInGroup(groupId)).toBe(1);
  });

  it("rolls back cleanly when a restore cannot complete", async () => {
    const { bulkDeleteCategoriesWithSnapshot, restoreCategoryDeletionSnapshot } =
      await import("@/app/(app)/budget/actions");

    const groupId = seedGroup("Special");
    seedCategory(groupId, "Travel");

    const snapshot = await bulkDeleteCategoriesWithSnapshot({
      categoryIds: [],
      groupIds: [groupId],
      reassignToCategoryId: null,
    });

    // An FK violation is not suppressed by OR IGNORE — it throws. The caller
    // must catch it, because the whole transaction rolls back and nothing on
    // screen would otherwise change.
    snapshot.categories[0].category_group_id = "does-not-exist";

    await expect(restoreCategoryDeletionSnapshot(snapshot)).rejects.toThrow();
    expect(catsInGroup(groupId)).toBe(0);
  });
});

// Snapshot-action gap closure (budget-assign quality pass). These prove the
// DB round-trips the callers in expected-income-input.tsx and
// move-money-popover.tsx rely on — a wrong snapshot is what turns undo
// destructive, which no wiring test can see.
describe("updateExpectedIncome", () => {
  function forecast(month: string): number | undefined {
    const row = db
      .prepare(
        "SELECT expected_income FROM monthly_income_forecast WHERE user_id = ? AND month = ?"
      )
      .get(USER_ID, month) as { expected_income: number } | undefined;
    return row?.expected_income;
  }

  it("upserts a forecast, then overwrites it on conflict", async () => {
    const { updateExpectedIncome } = await import("@/app/(app)/budget/actions");

    await updateExpectedIncome("2026-04-01", 5000);
    expect(forecast("2026-04-01")).toBe(5000);

    await updateExpectedIncome("2026-04-01", 6200);
    expect(forecast("2026-04-01")).toBe(6200);
  });

  it("clears the forecast when passed null", async () => {
    const { updateExpectedIncome } = await import("@/app/(app)/budget/actions");

    await updateExpectedIncome("2026-04-01", 5000);
    await updateExpectedIncome("2026-04-01", null);

    expect(forecast("2026-04-01")).toBeUndefined();
  });
});

describe("moveMoneyBetweenCategoriesWithSnapshot + restore", () => {
  const MONTH = "2026-04-01";

  function assigned(categoryId: string): number | undefined {
    const row = db
      .prepare(
        "SELECT assigned FROM monthly_budgets WHERE user_id = ? AND category_id = ? AND month = ?"
      )
      .get(USER_ID, categoryId, MONTH) as { assigned: number } | undefined;
    return row?.assigned;
  }

  it("round-trips two categories to byte-identical amounts", async () => {
    const { moveMoneyBetweenCategoriesWithSnapshot, restoreMoveMoneySnapshot } =
      await import("@/app/(app)/budget/actions");

    seedGroup("Everyday");
    seedCategory("g-Everyday", "Groceries");
    seedCategory("g-Everyday", "Dining", 1);
    const { updateAssigned } = await import("@/app/(app)/budget/actions");
    await updateAssigned("c-Groceries", MONTH, 300);
    await updateAssigned("c-Dining", MONTH, 50);

    const snapshot = await moveMoneyBetweenCategoriesWithSnapshot({
      sourceCategoryId: "c-Groceries",
      destCategoryId: "c-Dining",
      amount: 120.5,
      month: MONTH,
    });

    expect(assigned("c-Groceries")).toBe(179.5);
    expect(assigned("c-Dining")).toBe(170.5);

    await restoreMoveMoneySnapshot(snapshot);

    expect(assigned("c-Groceries")).toBe(300);
    expect(assigned("c-Dining")).toBe(50);
  });

  it("round-trips a move to Ready to Assign (source only)", async () => {
    const { moveMoneyBetweenCategoriesWithSnapshot, restoreMoveMoneySnapshot } =
      await import("@/app/(app)/budget/actions");

    seedGroup("Everyday");
    seedCategory("g-Everyday", "Groceries");
    const { updateAssigned } = await import("@/app/(app)/budget/actions");
    await updateAssigned("c-Groceries", MONTH, 300);

    const snapshot = await moveMoneyBetweenCategoriesWithSnapshot({
      sourceCategoryId: "c-Groceries",
      destCategoryId: "RTA",
      amount: 80,
      month: MONTH,
    });

    expect(assigned("c-Groceries")).toBe(220);
    // RTA has no row of its own — the money is derived back into Ready to Assign.
    expect(snapshot.previousDestAssigned).toBeNull();

    await restoreMoveMoneySnapshot(snapshot);
    expect(assigned("c-Groceries")).toBe(300);
  });

  it("rejects a same source/destination move and a non-finite amount", async () => {
    const { moveMoneyBetweenCategoriesWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );

    await expect(
      moveMoneyBetweenCategoriesWithSnapshot({
        sourceCategoryId: "c-Groceries",
        destCategoryId: "c-Groceries",
        amount: 10,
        month: MONTH,
      })
    ).rejects.toThrow(/different/i);

    await expect(
      moveMoneyBetweenCategoriesWithSnapshot({
        sourceCategoryId: "c-Groceries",
        destCategoryId: "c-Dining",
        amount: Number.NaN,
        month: MONTH,
      })
    ).rejects.toThrow(/finite/i);
  });
});
