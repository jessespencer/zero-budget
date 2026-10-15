import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { __resetCutoffCache } from "@/lib/balance";

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  // 260603-bdb: these tests pre-date the budget-cutoff gate and use 2026-04-15
  // (pre-cutoff under the default 2026-05-01) to verify balance arithmetic.
  // Lower the cutoff so the gate is effectively disabled for this suite —
  // the assertions here are about balance math, not the cutoff semantics
  // (which is covered by __tests__/unit/lib/balance.test.ts).
  db.prepare(
    `UPDATE app_settings SET value = '1900-01-01' WHERE key = 'budget_start_month'`
  ).run();
  __resetCutoffCache();

  // Seed a default account
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

describe("transaction actions", () => {
  it("createTransaction inserts transaction and updates account balance", async () => {
    const { createTransaction } = await import("@/app/(app)/transactions/actions");

    await createTransaction({
      date: "2026-04-15",
      payee: "Grocery Store",
      amount: -50,
      account_id: "acct-1",
    });

    const txns = db
      .prepare("SELECT * FROM transactions WHERE user_id = ?")
      .all(USER_ID) as Record<string, unknown>[];

    expect(txns).toHaveLength(1);
    expect(txns[0].payee).toBe("Grocery Store");
    expect(txns[0].amount).toBe(-50);

    const acct = db
      .prepare("SELECT current_balance FROM accounts WHERE id = ?")
      .get("acct-1") as { current_balance: number };

    expect(acct.current_balance).toBe(-50);
  });

  it("createTransaction upserts payee for auto-complete", async () => {
    const { createTransaction } = await import("@/app/(app)/transactions/actions");

    await createTransaction({
      date: "2026-04-15",
      payee: "Grocery Store",
      amount: -50,
      account_id: "acct-1",
    });

    const payee = db
      .prepare("SELECT name FROM payees WHERE user_id = ? AND name = ?")
      .get(USER_ID, "Grocery Store") as { name: string } | undefined;

    expect(payee).toBeDefined();
    expect(payee!.name).toBe("Grocery Store");
  });

  it("createTransaction auto-categorizes from learned payee", async () => {
    const { createTransaction } = await import("@/app/(app)/transactions/actions");

    // Seed a payee with a default category
    const groupId = "g-bills";
    db.prepare(
      "INSERT INTO category_groups (id, user_id, name, sort_order, is_income) VALUES (?, ?, ?, 0, 0)"
    ).run(groupId, USER_ID, "Bills");
    db.prepare(
      "INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived) VALUES (?, ?, ?, ?, 0, 0)"
    ).run("c-groceries", USER_ID, groupId, "Groceries");
    db.prepare(
      "INSERT INTO payees (id, user_id, name, default_category_id) VALUES (?, ?, ?, ?)"
    ).run("p-1", USER_ID, "Grocery Store", "c-groceries");

    await createTransaction({
      date: "2026-04-15",
      payee: "Grocery Store",
      amount: -50,
      account_id: "acct-1",
    });

    const txn = db
      .prepare("SELECT category_id FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(USER_ID) as { category_id: string | null };

    expect(txn.category_id).toBe("c-groceries");
  });

  it("createTransaction auto-creates income category for positive amounts", async () => {
    const { createTransaction } = await import("@/app/(app)/transactions/actions");

    await createTransaction({
      date: "2026-04-01",
      payee: "Employer",
      amount: 5000,
      account_id: "acct-1",
    });

    const txn = db
      .prepare("SELECT category_id FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(USER_ID) as { category_id: string | null };

    expect(txn.category_id).not.toBeNull();

    // Verify it's an income category
    const cat = db
      .prepare("SELECT category_group_id FROM categories WHERE id = ?")
      .get(txn.category_id!) as { category_group_id: string };
    const group = db
      .prepare("SELECT is_income FROM category_groups WHERE id = ?")
      .get(cat.category_group_id) as { is_income: number };

    expect(group.is_income).toBe(1);
  });

  it("deleteTransaction reverses account balance", async () => {
    const { createTransaction, deleteTransaction } = await import("@/app/(app)/transactions/actions");

    await createTransaction({
      date: "2026-04-15",
      payee: "Store",
      amount: -100,
      account_id: "acct-1",
    });

    const txn = db
      .prepare("SELECT id FROM transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as { id: string };

    await deleteTransaction(txn.id);

    const acct = db
      .prepare("SELECT current_balance FROM accounts WHERE id = ?")
      .get("acct-1") as { current_balance: number };

    expect(acct.current_balance).toBe(0);

    const remaining = db
      .prepare("SELECT COUNT(*) as count FROM transactions WHERE user_id = ?")
      .get(USER_ID) as { count: number };

    expect(remaining.count).toBe(0);
  });

  it("updateTransaction adjusts account balance on amount change", async () => {
    const { createTransaction, updateTransaction } = await import("@/app/(app)/transactions/actions");

    await createTransaction({
      date: "2026-04-15",
      payee: "Store",
      amount: -100,
      account_id: "acct-1",
    });

    const txn = db
      .prepare("SELECT id FROM transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as { id: string };

    await updateTransaction(txn.id, { amount: -150 });

    const acct = db
      .prepare("SELECT current_balance FROM accounts WHERE id = ?")
      .get("acct-1") as { current_balance: number };

    // Was -100, now -150, so balance adjusted by -50
    expect(acct.current_balance).toBe(-150);
  });

  it("updateTransaction moves balance between accounts on account change", async () => {
    const { createTransaction, updateTransaction } = await import("@/app/(app)/transactions/actions");

    // Seed a second account
    db.prepare(
      `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
       VALUES (?, ?, ?, ?, 1, 0, 1, 0)`
    ).run("acct-2", USER_ID, "Savings", "savings");

    await createTransaction({
      date: "2026-04-15",
      payee: "Store",
      amount: -100,
      account_id: "acct-1",
    });

    const txn = db
      .prepare("SELECT id FROM transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as { id: string };

    await updateTransaction(txn.id, { account_id: "acct-2" });

    const acct1 = db.prepare("SELECT current_balance FROM accounts WHERE id = ?").get("acct-1") as { current_balance: number };
    const acct2 = db.prepare("SELECT current_balance FROM accounts WHERE id = ?").get("acct-2") as { current_balance: number };

    expect(acct1.current_balance).toBe(0); // reversed
    expect(acct2.current_balance).toBe(-100); // applied
  });

  it("getTransactions returns transactions with joined names", async () => {
    const { createTransaction, getTransactions } = await import("@/app/(app)/transactions/actions");

    await createTransaction({
      date: "2026-04-15",
      payee: "Store",
      amount: -50,
      account_id: "acct-1",
    });

    const txns = await getTransactions();

    expect(txns).toHaveLength(1);
    expect(txns[0].account_name).toBe("Checking");
    expect(txns[0].payee).toBe("Store");
  });

  it("getTransactions filters by account", async () => {
    const { createTransaction, getTransactions } = await import("@/app/(app)/transactions/actions");

    db.prepare(
      `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
       VALUES (?, ?, ?, ?, 1, 0, 1, 0)`
    ).run("acct-2", USER_ID, "Savings", "savings");

    await createTransaction({ date: "2026-04-15", payee: "A", amount: -10, account_id: "acct-1" });
    await createTransaction({ date: "2026-04-15", payee: "B", amount: -20, account_id: "acct-2" });

    const filtered = await getTransactions({ accountId: "acct-1" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].payee).toBe("A");
  });

  it("getTransactions filters by search text", async () => {
    const { createTransaction, getTransactions } = await import("@/app/(app)/transactions/actions");

    await createTransaction({ date: "2026-04-15", payee: "Grocery Store", amount: -50, account_id: "acct-1" });
    await createTransaction({ date: "2026-04-15", payee: "Gas Station", amount: -30, account_id: "acct-1" });

    const result = await getTransactions({ search: "Grocery" });
    expect(result).toHaveLength(1);
    expect(result[0].payee).toBe("Grocery Store");
  });

  it("findDuplicates detects matching transactions", async () => {
    const { createTransaction, findDuplicates } = await import("@/app/(app)/transactions/actions");

    await createTransaction({ date: "2026-04-15", payee: "Store", amount: -50, account_id: "acct-1" });

    const dupes = await findDuplicates("acct-1", [
      { date: "2026-04-15", payee: "Store", amount: -50 },
      { date: "2026-04-16", payee: "Other", amount: -30 },
    ]);

    expect(dupes).toEqual([0]); // first item is a duplicate
  });

  it("findDuplicates matches on (date, amount) regardless of payee string", async () => {
    // The stored payee gets normalized by createTransaction (e.g. "KING SOOPERS
    // #0062" → "King Soopers"), so a re-imported CSV row with the raw bank
    // description must still flag as a duplicate.
    const { createTransaction, findDuplicates } = await import("@/app/(app)/transactions/actions");

    await createTransaction({ date: "2026-04-15", payee: "King Soopers", amount: -56.5, account_id: "acct-1" });

    const dupes = await findDuplicates("acct-1", [
      { date: "2026-04-15", payee: "KING SOOPERS #0062", amount: -56.5 },
      { date: "2026-04-15", payee: "Unrelated", amount: -1.23 },
    ]);

    expect(dupes).toEqual([0]);
  });

  it("ensureIncomeCategory returns the seeded Ready to assign category", async () => {
    const { ensureIncomeCategory } = await import("@/app/(app)/transactions/actions");
    const { READY_TO_ASSIGN_CATEGORY_ID } = await import("@/lib/db");

    const catId = await ensureIncomeCategory();

    expect(catId).toBe(READY_TO_ASSIGN_CATEGORY_ID);

    // The seeded category lives in the system Inflow group, marked as income.
    const cat = db
      .prepare("SELECT name, category_group_id FROM categories WHERE id = ?")
      .get(catId) as { name: string; category_group_id: string };
    expect(cat.name).toBe("Ready to assign");

    const group = db
      .prepare("SELECT name, is_income, is_system FROM category_groups WHERE id = ?")
      .get(cat.category_group_id) as { name: string; is_income: number; is_system: number };
    expect(group.name).toBe("Inflow");
    expect(group.is_income).toBe(1);
    expect(group.is_system).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Transfer pair cascade (task 260518-fqy) — every mutation on one leg of a
  // transfer pair must propagate to the implicit sibling leg so the pair
  // stays atomic. No `pair_id` column; the finder uses (date, mirrored
  // amount, swapped account refs) on the existing schema.
  // -------------------------------------------------------------------------

  describe("transfer pair cascade", () => {
    type TxnRow = {
      id: string;
      account_id: string;
      transfer_account_id: string | null;
      amount: number;
      date: string;
      payee: string | null;
      memo: string | null;
      updated_at: string;
    };

    beforeEach(() => {
      // Outer beforeEach seeds acct-1 ("Checking"). We need a destination
      // savings account for every case + a third account for case 8 (account
      // change). Insert here rather than per-test so the fixture stays terse.
      db.prepare(
        `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
         VALUES (?, ?, ?, ?, 1, 0, 1, 0)`
      ).run("acct-2", USER_ID, "Savings", "savings");
      db.prepare(
        `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
         VALUES (?, ?, ?, ?, 1, 0, 2, 0)`
      ).run("acct-3", USER_ID, "Backup", "checking");
    });

    async function makePair(
      fromId = "acct-1",
      toId = "acct-2",
      amount = 100,
      date = "2026-05-15"
    ) {
      const { createTransferPairWithSnapshot } = await import(
        "@/app/(app)/transfer-plan/actions"
      );
      return createTransferPairWithSnapshot({
        fromAccountId: fromId,
        toAccountId: toId,
        amount,
        date,
      });
    }

    function getTxn(id: string): TxnRow | undefined {
      return db
        .prepare(
          `SELECT id, account_id, transfer_account_id, amount, date, payee, memo, updated_at
             FROM transactions WHERE id = ? AND user_id = ?`
        )
        .get(id, USER_ID) as TxnRow | undefined;
    }

    function getBalance(accountId: string): number {
      const row = db
        .prepare("SELECT current_balance FROM accounts WHERE id = ?")
        .get(accountId) as { current_balance: number };
      return Number(row.current_balance);
    }

    function txnCount(): number {
      const row = db
        .prepare("SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?")
        .get(USER_ID) as { count: number };
      return row.count;
    }

    it("case 1: deleteTransaction(outflowId) cascades to sibling and both balances revert", async () => {
      const { deleteTransaction } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();

      expect(getBalance("acct-1")).toBe(-100);
      expect(getBalance("acct-2")).toBe(100);
      expect(txnCount()).toBe(2);

      await deleteTransaction(pair.outflowTxnId);

      expect(txnCount()).toBe(0);
      expect(getBalance("acct-1")).toBe(0);
      expect(getBalance("acct-2")).toBe(0);
    });

    it("case 2: deleteTransactionWithSnapshot returns 2 snapshots; restore reinserts both legs and balances", async () => {
      const {
        deleteTransactionWithSnapshot,
        restoreTransactionSnapshots,
      } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();

      const snapshots = await deleteTransactionWithSnapshot(pair.outflowTxnId);

      expect(snapshots).toHaveLength(2);
      expect(txnCount()).toBe(0);
      expect(getBalance("acct-1")).toBe(0);
      expect(getBalance("acct-2")).toBe(0);

      await restoreTransactionSnapshots(snapshots);

      expect(txnCount()).toBe(2);
      expect(getBalance("acct-1")).toBe(-100);
      expect(getBalance("acct-2")).toBe(100);
      // Both originals re-inserted at their original ids
      expect(getTxn(pair.outflowTxnId)).toBeDefined();
      expect(getTxn(pair.inflowTxnId)).toBeDefined();
    });

    it("case 3: bulkDeleteTransactionsWithSnapshot([outflowId]) auto-expands to sibling", async () => {
      const { bulkDeleteTransactionsWithSnapshot } = await import(
        "@/app/(app)/transactions/actions"
      );
      const pair = await makePair();

      const snapshots = await bulkDeleteTransactionsWithSnapshot([
        pair.outflowTxnId,
      ]);

      expect(snapshots).toHaveLength(2);
      expect(txnCount()).toBe(0);
      expect(getBalance("acct-1")).toBe(0);
      expect(getBalance("acct-2")).toBe(0);
    });

    it("case 4: bulkDeleteTransactionsWithSnapshot([outflow, inflow]) dedupes — no double reverse", async () => {
      const { bulkDeleteTransactionsWithSnapshot } = await import(
        "@/app/(app)/transactions/actions"
      );
      const pair = await makePair();

      const snapshots = await bulkDeleteTransactionsWithSnapshot([
        pair.outflowTxnId,
        pair.inflowTxnId,
      ]);

      // 2 — not 3 or 4 — even though sibling cascade re-encounters both ids
      expect(snapshots).toHaveLength(2);
      expect(txnCount()).toBe(0);
      expect(getBalance("acct-1")).toBe(0);
      expect(getBalance("acct-2")).toBe(0);
    });

    it("case 5: broken mirror — deleteTransaction silently no-ops on cascade", async () => {
      const { deleteTransaction } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();

      // Break the sign mirror on the outflow so the finder can't pair them
      db.prepare(
        "UPDATE transactions SET amount = ? WHERE id = ? AND user_id = ?"
      ).run(-999, pair.outflowTxnId, USER_ID);

      // Deleting the inflow should remove only the inflow — outflow is now
      // orphaned (broken mirror) and the cascade must not throw.
      await expect(deleteTransaction(pair.inflowTxnId)).resolves.toBeUndefined();

      expect(txnCount()).toBe(1);
      expect(getTxn(pair.outflowTxnId)).toBeDefined();
      expect(getTxn(pair.inflowTxnId)).toBeUndefined();
    });

    it("case 6: updateTransaction({ amount }) mirrors sign-flipped to sibling and adjusts both balances", async () => {
      const { updateTransaction } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();
      const originalSiblingUpdatedAt = getTxn(pair.inflowTxnId)!.updated_at;

      // Sleep a beat so updated_at can change observably (now() has sub-second
      // precision; we just need the comparison to be reliable).
      await new Promise((r) => setTimeout(r, 5));

      await updateTransaction(pair.outflowTxnId, { amount: -150 });

      const sibling = getTxn(pair.inflowTxnId)!;
      expect(sibling.amount).toBe(150); // sign-flipped from -150
      expect(getBalance("acct-1")).toBe(-150);
      expect(getBalance("acct-2")).toBe(150);
      expect(sibling.updated_at).not.toBe(originalSiblingUpdatedAt);
    });

    it("case 7: updateTransaction({ date }) mirrors date to sibling; amounts/balances unchanged", async () => {
      const { updateTransaction } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();
      const originalSiblingUpdatedAt = getTxn(pair.inflowTxnId)!.updated_at;

      await new Promise((r) => setTimeout(r, 5));
      await updateTransaction(pair.outflowTxnId, { date: "2026-05-01" });

      const sibling = getTxn(pair.inflowTxnId)!;
      expect(sibling.date).toBe("2026-05-01");
      expect(sibling.amount).toBe(100); // unchanged
      expect(getBalance("acct-1")).toBe(-100);
      expect(getBalance("acct-2")).toBe(100);
      expect(sibling.updated_at).not.toBe(originalSiblingUpdatedAt);
    });

    it("case 8: updateTransaction({ account_id }) swaps sibling.transfer_account_id and re-routes balance", async () => {
      const { updateTransaction } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();
      const originalSiblingUpdatedAt = getTxn(pair.inflowTxnId)!.updated_at;

      await new Promise((r) => setTimeout(r, 5));
      await updateTransaction(pair.outflowTxnId, { account_id: "acct-3" });

      const sibling = getTxn(pair.inflowTxnId)!;
      // Sibling stays on acct-2; only its back-pointer (transfer_account_id)
      // moves to acct-3 to match the parent's new home.
      expect(sibling.account_id).toBe("acct-2");
      expect(sibling.transfer_account_id).toBe("acct-3");
      // Parent moved: acct-1 reversed back to 0, acct-3 picked up the -100
      expect(getBalance("acct-1")).toBe(0);
      expect(getBalance("acct-3")).toBe(-100);
      expect(getBalance("acct-2")).toBe(100); // unchanged
      expect(sibling.updated_at).not.toBe(originalSiblingUpdatedAt);
      // Canonical payee tracks the parent's new account: "Transfer from Checking"
      // → "Transfer from Backup" (260518-fqy #8).
      expect(sibling.payee).toBe("Transfer from Backup");
    });

    it("case 9: updateTransaction({ memo }) mirrors memo to sibling", async () => {
      const { updateTransaction } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();
      const originalSiblingUpdatedAt = getTxn(pair.inflowTxnId)!.updated_at;

      await new Promise((r) => setTimeout(r, 5));
      await updateTransaction(pair.outflowTxnId, { memo: "rent transfer" });

      const sibling = getTxn(pair.inflowTxnId)!;
      expect(sibling.memo).toBe("rent transfer");
      expect(sibling.updated_at).not.toBe(originalSiblingUpdatedAt);
    });

    it("case 10: updateTransaction({ payee }) does NOT propagate to sibling — asymmetric labels preserved", async () => {
      const { updateTransaction } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();

      await updateTransaction(pair.outflowTxnId, { payee: "custom payee" });

      const primary = getTxn(pair.outflowTxnId)!;
      const sibling = getTxn(pair.inflowTxnId)!;
      expect(primary.payee).toBe("custom payee");
      // Sibling keeps the original "Transfer from Checking" label (the
      // fixture's source account is named "Checking" — set in the outer
      // beforeEach).
      expect(sibling.payee).toBe("Transfer from Checking");
    });

    it("case 11: account change preserves user-customized sibling payee", async () => {
      const { updateTransaction } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();

      // User customized the sibling's payee to a non-canonical string. The
      // account-change cascade must leave it alone (260518-fqy #8 guard).
      await updateTransaction(pair.inflowTxnId, { payee: "Rent reimbursement" });

      await updateTransaction(pair.outflowTxnId, { account_id: "acct-3" });

      const sibling = getTxn(pair.inflowTxnId)!;
      expect(sibling.transfer_account_id).toBe("acct-3");
      // Payee untouched — it's no longer canonical, so the rewrite skipped it.
      expect(sibling.payee).toBe("Rent reimbursement");
    });

    it("case 12: editing the inflow's account_id rewrites the outflow's 'Transfer to <name>' payee", async () => {
      const { updateTransaction } = await import("@/app/(app)/transactions/actions");
      const pair = await makePair();

      // Edit the inflow side this time. The "parent" for cascade purposes is
      // the inflow on acct-2 ("Savings"); its sibling is the outflow on acct-1
      // with payee "Transfer to Savings". Move the inflow Savings → Backup.
      await updateTransaction(pair.inflowTxnId, { account_id: "acct-3" });

      const sibling = getTxn(pair.outflowTxnId)!;
      expect(sibling.transfer_account_id).toBe("acct-3");
      // Canonical payee on the outflow tracks the inflow's new home.
      expect(sibling.payee).toBe("Transfer to Backup");
    });

    it("case 13: updateTransferPairWithSnapshot changes amount on both legs + balances", async () => {
      const { updateTransferPairWithSnapshot } = await import(
        "@/app/(app)/transfer-plan/actions"
      );
      const pair = await makePair(); // acct-1 -> acct-2, 100

      await updateTransferPairWithSnapshot({
        txnId: pair.outflowTxnId,
        fromAccountId: "acct-1",
        toAccountId: "acct-2",
        amount: 150,
        date: "2026-05-15",
      });

      // Both legs updated in place — no orphan created.
      expect(txnCount()).toBe(2);
      expect(getTxn(pair.outflowTxnId)!.amount).toBe(-150);
      expect(getTxn(pair.inflowTxnId)!.amount).toBe(150);
      expect(getBalance("acct-1")).toBe(-150);
      expect(getBalance("acct-2")).toBe(150);
    });

    it("case 14: undo/redo of a transfer edit restores then re-applies amount + balances", async () => {
      const {
        updateTransferPairWithSnapshot,
        undoTransferPairEdit,
        redoTransferPairEdit,
      } = await import("@/app/(app)/transfer-plan/actions");
      const pair = await makePair();

      const snap = await updateTransferPairWithSnapshot({
        txnId: pair.outflowTxnId,
        fromAccountId: "acct-1",
        toAccountId: "acct-2",
        amount: 150,
        date: "2026-05-15",
      });

      await undoTransferPairEdit(snap);
      expect(getTxn(pair.outflowTxnId)!.amount).toBe(-100);
      expect(getBalance("acct-1")).toBe(-100);
      expect(getBalance("acct-2")).toBe(100);

      await redoTransferPairEdit(snap);
      expect(getTxn(pair.outflowTxnId)!.amount).toBe(-150);
      expect(getBalance("acct-1")).toBe(-150);
      expect(getBalance("acct-2")).toBe(150);
    });

    it("case 15: editing via the inflow leg re-points accounts, rewrites payees, and moves balances", async () => {
      const { updateTransferPairWithSnapshot } = await import(
        "@/app/(app)/transfer-plan/actions"
      );
      const pair = await makePair(); // acct-1 -> acct-2, 100

      // Pass the inflow leg id; the sibling is resolved server-side. Re-point to
      // acct-1 -> acct-3 ("Backup"), change amount and date.
      await updateTransferPairWithSnapshot({
        txnId: pair.inflowTxnId,
        fromAccountId: "acct-1",
        toAccountId: "acct-3",
        amount: 200,
        date: "2026-06-01",
      });

      // acct-2 fully reversed; new legs land on acct-1 / acct-3.
      expect(getBalance("acct-1")).toBe(-200);
      expect(getBalance("acct-2")).toBe(0);
      expect(getBalance("acct-3")).toBe(200);

      const out = getTxn(pair.outflowTxnId)!; // always the from-side leg
      const inf = getTxn(pair.inflowTxnId)!; // always the to-side leg
      expect(out.account_id).toBe("acct-1");
      expect(out.amount).toBe(-200);
      expect(out.transfer_account_id).toBe("acct-3");
      expect(out.payee).toBe("Transfer to Backup");
      expect(out.date).toBe("2026-06-01");
      expect(inf.account_id).toBe("acct-3");
      expect(inf.amount).toBe(200);
      expect(inf.transfer_account_id).toBe("acct-1");
      expect(inf.payee).toBe("Transfer from Checking");
      expect(inf.date).toBe("2026-06-01");
    });
  });

  describe("post pending transactions", () => {
    // Insert a pending row the way import-txns build-sql.mjs does: approved=0
    // and the amount deliberately held OUT of current_balance.
    function insertPending(id: string, amount: number, date = "2026-04-15") {
      db.prepare(
        `INSERT INTO transactions (id, user_id, date, payee, amount, account_id, approved, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'acct-1', 0, 'desktop', ?, ?)`
      ).run(id, USER_ID, date, "Pending payee", amount, "2026-04-15", "2026-04-15");
    }

    function balance(): number {
      return (
        db.prepare("SELECT current_balance FROM accounts WHERE id = ?").get("acct-1") as {
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

    it("posting applies the held amount to the balance and flips approved=1", async () => {
      const { postPendingTransactionsWithSnapshot } = await import(
        "@/app/(app)/transactions/actions"
      );
      insertPending("p-1", -74.64);
      expect(balance()).toBe(0); // held out at insert

      const snapshot = await postPendingTransactionsWithSnapshot(["p-1"]);

      expect(snapshot).toHaveLength(1);
      expect(balance()).toBeCloseTo(-74.64, 2);
      expect(approvedOf("p-1")).toBe(1);
    });

    it("undo reverses the balance and restores approved=0", async () => {
      const { postPendingTransactionsWithSnapshot, unpostPendingTransactions } =
        await import("@/app/(app)/transactions/actions");
      insertPending("p-1", -74.64);

      const snapshot = await postPendingTransactionsWithSnapshot(["p-1"]);
      expect(balance()).toBeCloseTo(-74.64, 2);

      await unpostPendingTransactions(snapshot);

      expect(balance()).toBe(0);
      expect(approvedOf("p-1")).toBe(0);
    });

    it("only posts the pending rows in a mixed selection", async () => {
      const { postPendingTransactionsWithSnapshot } = await import(
        "@/app/(app)/transactions/actions"
      );
      insertPending("p-1", -10);
      // An already-posted row (approved=1) whose amount IS already in balance.
      db.prepare(
        `INSERT INTO transactions (id, user_id, date, payee, amount, account_id, approved, source, created_at, updated_at)
         VALUES ('a-1', ?, '2026-04-15', 'Posted', -100, 'acct-1', 1, 'desktop', '2026-04-15', '2026-04-15')`
      ).run(USER_ID);
      db.prepare(
        `UPDATE accounts SET current_balance = -100 WHERE id = 'acct-1'`
      ).run();

      const snapshot = await postPendingTransactionsWithSnapshot(["p-1", "a-1"]);

      // Only p-1 was pending; a-1 must not be double-applied.
      expect(snapshot.map((r) => r.id)).toEqual(["p-1"]);
      expect(balance()).toBeCloseTo(-110, 2);
    });

    it("is idempotent — re-posting an already-posted row is a no-op", async () => {
      const { postPendingTransactionsWithSnapshot } = await import(
        "@/app/(app)/transactions/actions"
      );
      insertPending("p-1", -25);

      await postPendingTransactionsWithSnapshot(["p-1"]);
      expect(balance()).toBeCloseTo(-25, 2);

      // Second call finds no approved=0 rows → nothing posted, balance unchanged.
      const second = await postPendingTransactionsWithSnapshot(["p-1"]);
      expect(second).toHaveLength(0);
      expect(balance()).toBeCloseTo(-25, 2);
    });

    it("respects the cutoff gate — a pre-cutoff pending row flips approved but does not move the balance", async () => {
      const { postPendingTransactionsWithSnapshot } = await import(
        "@/app/(app)/transactions/actions"
      );
      db.prepare(
        `UPDATE app_settings SET value = '2026-05-01' WHERE key = 'budget_start_month'`
      ).run();
      __resetCutoffCache();

      insertPending("p-1", -74.64, "2026-04-15"); // before cutoff
      await postPendingTransactionsWithSnapshot(["p-1"]);

      expect(approvedOf("p-1")).toBe(1); // still posted
      expect(balance()).toBe(0); // but held out — pre-cutoff never moves the live balance
    });
  });

  describe("duplicateTransactions", () => {
    function balance(): number {
      return (
        db.prepare("SELECT current_balance FROM accounts WHERE id = ?").get("acct-1") as {
          current_balance: number;
        }
      ).current_balance;
    }

    it("copies the original verbatim — date, flags, and splits", async () => {
      const { duplicateTransactions } = await import(
        "@/app/(app)/transactions/actions"
      );

      db.prepare(
        `INSERT INTO transactions (id, user_id, date, payee, memo, amount, account_id, cleared, approved, is_split_parent, source, created_at, updated_at)
         VALUES ('t-1', ?, '2026-04-15', 'Costco', 'weekly run', -120, 'acct-1', 1, 1, 1, 'desktop', ?, ?)`
      ).run(USER_ID, "2026-04-15", "2026-04-15");
      db.prepare(
        `INSERT INTO transaction_splits (id, parent_transaction_id, category_id, amount, memo, created_at, updated_at)
         VALUES ('s-1', 't-1', NULL, -80, 'groceries', ?, ?), ('s-2', 't-1', NULL, -40, 'household', ?, ?)`
      ).run("2026-04-15", "2026-04-15", "2026-04-15", "2026-04-15");

      const [dupId] = await duplicateTransactions(["t-1"]);

      const dup = db
        .prepare("SELECT * FROM transactions WHERE id = ?")
        .get(dupId) as Record<string, unknown>;

      // The date is the point: forcing today's date would move the copy into
      // whatever month is current, which matters under envelope budgeting.
      expect(dup.date).toBe("2026-04-15");
      expect(dup.approved).toBe(1); // not shunted into Pending
      expect(dup.cleared).toBe(1);
      expect(dup.is_split_parent).toBe(1);
      expect(dup.amount).toBe(-120);

      // Splits come along instead of being flattened into one uncategorized
      // row carrying the parent's full amount.
      const splits = db
        .prepare(
          "SELECT amount, memo FROM transaction_splits WHERE parent_transaction_id = ? ORDER BY amount DESC"
        )
        .all(dupId) as { amount: number; memo: string }[];
      expect(splits).toEqual([
        { amount: -40, memo: "household" },
        { amount: -80, memo: "groceries" },
      ]);
    });

    it("holds a pending copy out of the balance until it is approved", async () => {
      const { duplicateTransactions, postPendingTransactionsWithSnapshot } =
        await import("@/app/(app)/transactions/actions");

      // A pending row, inserted the way import-txns does — amount held OUT of
      // current_balance until it is posted.
      db.prepare(
        `INSERT INTO transactions (id, user_id, date, payee, amount, account_id, approved, source, created_at, updated_at)
         VALUES ('p-1', ?, '2026-04-15', 'Rent', -100, 'acct-1', 0, 'desktop', ?, ?)`
      ).run(USER_ID, "2026-04-15", "2026-04-15");
      expect(balance()).toBe(0);

      const [dupId] = await duplicateTransactions(["p-1"]);
      expect(
        (db.prepare("SELECT approved FROM transactions WHERE id = ?").get(dupId) as {
          approved: number;
        }).approved
      ).toBe(0);

      // The copy is still Pending, so its amount must stay out of the balance.
      // Applying it here would double-count: posting applies it again below.
      expect(balance()).toBe(0);

      await postPendingTransactionsWithSnapshot(["p-1", dupId]);

      // Two pending rows of -100, approved once each. -300 here would mean the
      // copy's amount was applied at duplicate time and again at approve time.
      expect(balance()).toBe(-200);
    });
  });

  // F10: payee mutations must be scoped by user_id like every other write in
  // the file. Single-user today, but an unscoped DELETE/UPDATE is a live
  // divergence — these seed a second user's payee and assert it's untouched.
  describe("payee mutations are scoped by user_id", () => {
    const OTHER_USER = "11111111-1111-1111-1111-111111111111";

    const seedOtherPayee = (id: string, name: string) =>
      db
        .prepare(
          `INSERT INTO payees (id, user_id, name, default_category_id) VALUES (?, ?, ?, NULL)`
        )
        .run(id, OTHER_USER, name);

    it("deletePayee leaves a payee that belongs to another user", async () => {
      const { deletePayee } = await import("@/app/(app)/transactions/actions");
      seedOtherPayee("p-other", "Costco");

      await deletePayee("p-other");

      const still = db.prepare("SELECT id FROM payees WHERE id = ?").get("p-other");
      expect(still).toBeDefined();
    });

    it("deletePayees leaves payees that belong to another user", async () => {
      const { deletePayees } = await import("@/app/(app)/transactions/actions");
      seedOtherPayee("p-a", "Costco");
      seedOtherPayee("p-b", "Target");

      await deletePayees(["p-a", "p-b"]);

      const remaining = db
        .prepare("SELECT id FROM payees WHERE user_id = ?")
        .all(OTHER_USER);
      expect(remaining).toHaveLength(2);
    });

    it("updatePayee leaves a payee that belongs to another user unchanged", async () => {
      const { updatePayee } = await import("@/app/(app)/transactions/actions");
      seedOtherPayee("p-other", "Costco");

      await updatePayee("p-other", { name: "Renamed" });

      const row = db
        .prepare("SELECT name FROM payees WHERE id = ?")
        .get("p-other") as { name: string };
      expect(row.name).toBe("Costco");
    });
  });
});
