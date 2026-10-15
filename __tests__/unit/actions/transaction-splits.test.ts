import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { __resetCutoffCache } from "@/lib/balance";

// Tier-2 coverage for the split surface, which had zero action tests going in
// (see the transactions-core quality work order). These prove the DB ends up
// right: that saving splits replaces rather than appends, that a snapshot
// round-trips the exact prior allocation, and — the money bug — that the
// server-side belt refuses to persist a split set that doesn't sum to the
// parent total.

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  db.prepare(
    `UPDATE app_settings SET value = '1900-01-01' WHERE key = 'budget_start_month'`
  ).run();
  __resetCutoffCache();

  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 1, 0, 0, 0)`
  ).run("acct-1", USER_ID, "Checking", "checking");

  // Two expense categories for the split lines.
  db.prepare(
    "INSERT INTO category_groups (id, user_id, name, sort_order, is_income) VALUES (?, ?, ?, 0, 0)"
  ).run("g-1", USER_ID, "Everyday");
  db.prepare(
    "INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived) VALUES (?, ?, ?, ?, 0, 0)"
  ).run("c-groceries", USER_ID, "g-1", "Groceries");
  db.prepare(
    "INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived) VALUES (?, ?, ?, ?, 1, 0)"
  ).run("c-dining", USER_ID, "g-1", "Dining");
});

afterEach(() => {
  clearTestDb();
  __resetCutoffCache();
  db.close();
});

// Create a -120 parent and return its id.
async function seedParent(amount = -120): Promise<string> {
  const { createTransaction } = await import("@/app/(app)/transactions/actions");
  const parent = await createTransaction({
    date: "2026-04-15",
    payee: "Costco",
    amount,
    account_id: "acct-1",
  });
  return parent.id;
}

function splitRows(parentId: string) {
  return db
    .prepare(
      `SELECT category_id, amount FROM transaction_splits WHERE parent_transaction_id = ? ORDER BY created_at, amount`
    )
    .all(parentId) as { category_id: string | null; amount: number }[];
}

describe("split actions", () => {
  it("saveSplits promotes the parent and replaces the split set (no append)", async () => {
    const { saveSplits } = await import("@/app/(app)/transactions/actions");
    const id = await seedParent();

    await saveSplits(id, [
      { category_id: "c-groceries", amount: -100 },
      { category_id: "c-dining", amount: -20 },
    ]);

    let rows = splitRows(id);
    expect(rows).toHaveLength(2);

    const parent = db
      .prepare("SELECT is_split_parent, category_id, amount FROM transactions WHERE id = ?")
      .get(id) as { is_split_parent: number; category_id: string | null; amount: number };
    expect(parent.is_split_parent).toBe(1);
    expect(parent.category_id).toBeNull();
    expect(parent.amount).toBe(-120);

    // Saving again replaces rather than appends.
    await saveSplits(id, [
      { category_id: "c-groceries", amount: -70 },
      { category_id: "c-dining", amount: -50 },
    ]);
    rows = splitRows(id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-70, -50].sort((a, b) => a - b));
  });

  it("saveSplitsWithSnapshot + restoreSplitSnapshot round-trips the exact prior allocation", async () => {
    const { saveSplits, saveSplitsWithSnapshot, restoreSplitSnapshot } = await import(
      "@/app/(app)/transactions/actions"
    );
    const id = await seedParent();

    // Prior allocation: -90 / -30 across two categories.
    await saveSplits(id, [
      { category_id: "c-groceries", amount: -90 },
      { category_id: "c-dining", amount: -30 },
    ]);

    // Overwrite with a different balanced split, capturing the snapshot.
    const snapshot = await saveSplitsWithSnapshot(id, [
      { category_id: "c-groceries", amount: -60 },
      { category_id: "c-dining", amount: -60 },
    ]);
    expect(splitRows(id).map((r) => r.amount).sort((a, b) => a - b)).toEqual([-60, -60]);

    // Undo restores the exact prior amounts AND category ids.
    await restoreSplitSnapshot(id, snapshot);
    const rows = splitRows(id);
    expect(rows).toEqual([
      { category_id: "c-groceries", amount: -90 },
      { category_id: "c-dining", amount: -30 },
    ]);
  });

  it("removeSplits clears children and leaves the parent amount untouched", async () => {
    const { saveSplits, removeSplits } = await import("@/app/(app)/transactions/actions");
    const id = await seedParent();
    await saveSplits(id, [
      { category_id: "c-groceries", amount: -80 },
      { category_id: "c-dining", amount: -40 },
    ]);

    await removeSplits(id, "c-groceries");

    expect(splitRows(id)).toHaveLength(0);
    const parent = db
      .prepare("SELECT is_split_parent, category_id, amount FROM transactions WHERE id = ?")
      .get(id) as { is_split_parent: number; category_id: string | null; amount: number };
    expect(parent.is_split_parent).toBe(0);
    expect(parent.category_id).toBe("c-groceries");
    expect(parent.amount).toBe(-120);
  });

  it("removeSplitsWithSnapshot + restoreSplitSnapshot round-trips back to the split set", async () => {
    const { saveSplits, removeSplitsWithSnapshot, restoreSplitSnapshot } = await import(
      "@/app/(app)/transactions/actions"
    );
    const id = await seedParent();
    await saveSplits(id, [
      { category_id: "c-groceries", amount: -80 },
      { category_id: "c-dining", amount: -40 },
    ]);

    const snapshot = await removeSplitsWithSnapshot(id, "c-groceries");
    expect(splitRows(id)).toHaveLength(0);

    await restoreSplitSnapshot(id, snapshot);
    const rows = splitRows(id);
    expect(rows).toEqual([
      { category_id: "c-groceries", amount: -80 },
      { category_id: "c-dining", amount: -40 },
    ]);
    const parent = db
      .prepare("SELECT is_split_parent FROM transactions WHERE id = ?")
      .get(id) as { is_split_parent: number };
    expect(parent.is_split_parent).toBe(1);
  });

  // The belt: this is the server half of the split-allocation-loss fix. A set
  // whose sum ≠ the parent total must throw, so no call site — now or later —
  // can silently persist an under-allocated split.
  describe("balance belt", () => {
    it("saveSplits throws when the split sum does not equal the parent amount", async () => {
      const { saveSplits } = await import("@/app/(app)/transactions/actions");
      const id = await seedParent(-120);

      await expect(
        saveSplits(id, [
          { category_id: "c-groceries", amount: -40 },
          { category_id: "c-dining", amount: -30 },
        ])
      ).rejects.toThrow(/does not equal the transaction total/);

      // Nothing was written — the parent stays a plain transaction.
      expect(splitRows(id)).toHaveLength(0);
      const parent = db
        .prepare("SELECT is_split_parent FROM transactions WHERE id = ?")
        .get(id) as { is_split_parent: number };
      expect(parent.is_split_parent).toBe(0);
    });

    it("saveSplitsWithSnapshot throws on an unbalanced set", async () => {
      const { saveSplitsWithSnapshot } = await import("@/app/(app)/transactions/actions");
      const id = await seedParent(-120);

      await expect(
        saveSplitsWithSnapshot(id, [
          { category_id: "c-groceries", amount: -40 },
          { category_id: "c-dining", amount: -30 },
        ])
      ).rejects.toThrow(/does not equal the transaction total/);
    });

    it("accepts a balanced set to the cent", async () => {
      const { saveSplits } = await import("@/app/(app)/transactions/actions");
      const id = await seedParent(-100);

      // $100 / 3 with a cent remainder on the last line — sums to exactly -100.
      await expect(
        saveSplits(id, [
          { category_id: "c-groceries", amount: -33.33 },
          { category_id: "c-dining", amount: -33.33 },
          { category_id: "c-groceries", amount: -33.34 },
        ])
      ).resolves.toBeUndefined();
      expect(splitRows(id)).toHaveLength(3);
    });
  });
});
