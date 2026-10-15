import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { computeBudgetMonth } from "@/lib/budget-engine";
import { __resetCutoffCache } from "@/lib/balance";

/**
 * Does deleting a category conserve money?
 *
 * Hiding a category sweeps only `Math.max(0, available)` back to Ready to
 * Assign and leaves every historical `monthly_budgets` row in place, so the
 * budget engine keeps counting what was actually assigned and spent.
 *
 * Deleting takes a different route: `monthly_budgets.category_id` is
 * `ON DELETE CASCADE` (001_initial.sql:46) and the delete path never touches
 * that table, so the FK erases the category's entire assign history in every
 * month at once. The engine sums `assigned` over all months and derives prior
 * overspend from the live `categories` table, so both figures move.
 *
 * These tests pin the actual behaviour rather than the intended behaviour —
 * see the file-level note on the second test.
 */

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  // app_settings.budget_start_month defaults to 2026-05-01, which would gate
  // out every transaction below and make Ready to Assign a flat 0 on both
  // sides of the delete — the assertion would pass for the wrong reason.
  db.prepare(
    `UPDATE app_settings SET value = '1900-01-01' WHERE key = 'budget_start_month'`
  ).run();
  __resetCutoffCache();
});

afterEach(() => {
  clearTestDb();
  db.close();
});

function seedGroup(id: string, name: string, isIncome = false): void {
  db.prepare(
    "INSERT INTO category_groups (id, user_id, name, sort_order, is_income) VALUES (?, ?, ?, 0, ?)"
  ).run(id, USER_ID, name, isIncome ? 1 : 0);
}

function seedCategory(id: string, groupId: string, name: string): void {
  db.prepare(
    "INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived) VALUES (?, ?, ?, ?, 0, 0)"
  ).run(id, USER_ID, groupId, name);
}

function seedAccount(id: string, name: string): void {
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
     VALUES (?, ?, ?, 'checking', 1, 0, 0, 0)`
  ).run(id, USER_ID, name);
}

function seedTxn(
  id: string,
  date: string,
  amount: number,
  categoryId: string
): void {
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, created_at, updated_at)
     VALUES (?, ?, 'acct-1', ?, 'seed', ?, ?, datetime('now'), datetime('now'))`
  ).run(id, USER_ID, date, amount, categoryId);
}

/**
 * $1,000 of income, and a Dining category that was assigned $200 in January,
 * spent $180 of it, then overspent by a further $150 in February.
 *
 * Dining's true position: $20 left over from January, minus $150 of February
 * overspend it never had the money for.
 */
async function seedOverspentCategory() {
  const { updateAssigned } = await import("@/app/(app)/budget/actions");

  seedAccount("acct-1", "Checking");
  seedGroup("g-income", "Income", true);
  seedCategory("c-paycheck", "g-income", "Paycheck");
  seedGroup("g-bills", "Bills");
  seedCategory("c-dining", "g-bills", "Dining");

  seedTxn("t-income", "2026-01-05", 1000, "c-paycheck");
  await updateAssigned("c-dining", "2026-01-01", 200);
  seedTxn("t-jan", "2026-01-20", -180, "c-dining");
  seedTxn("t-feb", "2026-02-10", -150, "c-dining");
}

async function readyToAssign(month: string): Promise<number> {
  const { getBudgetData } = await import("@/app/(app)/budget/actions");
  return computeBudgetMonth(await getBudgetData(month)).readyToAssign;
}

