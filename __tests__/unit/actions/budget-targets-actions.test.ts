import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";

// Actions tier for targets, goals and auto-assign — the layer the trace flagged
// as entirely absent. These prove the DB ends up right (and, for the snapshot
// actions, that undo restores the EXACT prior state); the call-site wiring is
// the *.test.tsx component tier.

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

const DEFAULT_TARGET = {
  type: "monthly_funding" as const,
  frequency: "monthly" as const,
  target_amount: 300,
  target_date: null,
  monthly_contribution: 300,
  recurring: false,
};

describe("target CRUD", () => {
  it("createTarget writes a row scoped to the user", async () => {
    const { createTarget } = await import("@/app/(app)/budget/actions");
    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");

    const id = await createTarget("c-Rent", DEFAULT_TARGET);

    const row = db
      .prepare("SELECT * FROM targets WHERE id = ?")
      .get(id) as Record<string, unknown>;
    expect(row.user_id).toBe(USER_ID);
    expect(row.category_id).toBe("c-Rent");
    expect(row.target_amount).toBe(300);
  });

  it("updateTarget changes only the supplied fields", async () => {
    const { createTarget, updateTarget } = await import("@/app/(app)/budget/actions");
    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    const id = await createTarget("c-Rent", DEFAULT_TARGET);

    await updateTarget(id, { target_amount: 450 });

    const row = db
      .prepare("SELECT type, target_amount FROM targets WHERE id = ?")
      .get(id) as { type: string; target_amount: number };
    expect(row.target_amount).toBe(450);
    expect(row.type).toBe("monthly_funding"); // untouched
  });

  it("deleteTargetWithSnapshot removes the row and returns the whole target", async () => {
    const { createTarget, deleteTargetWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );
    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    const id = await createTarget("c-Rent", {
      ...DEFAULT_TARGET,
      type: "target_by_date",
      target_date: "2026-12-01",
    });

    const snapshot = await deleteTargetWithSnapshot(id);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.id).toBe(id);
    expect(snapshot!.target_date).toBe("2026-12-01");
    const gone = db.prepare("SELECT id FROM targets WHERE id = ?").get(id);
    expect(gone).toBeUndefined();
  });

  it("deleteTargetWithSnapshot returns null when the target is already gone", async () => {
    const { deleteTargetWithSnapshot } = await import("@/app/(app)/budget/actions");
    expect(await deleteTargetWithSnapshot("nope")).toBeNull();
  });

  it("restoreTarget puts every field back exactly (delete → undo round-trip)", async () => {
    const { createTarget, deleteTargetWithSnapshot, restoreTarget } = await import(
      "@/app/(app)/budget/actions"
    );
    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    const id = await createTarget("c-Rent", {
      type: "savings_balance",
      frequency: "custom",
      target_amount: 5000,
      target_date: "2027-01-01",
      monthly_contribution: 200,
      recurring: true,
    });
    const before = db.prepare("SELECT * FROM targets WHERE id = ?").get(id);

    const snapshot = await deleteTargetWithSnapshot(id);
    await restoreTarget(snapshot!);

    const after = db.prepare("SELECT * FROM targets WHERE id = ?").get(id);
    expect(after).toEqual(before);
  });
});

describe("setCategoryAssignedWithSnapshot", () => {
  it("returns the value read from the DB at call time, not the argument", async () => {
    const { updateAssigned, setCategoryAssignedWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );
    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");

    // Set the true prior value out-of-band, then overwrite it.
    await updateAssigned("c-Rent", "2026-05-01", 100);
    const { previous } = await setCategoryAssignedWithSnapshot(
      "c-Rent",
      "2026-05-01",
      250
    );

    expect(previous).toBe(100);
    const row = db
      .prepare("SELECT assigned FROM monthly_budgets WHERE category_id = ? AND month = ?")
      .get("c-Rent", "2026-05-01") as { assigned: number };
    expect(row.assigned).toBe(250);
  });
});

describe("copyLastMonthBudgetWithSnapshot", () => {
  it("copies the prior month and restores exactly on undo", async () => {
    const { updateAssigned, copyLastMonthBudgetWithSnapshot, restoreAssignedSnapshot } =
      await import("@/app/(app)/budget/actions");
    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");

    await updateAssigned("c-Rent", "2026-03-01", 1500); // prior month
    await updateAssigned("c-Rent", "2026-04-01", 999); // current, pre-copy

    const snapshot = await copyLastMonthBudgetWithSnapshot("2026-04-01");
    expect(snapshot).not.toBeNull();

    let april = db
      .prepare("SELECT assigned FROM monthly_budgets WHERE category_id = ? AND month = ?")
      .get("c-Rent", "2026-04-01") as { assigned: number };
    expect(april.assigned).toBe(1500);

    await restoreAssignedSnapshot("2026-04-01", snapshot!);
    april = db
      .prepare("SELECT assigned FROM monthly_budgets WHERE category_id = ? AND month = ?")
      .get("c-Rent", "2026-04-01") as { assigned: number };
    expect(april.assigned).toBe(999);
  });

  it("returns null when the previous month has no assignments", async () => {
    const { copyLastMonthBudgetWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );
    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");

    expect(await copyLastMonthBudgetWithSnapshot("2026-04-01")).toBeNull();
  });
});

