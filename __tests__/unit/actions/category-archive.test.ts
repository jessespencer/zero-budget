import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";

const USER_ID = "00000000-0000-0000-0000-000000000000";
// Both months must be at/after the default budget_start_month ("2026-05-01")
// so the engine's historical cutoff does not filter out seeded data. PRIOR is
// the live month before MONTH.
const MONTH = "2026-06-01";
const PRIOR_MONTH = "2026-05-01";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  clearTestDb();
  db.close();
});

// ── Seed helpers ─────────────────────────────────────────────────────

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

function seedAssigned(categoryId: string, month: string, assigned: number) {
  db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  ).run(`mb-${categoryId}-${month}`, USER_ID, categoryId, month, assigned);
}

function seedSpend(categoryId: string, date: string, amount: number) {
  // amount should be negative for an outflow
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, current_balance) VALUES (?, ?, ?, ?, ?)`
  ).run("acct-1", USER_ID, "Checking", "checking", 0);
  db.prepare(
    `INSERT OR IGNORE INTO transactions (id, user_id, account_id, date, amount, category_id, is_split_parent)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(`txn-${categoryId}-${date}`, USER_ID, "acct-1", date, amount, categoryId);
}

function getAssigned(categoryId: string, month: string): number | undefined {
  const row = db
    .prepare("SELECT assigned FROM monthly_budgets WHERE category_id = ? AND month = ?")
    .get(categoryId, month) as { assigned: number } | undefined;
  return row?.assigned;
}

function getArchived(categoryId: string): number {
  const row = db
    .prepare("SELECT archived FROM categories WHERE id = ?")
    .get(categoryId) as { archived: number };
  return row.archived;
}

// Compute the engine state for MONTH so RTA / available can be asserted to the cent.
async function computeMonth() {
  const { getBudgetData } = await import("@/app/(app)/budget/actions");
  const { computeBudgetMonth } = await import("@/lib/budget-engine");
  return computeBudgetMonth(await getBudgetData(MONTH));
}

function findCategoryAvailable(
  budget: Awaited<ReturnType<typeof computeMonth>>,
  categoryId: string
): number {
  for (const group of budget.groups) {
    const cat = group.categories.find((c) => c.id === categoryId);
    if (cat) return cat.available;
  }
  return NaN; // archived/missing — not in active groups
}

describe("archiveCategoryWithSnapshot", () => {
  it("full sweep: current-month assigned $300, no activity → assigned 0, RTA rises $300", async () => {
    const { archiveCategoryWithSnapshot } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    seedAssigned("c-Rent", MONTH, 300);

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;

    const snapshot = await archiveCategoryWithSnapshot("c-Rent", MONTH);

    expect(getArchived("c-Rent")).toBe(1);
    expect(getAssigned("c-Rent", MONTH)).toBe(0);
    expect(snapshot.previousAssigned).toBe(300);

    const after = await computeMonth();
    expect(after.readyToAssign - rtaBefore).toBeCloseTo(300, 6);
  });

  it("prior-month available + $0 current: sweeps $200, newAssigned goes negative, available lands 0", async () => {
    const { archiveCategoryWithSnapshot } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Travel");
    // $200 accumulated from a prior month, nothing this month
    seedAssigned("c-Travel", PRIOR_MONTH, 200);

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;
    // Confirm the precondition: $200 available, $0 current-month assigned
    expect(findCategoryAvailable(before, "c-Travel")).toBeCloseTo(200, 6);

    const snapshot = await archiveCategoryWithSnapshot("c-Travel", MONTH);

    // newAssigned = previousAssigned(0) - sweep(200) = -200
    expect(getAssigned("c-Travel", MONTH)).toBeCloseTo(-200, 6);
    expect(snapshot.previousAssigned).toBe(0);

    const after = await computeMonth();
    expect(after.readyToAssign - rtaBefore).toBeCloseTo(200, 6);
  });

  it("overspent: assigned $300, spent $350 → available -$50 → sweep 0, assigned unchanged, RTA unchanged", async () => {
    const { archiveCategoryWithSnapshot } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Food");
    seedAssigned("c-Food", MONTH, 300);
    seedSpend("c-Food", "2026-06-10", -350);

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;
    expect(findCategoryAvailable(before, "c-Food")).toBeCloseTo(-50, 6);

    const snapshot = await archiveCategoryWithSnapshot("c-Food", MONTH);

    expect(getAssigned("c-Food", MONTH)).toBe(300); // unchanged
    expect(snapshot.previousAssigned).toBe(300);

    const after = await computeMonth();
    expect(after.readyToAssign - rtaBefore).toBeCloseTo(0, 6);
  });

  it("partial spend: assigned $300, spent $250 → available $50 → sweep $50, assigned $250, RTA rises $50", async () => {
    const { archiveCategoryWithSnapshot } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Gas");
    seedAssigned("c-Gas", MONTH, 300);
    seedSpend("c-Gas", "2026-06-10", -250);

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;
    expect(findCategoryAvailable(before, "c-Gas")).toBeCloseTo(50, 6);

    const snapshot = await archiveCategoryWithSnapshot("c-Gas", MONTH);

    expect(getAssigned("c-Gas", MONTH)).toBeCloseTo(250, 6);
    expect(snapshot.previousAssigned).toBe(300);

    const after = await computeMonth();
    expect(after.readyToAssign - rtaBefore).toBeCloseTo(50, 6);
  });

  it("no-op edge: available 0 and no monthly_budgets row → sweep 0, previousAssigned 0, no throw", async () => {
    const { archiveCategoryWithSnapshot } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Empty");

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;

    const snapshot = await archiveCategoryWithSnapshot("c-Empty", MONTH);

    expect(snapshot.previousAssigned).toBe(0);
    expect(getArchived("c-Empty")).toBe(1);
    // sweep wrote newAssigned = 0 - 0 = 0
    expect(getAssigned("c-Empty", MONTH)).toBe(0);

    const after = await computeMonth();
    expect(after.readyToAssign - rtaBefore).toBeCloseTo(0, 6);
  });
});