describe("deleting a category and the money it was holding", () => {
  it("hiding sweeps nothing from an overspent category", async () => {
    const { archiveCategoryWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );
    await seedOverspentCategory();

    const before = await readyToAssign("2026-03-01");
    await archiveCategoryWithSnapshot("c-dining", "2026-03-01");
    const after = await readyToAssign("2026-03-01");

    // The control case. Hide is the careful path: an overspent category has no
    // positive balance to give back, so Ready to Assign must not move at all.
    expect(after).toBeCloseTo(before, 2);
  });

  it("refuses to delete a category whose budget history would be lost", async () => {
    const { bulkDeleteCategoriesWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );
    await seedOverspentCategory();

    // Used to succeed and hand back $330 that didn't exist: monthly_budgets is
    // ON DELETE CASCADE, so the assign history vanished and the engine — which
    // derives Ready to Assign from a sum over all months — stopped counting it.
    // The error was the category's lifetime *spending*; the balance itself
    // legitimately returns.
    await expect(
      bulkDeleteCategoriesWithSnapshot({
        categoryIds: ["c-dining"],
        groupIds: [],
        reassignToCategoryId: null,
      })
    ).rejects.toThrow(/budget history/i);

    expect(await readyToAssign("2026-03-01")).toBeCloseTo(
      await readyToAssign("2026-03-01"),
      2
    );
    expect(
      db.prepare("SELECT COUNT(*) n FROM categories WHERE id = ?").get("c-dining")
    ).toEqual({ n: 1 });
  });

  it("deleting with a reassignment target leaves Ready to Assign untouched", async () => {
    const { bulkDeleteCategoriesWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );
    await seedOverspentCategory();
    seedCategory("c-household", "g-bills", "Household");

    const before = await readyToAssign("2026-03-01");
    await bulkDeleteCategoriesWithSnapshot({
      categoryIds: ["c-dining"],
      groupIds: [],
      reassignToCategoryId: "c-household",
    });

    // The envelope is merged, not discarded: both the transactions and the
    // assign history move to Household, so the all-time totals are unchanged
    // and Ready to Assign doesn't move at all.
    expect(await readyToAssign("2026-03-01")).toBeCloseTo(before, 2);

    const merged = db
      .prepare(
        "SELECT ROUND(SUM(assigned),2) n FROM monthly_budgets WHERE category_id = ?"
      )
      .get("c-household") as { n: number };
    expect(merged.n).toBeCloseTo(200, 2);
  });

  it("undoing a reassigning delete does not leave the money in both places", async () => {
    const { bulkDeleteCategoriesWithSnapshot, restoreCategoryDeletionSnapshot } =
      await import("@/app/(app)/budget/actions");
    await seedOverspentCategory();
    seedCategory("c-household", "g-bills", "Household");
    // Household has its own history, so the merge lands on an existing row and
    // the reversal has to subtract rather than delete.
    const { updateAssigned } = await import("@/app/(app)/budget/actions");
    await updateAssigned("c-household", "2026-01-01", 75);

    const before = await readyToAssign("2026-03-01");
    const snapshot = await bulkDeleteCategoriesWithSnapshot({
      categoryIds: ["c-dining"],
      groupIds: [],
      reassignToCategoryId: "c-household",
    });
    await restoreCategoryDeletionSnapshot(snapshot);

    expect(await readyToAssign("2026-03-01")).toBeCloseTo(before, 2);
    const household = db
      .prepare(
        "SELECT ROUND(SUM(assigned),2) n FROM monthly_budgets WHERE category_id = ?"
      )
      .get("c-household") as { n: number };
    // Back to its own $75 — not $275 carrying Dining's merged history twice.
    expect(household.n).toBeCloseTo(75, 2);
  });

  // `deleteCategory` used to be a second, older path that issued a bare DELETE
  // and rode the FK cascade — same $330 invention as the original bug, and the
  // test here asserted that defect. Migration 029 made the FK RESTRICT and the
  // action now guards explicitly, so both halves are checked below.
  it("refuses the raw deleteCategory path when it would erase budget history", async () => {
    const { deleteCategory } = await import("@/app/(app)/budget/actions");
    await seedOverspentCategory();

    const before = await readyToAssign("2026-03-01");
    await expect(deleteCategory("c-dining")).rejects.toThrow(/budget history/i);

    // The money is the point: this used to hand back $330 that didn't exist —
    // $200 of erased assignment plus $130 of vanished overspend.
    expect(await readyToAssign("2026-03-01")).toBeCloseTo(before, 2);
    expect(
      db.prepare("SELECT COUNT(*) n FROM categories WHERE id = ?").get("c-dining")
    ).toEqual({ n: 1 });
    expect(
      db
        .prepare("SELECT COUNT(*) n FROM monthly_budgets WHERE category_id = ?")
        .get("c-dining")
    ).toEqual({ n: 1 });
  });

  // The reason deleteCategory exists at all: it is the backward() of "add
  // category" (category-group-row.tsx). Undoing an add must keep working, or
  // the guard has traded one bug for another.
  it("still deletes a just-created category, so undoing an add works", async () => {
    const { addCategory, deleteCategory } = await import(
      "@/app/(app)/budget/actions"
    );
    await seedOverspentCategory();

    const id = await addCategory("g-bills", "Typo");
    const before = await readyToAssign("2026-03-01");
    await deleteCategory(id);

    expect(await readyToAssign("2026-03-01")).toBeCloseTo(before, 2);
    expect(
      db.prepare("SELECT COUNT(*) n FROM categories WHERE id = ?").get(id)
    ).toEqual({ n: 0 });
  });

  // A category assigned $50 and then zeroed again leaves an `assigned = 0` row
  // behind. It contributes nothing to the engine's all-months sum, so it must
  // not block the undo — otherwise assign-then-undo-then-undo-the-add wedges.
  it("deletes a category whose only assign rows are zero", async () => {
    const { addCategory, updateAssigned, deleteCategory } = await import(
      "@/app/(app)/budget/actions"
    );
    await seedOverspentCategory();

    const id = await addCategory("g-bills", "Assigned then undone");
    await updateAssigned(id, "2026-01-01", 50);
    await updateAssigned(id, "2026-01-01", 0);
    expect(
      db
        .prepare("SELECT COUNT(*) n FROM monthly_budgets WHERE category_id = ?")
        .get(id)
    ).toEqual({ n: 1 });

    const before = await readyToAssign("2026-03-01");
    await deleteCategory(id);

    expect(await readyToAssign("2026-03-01")).toBeCloseTo(before, 2);
    expect(
      db.prepare("SELECT COUNT(*) n FROM categories WHERE id = ?").get(id)
    ).toEqual({ n: 0 });
    // And the empty row goes with it — RESTRICT would refuse the delete
    // otherwise, so leaving it behind isn't an option.
    expect(
      db
        .prepare("SELECT COUNT(*) n FROM monthly_budgets WHERE category_id = ?")
        .get(id)
    ).toEqual({ n: 0 });
  });

  it("refuses to delete a group whose child holds budget history", async () => {
    const { deleteCategoryGroup } = await import("@/app/(app)/budget/actions");
    await seedOverspentCategory();

    const before = await readyToAssign("2026-03-01");
    // g-bills is Dining's group: the cascade would take Dining's history with
    // it, one level removed from the category the user was looking at.
    await expect(deleteCategoryGroup("g-bills")).rejects.toThrow(
      /budget history/i
    );

    expect(await readyToAssign("2026-03-01")).toBeCloseTo(before, 2);
    expect(
      db.prepare("SELECT COUNT(*) n FROM category_groups WHERE id = ?").get("g-bills")
    ).toEqual({ n: 1 });
  });

  it("still deletes a just-created group, so undoing an add-group works", async () => {
    const { addCategoryGroup, deleteCategoryGroup } = await import(
      "@/app/(app)/budget/actions"
    );
    await seedOverspentCategory();

    const groupId = await addCategoryGroup("Typo group");
    const before = await readyToAssign("2026-03-01");
    await deleteCategoryGroup(groupId);

    expect(await readyToAssign("2026-03-01")).toBeCloseTo(before, 2);
    expect(
      db.prepare("SELECT COUNT(*) n FROM category_groups WHERE id = ?").get(groupId)
    ).toEqual({ n: 0 });
  });

  // The belt, independent of any application code: even a hand-written DELETE
  // — a future action, a script, a psql-equivalent session — can no longer
  // erase assign history. This is what makes the class impossible rather than
  // fixing the two instances that existed.
  it("the schema itself refuses to cascade assign history away", async () => {
    await seedOverspentCategory();

    expect(() =>
      db
        .prepare("DELETE FROM categories WHERE id = ? AND user_id = ?")
        .run("c-dining", USER_ID)
    ).toThrow(/FOREIGN KEY constraint failed/i);

    expect(
      db
        .prepare("SELECT COUNT(*) n FROM monthly_budgets WHERE category_id = ?")
        .get("c-dining")
    ).toEqual({ n: 1 });
  });

  it("deletes a category with no budget history without complaint", async () => {
    const { bulkDeleteCategoriesWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );
    await seedOverspentCategory();
    seedCategory("c-unused", "g-bills", "Created by mistake");

    // The guard is about losing assign history, not about deleting at all —
    // a category that never held money still goes in one click.
    const before = await readyToAssign("2026-03-01");
    await bulkDeleteCategoriesWithSnapshot({
      categoryIds: ["c-unused"],
      groupIds: [],
      reassignToCategoryId: null,
    });

    expect(await readyToAssign("2026-03-01")).toBeCloseTo(before, 2);
    expect(
      db.prepare("SELECT COUNT(*) n FROM categories WHERE id = ?").get("c-unused")
    ).toEqual({ n: 0 });
  });
});
