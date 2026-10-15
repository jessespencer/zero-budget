import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { __resetCutoffCache } from "@/lib/balance";

// A pending row (approved = 0) is deliberately held OUT of
// accounts.current_balance until it is posted — the import-txns contract: an
// unposted statement line must not move the balance the statement is being
// reconciled against. `postPendingTransactionsWithSnapshot` is the one place
// that finally applies the amount.
//
// Every mutation that touches a pending row's money therefore has to be a
// balance no-op, and the approve/unapprove transition is the only thing that
// may move a held amount. These tests hold that line per call site: delete,
// bulk delete, restore (undo), amount/account edits, account move, and the
// approve flip itself.
//
// The delete/restore pair used to be symmetric-and-wrong — delete reversed an
// amount that was never applied, restore re-applied it — so a round trip
// landed back on the right number and hid the drift. Each half is asserted
// independently here for that reason.

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  // Push the cutoff into the past so it never masks an approval-gate failure —
  // cutoff semantics are covered by __tests__/unit/lib/balance.test.ts.
  db.prepare(
    `UPDATE app_settings SET value = '1900-01-01' WHERE key = 'budget_start_month'`
  ).run();
  __resetCutoffCache();

  for (const [id, name] of [
    ["acct-1", "Checking"],
    ["acct-2", "Savings"],
  ]) {
    db.prepare(
      `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
       VALUES (?, ?, ?, 'checking', 1, 0, 0, 0)`
    ).run(id, USER_ID, name);
  }
});

afterEach(() => {
  clearTestDb();
  __resetCutoffCache();
  db.close();
});

// Insert a pending row the way import-txns build-sql.mjs does: approved = 0
// and the amount deliberately NOT added to current_balance.
function insertPending(
  id: string,
  amount: number,
  opts: { account?: string; date?: string } = {}
) {
  const { account = "acct-1", date = "2026-06-15" } = opts;
  db.prepare(
    `INSERT INTO transactions (id, user_id, date, payee, amount, account_id, approved, source, created_at, updated_at)
     VALUES (?, ?, ?, 'Pending payee', ?, ?, 0, 'desktop', ?, ?)`
  ).run(id, USER_ID, date, amount, account, date, date);
}

// Insert an already-posted row: approved = 1 AND its amount folded into the
// account balance, the state createTransaction leaves behind.
function insertPosted(
  id: string,
  amount: number,
  opts: { account?: string; date?: string } = {}
) {
  const { account = "acct-1", date = "2026-06-15" } = opts;
  db.prepare(
    `INSERT INTO transactions (id, user_id, date, payee, amount, account_id, approved, source, created_at, updated_at)
     VALUES (?, ?, ?, 'Posted payee', ?, ?, 1, 'desktop', ?, ?)`
  ).run(id, USER_ID, date, amount, account, date, date);
  db.prepare(
    `UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?`
  ).run(amount, account);
}

function balance(account = "acct-1"): number {
  return (
    db.prepare("SELECT current_balance FROM accounts WHERE id = ?").get(account) as {
      current_balance: number;
    }
  ).current_balance;
}

function approvedOf(id: string): number {
  return (
    db.prepare("SELECT approved FROM transactions WHERE id = ?").get(id) as {
      approved: number;
    }
  ).approved;
}