describe("restoreArchiveCategorySnapshot", () => {
  it("round-trips RTA and the category's available exactly (full sweep case)", async () => {
    const { archiveCategoryWithSnapshot, restoreArchiveCategorySnapshot } = await import(
      "@/app/(app)/budget/actions"
    );

    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    seedAssigned("c-Rent", MONTH, 300);

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;
    const availBefore = findCategoryAvailable(before, "c-Rent");

    const snapshot = await archiveCategoryWithSnapshot("c-Rent", MONTH);
    await restoreArchiveCategorySnapshot(snapshot);

    expect(getArchived("c-Rent")).toBe(0);
    expect(getAssigned("c-Rent", MONTH)).toBe(300);

    const after = await computeMonth();
    expect(after.readyToAssign).toBeCloseTo(rtaBefore, 6);
    expect(findCategoryAvailable(after, "c-Rent")).toBeCloseTo(availBefore, 6);
  });

  it("round-trips the prior-month-available case (newAssigned was negative)", async () => {
    const { archiveCategoryWithSnapshot, restoreArchiveCategorySnapshot } = await import(
      "@/app/(app)/budget/actions"
    );

    seedGroup("Bills");
    seedCategory("g-Bills", "Travel");
    seedAssigned("c-Travel", PRIOR_MONTH, 200);

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;
    const availBefore = findCategoryAvailable(before, "c-Travel");

    const snapshot = await archiveCategoryWithSnapshot("c-Travel", MONTH);
    await restoreArchiveCategorySnapshot(snapshot);

    // previousAssigned was 0, so the (category, MONTH) row is restored to 0
    expect(getAssigned("c-Travel", MONTH)).toBe(0);

    const after = await computeMonth();
    expect(after.readyToAssign).toBeCloseTo(rtaBefore, 6);
    expect(findCategoryAvailable(after, "c-Travel")).toBeCloseTo(availBefore, 6);
  });
});

describe("unarchiveCategoryWithSnapshot", () => {
  it("flips archived to 0 and returns category to its original group (no reassignment)", async () => {
    const { archiveCategoryWithSnapshot, unarchiveCategoryWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );

    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    seedAssigned("c-Rent", MONTH, 300);

    await archiveCategoryWithSnapshot("c-Rent", MONTH);
    const result = await unarchiveCategoryWithSnapshot("c-Rent");

    expect(result.categoryId).toBe("c-Rent");
    expect(getArchived("c-Rent")).toBe(0);

    const row = db
      .prepare("SELECT category_group_id FROM categories WHERE id = ?")
      .get("c-Rent") as { category_group_id: string };
    expect(row.category_group_id).toBe("g-Bills");
  });
});

describe("restoreUnarchiveCategorySnapshot", () => {
  it("re-hides the category (archived back to 1), no assigned change", async () => {
    const {
      archiveCategoryWithSnapshot,
      unarchiveCategoryWithSnapshot,
      restoreUnarchiveCategorySnapshot,
    } = await import("@/app/(app)/budget/actions");

    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    seedAssigned("c-Rent", MONTH, 300);

    await archiveCategoryWithSnapshot("c-Rent", MONTH);
    const result = await unarchiveCategoryWithSnapshot("c-Rent");
    const assignedAfterUnarchive = getAssigned("c-Rent", MONTH);

    await restoreUnarchiveCategorySnapshot(result);

    expect(getArchived("c-Rent")).toBe(1);
    expect(getAssigned("c-Rent", MONTH)).toBe(assignedAfterUnarchive);
  });
});
