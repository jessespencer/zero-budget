import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { __resetCutoffCache } from "@/lib/balance";

// F5 — CSV import atomicity.
//
// The old CSV import flow was a per-row loop of `createTransaction`, each in
// its own `db.transaction()`, so a statement that failed partway left every
// earlier row committed with no way to undo the import as a unit. The fix is
// `bulkImportTransactionsWithSnapshot(accountId, rows)`, which inserts every
// row in ONE transaction and returns snapshots for a single Undo. These tests
// exercise that action; the last one is the atomicity guarantee that used to be
// pinned with `it.fails`.

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
});

afterEach(() => {
  clearTestDb();
  __resetCutoffCache();
  db.close();
});

const rowCount = () =>
  (
    db
      .prepare("SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?")
      .get(USER_ID) as { c: number }
  ).c;

const balance = () =>
  (
    db
      .prepare("SELECT current_balance FROM accounts WHERE id = ?")
      .get("acct-1") as { current_balance: number }
  ).current_balance;

describe("CSV import (per-row createTransaction loop)", () => {
  it("a clean batch imports every row and moves the balance by the sum", async () => {
    const { createTransaction } = await import("@/app/(app)/transactions/actions");
    const rows = [
      { date: "2026-04-15", payee: "A", amount: -10, account_id: "acct-1" },
      { date: "2026-04-15", payee: "B", amount: -20, account_id: "acct-1" },
      { date: "2026-04-15", payee: "C", amount: -30, account_id: "acct-1" },
    ];

    for (const r of rows) await createTransaction(r);

    expect(rowCount()).toBe(3);
    expect(balance()).toBe(-60);
  });

  it("bulk import lands every row atomically and returns snapshots", async () => {
    const { bulkImportTransactionsWithSnapshot } = await import(
      "@/app/(app)/transactions/actions"
    );
    const result = await bulkImportTransactionsWithSnapshot("acct-1", [
      { date: "2026-04-15", payee: "A", amount: -10 },
      { date: "2026-04-15", payee: "B", amount: -20 },
      { date: "2026-04-15", payee: "C", amount: -30 },
    ]);

    expect(result.imported).toBe(3);
    expect(result.snapshots).toHaveLength(3);
    expect(rowCount()).toBe(3);
    expect(balance()).toBe(-60);
  });

  it("bulk import is atomic — a mid-batch failure rolls back every row", async () => {
    const { bulkImportTransactionsWithSnapshot } = await import(
      "@/app/(app)/transactions/actions"
    );
    await expect(
      bulkImportTransactionsWithSnapshot("acct-1", [
        { date: "2026-04-15", payee: "A", amount: -10 },
        // Force a failure AFTER row A has already inserted: an amount SQLite
        // can't bind (an object) throws inside the single db.transaction(),
        // rolling the whole batch back. The old per-row loop would have left
        // row A committed and its balance moved.
        {
          date: "2026-04-15",
          payee: "B",
          amount: {} as unknown as number,
        },
        { date: "2026-04-15", payee: "C", amount: -30 },
      ])
    ).rejects.toThrow();

    // Atomic: zero rows and an untouched balance after the failure.
    expect(rowCount()).toBe(0);
    expect(balance()).toBe(0);
  });
});
