import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { READY_TO_ASSIGN_CATEGORY_ID } from "@/lib/db";

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

const seedCard = (id: string, balance: number) => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, ?, 'credit_card', 1, 1, ?, 0, 0, ?, ?)`
  ).run(id, USER_ID, `Card ${id}`, balance, now, now);
};

const seedChecking = (id: string, balance: number) => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, ?, 'checking', 1, 0, ?, 0, 0, ?, ?)`
  ).run(id, USER_ID, `Checking ${id}`, balance, now, now);
};

const accountRow = (id: string) =>
  db.prepare("SELECT current_balance FROM accounts WHERE id = ?").get(id) as
    | { current_balance: number }
    | undefined;

const txnsFor = (id: string) =>
  db
    .prepare("SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at")
    .all(id) as Record<string, unknown>[];

describe("updateAccountBalanceWithSnapshot — credit card sign handling", () => {
  it("negates positive 'amount owed' input for credit cards and writes the correct diff txn", async () => {
    seedCard("cc-1", -8000);

    const { updateAccountBalanceWithSnapshot } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    const snapshot = await updateAccountBalanceWithSnapshot("cc-1", 5000);

    // User typed 5000 ("I now owe $5,000") → stored as -5000.
    expect(accountRow("cc-1")?.current_balance).toBe(-5000);

    // Adjustment transaction reflects the signed diff: -5000 - (-8000) = +3000
    const txns = txnsFor("cc-1");
    expect(txns).toHaveLength(1);
    expect(txns[0].payee).toBe("Balance adjustment");
    expect(txns[0].amount).toBe(3000);
    expect(txns[0].category_id).toBe(READY_TO_ASSIGN_CATEGORY_ID);
    expect(txns[0].cleared).toBe(1);
    expect(txns[0].approved).toBe(1);

    // Snapshot returns the raw previous balance for undo symmetry.
    expect(snapshot.previousBalance).toBe(-8000);
    expect(snapshot.accountId).toBe("cc-1");
  });

  it("tolerates negative input for credit cards (-5000 → -5000)", async () => {
    seedCard("cc-2", -8000);

    const { updateAccountBalanceWithSnapshot } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await updateAccountBalanceWithSnapshot("cc-2", -5000);

    expect(accountRow("cc-2")?.current_balance).toBe(-5000);
    const txns = txnsFor("cc-2");
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(3000);
  });

  it("undo restores the prior negative balance exactly (sign-symmetric)", async () => {
    seedCard("cc-3", -8000);

    const { updateAccountBalanceWithSnapshot, undoBalanceAdjustment } =
      await import("@/app/(app)/transfer-plan/actions");

    const snapshot = await updateAccountBalanceWithSnapshot("cc-3", 5000);
    expect(accountRow("cc-3")?.current_balance).toBe(-5000);

    await undoBalanceAdjustment(snapshot);

    expect(accountRow("cc-3")?.current_balance).toBe(-8000);
    expect(txnsFor("cc-3")).toHaveLength(0);
  });

  it("does NOT negate for non-debt accounts (checking unchanged)", async () => {
    seedChecking("chk-1", 1000);

    const { updateAccountBalanceWithSnapshot } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await updateAccountBalanceWithSnapshot("chk-1", 800);

    expect(accountRow("chk-1")?.current_balance).toBe(800);
    const txns = txnsFor("chk-1");
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(-200); // 800 - 1000
  });

  it("undo for non-debt path still restores prior balance (regression guard)", async () => {
    seedChecking("chk-2", 1000);

    const { updateAccountBalanceWithSnapshot, undoBalanceAdjustment } =
      await import("@/app/(app)/transfer-plan/actions");

    const snapshot = await updateAccountBalanceWithSnapshot("chk-2", 800);
    expect(accountRow("chk-2")?.current_balance).toBe(800);
    expect(snapshot.previousBalance).toBe(1000);

    await undoBalanceAdjustment(snapshot);

    expect(accountRow("chk-2")?.current_balance).toBe(1000);
    expect(txnsFor("chk-2")).toHaveLength(0);
  });
});
