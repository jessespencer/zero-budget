import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";

const USER_ID = "00000000-0000-0000-0000-000000000000";
// Both months must be at/after the default budget_start_month ("2026-05-01")
// so the engine's historical cutoff does not filter out seeded data.
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

function seedCategory(groupId: string, name: string, sortOrder = 0, archived = false): string {
  const id = `c-${name}`;
  db.prepare(
    "INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, USER_ID, groupId, name, sortOrder, archived ? 1 : 0);
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
  db.prepare(
    `INSERT OR IGNORE INTO accounts (id, user_id, name, type, current_balance) VALUES (?, ?, ?, ?, ?)`
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

function getCategoryArchived(categoryId: string): number {
  const row = db
    .prepare("SELECT archived FROM categories WHERE id = ?")
    .get(categoryId) as { archived: number };
  return row.archived;
}

function getGroupArchived(groupId: string): number {
  const row = db
    .prepare("SELECT archived FROM category_groups WHERE id = ?")
    .get(groupId) as { archived: number };
  return row.archived;
}

function getCategoryGroupId(categoryId: string): string {
  const row = db
    .prepare("SELECT category_group_id FROM categories WHERE id = ?")
    .get(categoryId) as { category_group_id: string };
  return row.category_group_id;
}

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

function isGroupActive(
  budget: Awaited<ReturnType<typeof computeMonth>>,
  groupId: string
): boolean {
  return budget.groups.some((g) => g.id === groupId);
}

// ── archiveGroupWithSnapshot ─────────────────────────────────────────

describe("archiveGroupWithSnapshot", () => {
  it("(a) 3 visible cats $100/$200/$50 → group archived, RTA rises $350, snapshot records all 3, children keep archived=0", async () => {
    const { archiveGroupWithSnapshot } = await import("@/app/(app)/budget/actions");

    seedGroup("Pet");
    seedCategory("g-Pet", "Food", 0);
    seedCategory("g-Pet", "Vet", 1);
    seedCategory("g-Pet", "Toys", 2);
    seedAssigned("c-Food", MONTH, 100);
    seedAssigned("c-Vet", MONTH, 200);
    seedAssigned("c-Toys", MONTH, 50);

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;

    const snapshot = await archiveGroupWithSnapshot("g-Pet", MONTH);

    expect(getGroupArchived("g-Pet")).toBe(1);
    expect(snapshot.groupId).toBe("g-Pet");
    expect(snapshot.sweptCategories.map((s) => s.categoryId).sort()).toEqual([
      "c-Food",
      "c-Toys",
      "c-Vet",
    ]);
    // Children's own archived flag is NEVER touched by a group op.
    expect(getCategoryArchived("c-Food")).toBe(0);
    expect(getCategoryArchived("c-Vet")).toBe(0);
    expect(getCategoryArchived("c-Toys")).toBe(0);

    const after = await computeMonth();
    expect(after.readyToAssign - rtaBefore).toBeCloseTo(350, 6);
  });

  it("(b) an overspent (negative available) child sweeps 0", async () => {
    const { archiveGroupWithSnapshot } = await import("@/app/(app)/budget/actions");

    seedGroup("Pet");
    seedCategory("g-Pet", "Food", 0);
    seedCategory("g-Pet", "Vet", 1);
    seedAssigned("c-Food", MONTH, 100);
    seedAssigned("c-Vet", MONTH, 50);
    seedSpend("c-Vet", "2026-06-10", -90); // available -40 → sweep 0

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;
    expect(findCategoryAvailable(before, "c-Vet")).toBeCloseTo(-40, 6);

    await archiveGroupWithSnapshot("g-Pet", MONTH);

    // Only Food's $100 swept; Vet's assigned unchanged.
    expect(getAssigned("c-Food", MONTH)).toBe(0);
    expect(getAssigned("c-Vet", MONTH)).toBe(50);

    const after = await computeMonth();
    expect(after.readyToAssign - rtaBefore).toBeCloseTo(100, 6);
  });

  it("(c) a child individually hidden BEFORE the group-hide is NOT swept/recorded and stays archived=1", async () => {
    const { archiveGroupWithSnapshot } = await import("@/app/(app)/budget/actions");

    seedGroup("Pet");
    seedCategory("g-Pet", "Food", 0);
    seedCategory("g-Pet", "Old", 1, true); // already individually hidden
    seedAssigned("c-Food", MONTH, 100);
    seedAssigned("c-Old", MONTH, 999);

    const snapshot = await archiveGroupWithSnapshot("g-Pet", MONTH);

    // c-Old is not in budget.groups, so not swept and not recorded.
    expect(snapshot.sweptCategories.map((s) => s.categoryId)).toEqual(["c-Food"]);
    expect(getAssigned("c-Old", MONTH)).toBe(999); // untouched
    expect(getCategoryArchived("c-Old")).toBe(1); // stays archived
  });

  it("(d) empty group hides with zero sweeps, no throw", async () => {
    const { archiveGroupWithSnapshot } = await import("@/app/(app)/budget/actions");

    seedGroup("Empty");

    const snapshot = await archiveGroupWithSnapshot("g-Empty", MONTH);

    expect(getGroupArchived("g-Empty")).toBe(1);
    expect(snapshot.sweptCategories).toEqual([]);
  });
});

// ── restoreArchiveGroupSnapshot ──────────────────────────────────────

describe("restoreArchiveGroupSnapshot", () => {
  it("(e) round-trips RTA AND each child's available to the cent AND group.archived back to 0", async () => {
    const { archiveGroupWithSnapshot, restoreArchiveGroupSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );

    seedGroup("Pet");
    seedCategory("g-Pet", "Food", 0);
    seedCategory("g-Pet", "Vet", 1);
    seedAssigned("c-Food", MONTH, 100);
    seedAssigned("c-Vet", PRIOR_MONTH, 200); // prior-month available

    const before = await computeMonth();
    const rtaBefore = before.readyToAssign;
    const foodAvailBefore = findCategoryAvailable(before, "c-Food");
    const vetAvailBefore = findCategoryAvailable(before, "c-Vet");

    const snapshot = await archiveGroupWithSnapshot("g-Pet", MONTH);
    await restoreArchiveGroupSnapshot(snapshot);

    expect(getGroupArchived("g-Pet")).toBe(0);

    const after = await computeMonth();
    expect(after.readyToAssign).toBeCloseTo(rtaBefore, 6);
    expect(findCategoryAvailable(after, "c-Food")).toBeCloseTo(foodAvailBefore, 6);
    expect(findCategoryAvailable(after, "c-Vet")).toBeCloseTo(vetAvailBefore, 6);
  });
});

// ── unarchiveGroupWithSnapshot ───────────────────────────────────────

describe("unarchiveGroupWithSnapshot", () => {
  it("(f) brings back the WHOLE group + ALL categories incl. a pre-hidden child, records it, no RTA change", async () => {
    const { archiveGroupWithSnapshot, unarchiveGroupWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );

    seedGroup("Pet");
    seedCategory("g-Pet", "Food", 0); // visible at hide time
    seedCategory("g-Pet", "Old", 1, true); // individually hidden earlier
    seedAssigned("c-Food", MONTH, 100);

    await archiveGroupWithSnapshot("g-Pet", MONTH);

    const beforeUnhide = await computeMonth();
    const rtaBeforeUnhide = beforeUnhide.readyToAssign;

    const result = await unarchiveGroupWithSnapshot("g-Pet");

    expect(result.groupId).toBe("g-Pet");
    expect(getGroupArchived("g-Pet")).toBe(0);
    // Unhiding the group brings EVERYTHING back — including the pre-hidden child.
    expect(getCategoryArchived("c-Old")).toBe(0);
    expect(getCategoryArchived("c-Food")).toBe(0);
    expect(getCategoryGroupId("c-Food")).toBe("g-Pet");
    // The pre-hidden child it flipped back is recorded for undo.
    expect(result.reHiddenCategoryIds).toEqual(["c-Old"]);

    const after = await computeMonth();
    // Both children reappear in the active grid.
    expect(isGroupActive(after, "g-Pet")).toBe(true);
    expect(findCategoryAvailable(after, "c-Food")).not.toBeNaN();
    expect(findCategoryAvailable(after, "c-Old")).not.toBeNaN();
    // No balance change on unhide — money stayed in RTA.
    expect(after.readyToAssign).toBeCloseTo(rtaBeforeUnhide, 6);
  });
});

// ── restoreUnarchiveGroupSnapshot ────────────────────────────────────

describe("restoreUnarchiveGroupSnapshot", () => {
  it("(g) re-hides the group AND re-applies the individual hides the unhide cleared", async () => {
    const {
      archiveGroupWithSnapshot,
      unarchiveGroupWithSnapshot,
      restoreUnarchiveGroupSnapshot,
    } = await import("@/app/(app)/budget/actions");

    seedGroup("Pet");
    seedCategory("g-Pet", "Food", 0);
    seedCategory("g-Pet", "Old", 1, true); // individually hidden earlier
    seedAssigned("c-Food", MONTH, 100);

    await archiveGroupWithSnapshot("g-Pet", MONTH);
    const result = await unarchiveGroupWithSnapshot("g-Pet");
    // Unhide brought both back.
    expect(getCategoryArchived("c-Old")).toBe(0);
    const foodAssignedBefore = getAssigned("c-Food", MONTH);

    await restoreUnarchiveGroupSnapshot(result);

    // Undo restores the exact prior state: group re-hidden, the pre-hidden child
    // re-hidden, the visible-at-hide child untouched (it was never individually hidden).
    expect(getGroupArchived("g-Pet")).toBe(1);
    expect(getCategoryArchived("c-Old")).toBe(1);
    expect(getCategoryArchived("c-Food")).toBe(0);
    expect(getAssigned("c-Food", MONTH)).toBe(foodAssignedBefore);
  });
});