describe("pending rows stay out of current_balance", () => {
  it("deleteTransactionWithSnapshot does not reverse a held amount", async () => {
    const { deleteTransactionWithSnapshot } = await import(
      "@/app/(app)/transactions/actions"
    );
    insertPending("p-1", -100);
    expect(balance()).toBe(0);

    await deleteTransactionWithSnapshot("p-1");

    // Reversing -100 here would invent +100 out of nothing.
    expect(balance()).toBe(0);
  });

  it("restoreTransactionSnapshot re-inserts a pending row still held out, and posting moves it exactly once", async () => {
    const {
      deleteTransactionWithSnapshot,
      restoreTransactionSnapshot,
      postPendingTransactionsWithSnapshot,
    } = await import("@/app/(app)/transactions/actions");
    insertPending("p-1", -100);

    const [snap] = await deleteTransactionWithSnapshot("p-1");
    expect(balance()).toBe(0);

    await restoreTransactionSnapshot(snap);

    // Undo puts the row back Pending — its money is still held.
    expect(approvedOf("p-1")).toBe(0);
    expect(balance()).toBe(0);

    await postPendingTransactionsWithSnapshot(["p-1"]);

    // -200 would mean the restore applied it too.
    expect(balance()).toBe(-100);
  });

  it("deleteTransaction (no snapshot) does not reverse a held amount", async () => {
    const { deleteTransaction } = await import("@/app/(app)/transactions/actions");
    insertPending("p-1", -100);

    await deleteTransaction("p-1");

    expect(balance()).toBe(0);
  });

  it("bulkDeleteTransactionsWithSnapshot reverses only the posted rows", async () => {
    const { bulkDeleteTransactionsWithSnapshot } = await import(
      "@/app/(app)/transactions/actions"
    );
    insertPending("p-1", -100);
    insertPosted("a-1", -40);
    expect(balance()).toBe(-40);

    await bulkDeleteTransactionsWithSnapshot(["p-1", "a-1"]);

    // Only a-1's -40 was ever in the balance; p-1 must not add +100 back.
    expect(balance()).toBe(0);
  });

  it("restoreTransactionSnapshots re-applies only the posted rows", async () => {
    const { bulkDeleteTransactionsWithSnapshot, restoreTransactionSnapshots } =
      await import("@/app/(app)/transactions/actions");
    insertPending("p-1", -100);
    insertPosted("a-1", -40);

    const snaps = await bulkDeleteTransactionsWithSnapshot(["p-1", "a-1"]);
    expect(balance()).toBe(0);

    await restoreTransactionSnapshots(snaps);

    // Back to the pre-delete state: -40 in the balance, -100 still held.
    expect(balance()).toBe(-40);
    expect(approvedOf("p-1")).toBe(0);
  });

  it("bulkDeleteTransactions (no snapshot) does not reverse a held amount", async () => {
    const { bulkDeleteTransactions } = await import(
      "@/app/(app)/transactions/actions"
    );
    insertPending("p-1", -100);
    insertPosted("a-1", -40);

    await bulkDeleteTransactions(["p-1", "a-1"]);

    expect(balance()).toBe(0);
  });

  it("editing a pending row's amount leaves the balance alone; posting applies the NEW amount once", async () => {
    const { updateTransaction, postPendingTransactionsWithSnapshot } = await import(
      "@/app/(app)/transactions/actions"
    );
    insertPending("p-1", -100);

    await updateTransaction("p-1", { amount: -150 });

    // A -50 diff on a row whose money was never in the balance.
    expect(balance()).toBe(0);

    await postPendingTransactionsWithSnapshot(["p-1"]);
    expect(balance()).toBe(-150);
  });

  it("moving a pending row to another account moves no money", async () => {
    const { updateTransaction, postPendingTransactionsWithSnapshot } = await import(
      "@/app/(app)/transactions/actions"
    );
    insertPending("p-1", -100);

    await updateTransaction("p-1", { account_id: "acct-2" });

    expect(balance("acct-1")).toBe(0);
    expect(balance("acct-2")).toBe(0);

    await postPendingTransactionsWithSnapshot(["p-1"]);

    // The held amount lands on the destination account, once.
    expect(balance("acct-1")).toBe(0);
    expect(balance("acct-2")).toBe(-100);
  });

  it("approving via updateTransaction applies the held amount exactly once", async () => {
    const { updateTransaction } = await import("@/app/(app)/transactions/actions");
    insertPending("p-1", -100);

    // The "Approve transaction" popover in transaction-table.tsx.
    await updateTransaction("p-1", { approved: true });

    expect(approvedOf("p-1")).toBe(1);
    expect(balance()).toBe(-100);
  });

  it("approving an edited row applies the edited amount, not the original", async () => {
    const { updateTransaction } = await import("@/app/(app)/transactions/actions");
    insertPending("p-1", -100);

    // The approveEdit path in transactions-client.tsx: field edits and the
    // approve flip arrive in ONE call.
    await updateTransaction("p-1", { approved: true, amount: -150 });

    expect(balance()).toBe(-150);
  });

  it("un-approving via updateTransaction reverses the amount back out", async () => {
    const { updateTransaction } = await import("@/app/(app)/transactions/actions");
    insertPosted("a-1", -100);
    expect(balance()).toBe(-100);

    // The backward() of the approve entry pushed by approveEdit.
    await updateTransaction("a-1", { approved: false });

    expect(approvedOf("a-1")).toBe(0);
    expect(balance()).toBe(0);
  });

  it("bulk-moving a pending row between accounts moves no money, in either direction", async () => {
    const {
      bulkMoveTransactionsToAccountWithSnapshot,
      restoreAccountMoveSnapshot,
      postPendingTransactionsWithSnapshot,
    } = await import("@/app/(app)/transactions/actions");
    insertPending("p-1", -100);
    insertPosted("a-1", -40);

    const snapshot = await bulkMoveTransactionsToAccountWithSnapshot(
      ["p-1", "a-1"],
      "acct-2"
    );

    // Only the posted row's money follows it.
    expect(balance("acct-1")).toBe(0);
    expect(balance("acct-2")).toBe(-40);

    await restoreAccountMoveSnapshot(snapshot);

    expect(balance("acct-1")).toBe(-40);
    expect(balance("acct-2")).toBe(0);

    await postPendingTransactionsWithSnapshot(["p-1"]);
    expect(balance("acct-1")).toBe(-140);
  });

  it("bulkUpdateTransactions refuses money-bearing columns instead of drifting the balance", async () => {
    const { bulkUpdateTransactions } = await import(
      "@/app/(app)/transactions/actions"
    );
    insertPending("p-1", -100);

    // A raw UPDATE that flips approved bypasses the gate entirely — the row
    // would read as posted with its amount never applied.
    await expect(
      bulkUpdateTransactions(["p-1"], { approved: 1 })
    ).rejects.toThrow();
    await expect(
      bulkUpdateTransactions(["p-1"], { amount: -150 })
    ).rejects.toThrow();

    expect(approvedOf("p-1")).toBe(0);
    expect(balance()).toBe(0);

    // The columns it is actually used for still work.
    await bulkUpdateTransactions(["p-1"], { cleared: 1 });
    expect(
      (db.prepare("SELECT cleared FROM transactions WHERE id = ?").get("p-1") as {
        cleared: number;
      }).cleared
    ).toBe(1);
  });
});