describe("copy last month: fill-empty mode and preview", () => {
  function seedScene() {
    seedGroup("Bills");
    seedCategory("g-Bills", "Rent");
    seedCategory("g-Bills", "Power");
    seedCategory("g-Bills", "Water");
  }

  it("previews what would be overwritten vs filled", async () => {
    const { updateAssigned, getCopyLastMonthPreview } = await import(
      "@/app/(app)/budget/actions"
    );
    seedScene();
    await updateAssigned("c-Rent", "2026-03-01", 1500);
    await updateAssigned("c-Power", "2026-03-01", 120);
    await updateAssigned("c-Water", "2026-03-01", 60);
    await updateAssigned("c-Rent", "2026-04-01", 1400); // differs → overwrite
    await updateAssigned("c-Water", "2026-04-01", 60); // same → no change

    expect(await getCopyLastMonthPreview("2026-04-01")).toEqual({
      overwriteCount: 1,
      overwriteAssigned: 1400,
      fillCount: 1, // Power
    });
  });

  it("fill-empty keeps this month's work and restores exactly on undo", async () => {
    const { updateAssigned, copyLastMonthBudgetWithSnapshot, restoreAssignedSnapshot } =
      await import("@/app/(app)/budget/actions");
    seedScene();
    await updateAssigned("c-Rent", "2026-03-01", 1500);
    await updateAssigned("c-Power", "2026-03-01", 120);
    await updateAssigned("c-Rent", "2026-04-01", 1400);

    const snapshot = await copyLastMonthBudgetWithSnapshot("2026-04-01", "fill-empty");
    expect(snapshot).toEqual([{ category_id: "c-Power", assigned: 0 }]);

    const april = (id: string) =>
      (
        db
          .prepare("SELECT assigned FROM monthly_budgets WHERE category_id = ? AND month = ?")
          .get(id, "2026-04-01") as { assigned: number } | undefined
      )?.assigned ?? 0;
    expect(april("c-Rent")).toBe(1400); // kept
    expect(april("c-Power")).toBe(120); // filled

    await restoreAssignedSnapshot("2026-04-01", snapshot!);
    expect(april("c-Power")).toBe(0);
    expect(april("c-Rent")).toBe(1400);
  });

  it("fill-empty is a no-op when nothing is empty", async () => {
    const { updateAssigned, copyLastMonthBudgetWithSnapshot } = await import(
      "@/app/(app)/budget/actions"
    );
    seedScene();
    await updateAssigned("c-Rent", "2026-03-01", 1500);
    await updateAssigned("c-Rent", "2026-04-01", 1400);

    expect(await copyLastMonthBudgetWithSnapshot("2026-04-01", "fill-empty")).toBeNull();
  });
});

describe("fundUnderfunded", () => {
  // An overspent category (available < 0) with no target: computeCategoryUnderfunded
  // returns the overspend cover, so it's the simplest underfunded scene.
  function seedOverspentScene(): void {
    seedAccount("acct-1", "Checking");
    seedGroup("Income", 0, true);
    seedCategory("g-Income", "Paycheck");
    seedGroup("Bills", 1);
    seedCategory("g-Bills", "Rent");
    seedTxn("t-income", "acct-1", "2026-05-15", 1000, "c-Paycheck");
    seedTxn("t-spend", "acct-1", "2026-05-20", -50, "c-Rent"); // available = −50
  }

  it("preview total matches what the write actually assigns", async () => {
    const { getFundUnderfundedPreview } = await import("@/app/(app)/budget/actions");
    seedOverspentScene();

    const preview = await getFundUnderfundedPreview("2026-05-01");
    const rent = preview.find((r) => r.category_id === "c-Rent");
    expect(rent).toBeDefined();
    expect(rent!.amount).toBeCloseTo(50, 2);
  });

  it("funds underfunded categories and restores exactly on undo", async () => {
    const {
      getFundUnderfundedPreview,
      fundUnderfundedWithSnapshot,
      restoreAssignedSnapshot,
    } = await import("@/app/(app)/budget/actions");
    seedOverspentScene();

    const previewTotal = (await getFundUnderfundedPreview("2026-05-01")).reduce(
      (s, r) => s + r.amount,
      0
    );

    const snapshot = await fundUnderfundedWithSnapshot("2026-05-01");
    expect(snapshot).not.toBeNull();

    const funded = db
      .prepare("SELECT assigned FROM monthly_budgets WHERE category_id = ? AND month = ?")
      .get("c-Rent", "2026-05-01") as { assigned: number };
    // Was 0 assigned; the write must move exactly the previewed amount.
    expect(funded.assigned).toBeCloseTo(previewTotal, 2);

    await restoreAssignedSnapshot("2026-05-01", snapshot!);
    const restored = db
      .prepare("SELECT assigned FROM monthly_budgets WHERE category_id = ? AND month = ?")
      .get("c-Rent", "2026-05-01") as { assigned: number } | undefined;
    expect(restored?.assigned ?? 0).toBe(0);
  });

  it("returns null when nothing is underfunded", async () => {
    const { fundUnderfundedWithSnapshot } = await import("@/app/(app)/budget/actions");
    seedAccount("acct-1", "Checking");
    seedGroup("Income", 0, true);
    seedCategory("g-Income", "Paycheck");
    seedGroup("Bills", 1);
    seedCategory("g-Bills", "Rent");
    seedTxn("t-income", "acct-1", "2026-05-15", 1000, "c-Paycheck");
    // No spending, no targets — nothing to fund.

    expect(await fundUnderfundedWithSnapshot("2026-05-01")).toBeNull();
  });
});
