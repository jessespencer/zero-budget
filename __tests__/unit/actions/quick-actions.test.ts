import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { __resetCutoffCache } from "@/lib/balance";

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);

  // /quick wrappers stamp today's date via `new Date().toISOString()`. To keep
  // tests deterministic regardless of when they run, push the cutoff to
  // 1900-01-01 so balance writes are not gated by today's relationship to
  // app_settings.budget_start_month. The cutoff semantics are exercised by
  // __tests__/unit/lib/balance.test.ts.
  db.prepare(
    `UPDATE app_settings SET value = '1900-01-01' WHERE key = 'budget_start_month'`
  ).run();
  __resetCutoffCache();

  // Seed accounts: one checking + one savings (used by transfer tests).
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 1, 0, 0, 0)`
  ).run("acct-1", USER_ID, "Checking", "checking");
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 1, 0, 1, 0)`
  ).run("acct-2", USER_ID, "Savings", "savings");

  // Seed one expense group + one income group, each with three categories so
  // the priority-chain tests have something to pin / use / pad from.
  db.prepare(
    `INSERT INTO category_groups (id, user_id, name, sort_order, is_income, is_system) VALUES (?, ?, ?, 0, 0, 0)`
  ).run("grp-spend", USER_ID, "Spending");
  db.prepare(
    `INSERT INTO category_groups (id, user_id, name, sort_order, is_income, is_system) VALUES (?, ?, ?, 1, 1, 0)`
  ).run("grp-income", USER_ID, "Income");

  const expenseRows: [string, string, number][] = [
    ["cat-groceries", "Groceries", 0],
    ["cat-dining", "Dining out", 1],
    ["cat-gas", "Gas", 2],
    ["cat-rent", "Rent", 3],
  ];
  for (const [id, name, order] of expenseRows) {
    db.prepare(
      `INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived, pinned_quick) VALUES (?, ?, ?, ?, ?, 0, 0)`
    ).run(id, USER_ID, "grp-spend", name, order);
  }

  const incomeRows: [string, string, number][] = [
    ["cat-salary", "Salary", 0],
    ["cat-side", "Side income", 1],
    ["cat-gift", "Gifts received", 2],
  ];
  for (const [id, name, order] of incomeRows) {
    db.prepare(
      `INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived, pinned_quick) VALUES (?, ?, ?, ?, ?, 0, 0)`
    ).run(id, USER_ID, "grp-income", name, order);
  }
});

afterEach(() => {
  clearTestDb();
  __resetCutoffCache();
  db.close();
});

function getTxn(id: string) {
  return db
    .prepare(
      `SELECT id, account_id, transfer_account_id, amount, payee, memo, category_id,
              is_split_parent, source, date
         FROM transactions WHERE id = ? AND user_id = ?`
    )
    .get(id, USER_ID) as
    | {
        id: string;
        account_id: string;
        transfer_account_id: string | null;
        amount: number;
        payee: string | null;
        memo: string | null;
        category_id: string | null;
        is_split_parent: number;
        source: string | null;
        date: string;
      }
    | undefined;
}

function getBalance(accountId: string): number {
  const row = db
    .prepare("SELECT current_balance FROM accounts WHERE id = ?")
    .get(accountId) as { current_balance: number };
  return Number(row.current_balance);
}

function getSplits(parentId: string) {
  return db
    .prepare(
      `SELECT category_id, amount FROM transaction_splits
        WHERE parent_transaction_id = ?
        ORDER BY created_at ASC`
    )
    .all(parentId) as { category_id: string; amount: number }[];
}

describe("createQuickTransaction", () => {
  it("stamps source = 'quick' on the new transaction", async () => {
    const { createQuickTransaction } = await import("@/app/(app)/transactions/actions");

    const txn = await createQuickTransaction({
      amount: -25,
      account_id: "acct-1",
      category_id: "cat-groceries",
      payee: "Trader Joe's",
    });

    const stored = getTxn(txn.id)!;
    expect(stored.source).toBe("quick");
    expect(stored.amount).toBe(-25);
    expect(stored.category_id).toBe("cat-groceries");
    expect(stored.payee).toBe("Trader Joe's");
    expect(stored.account_id).toBe("acct-1");
  });

  it("dates the transaction today", async () => {
    const { createQuickTransaction } = await import("@/app/(app)/transactions/actions");

    const txn = await createQuickTransaction({
      amount: -10,
      account_id: "acct-1",
      category_id: "cat-groceries",
    });

    const today = new Date().toISOString().slice(0, 10);
    const stored = getTxn(txn.id)!;
    expect(stored.date).toBe(today);
  });

  it("trims the payee", async () => {
    const { createQuickTransaction } = await import("@/app/(app)/transactions/actions");

    const txn = await createQuickTransaction({
      amount: -10,
      account_id: "acct-1",
      category_id: "cat-groceries",
      payee: "  Trader Joe's  ",
    });

    expect(getTxn(txn.id)!.payee).toBe("Trader Joe's");
  });

  it("collapses missing payee to empty string (no payee learning)", async () => {
    const { createQuickTransaction } = await import("@/app/(app)/transactions/actions");

    const txn = await createQuickTransaction({
      amount: -10,
      account_id: "acct-1",
      category_id: "cat-groceries",
    });

    expect(getTxn(txn.id)!.payee).toBe("");

    const payeeCount = (
      db.prepare("SELECT COUNT(*) AS n FROM payees WHERE user_id = ?").get(USER_ID) as {
        n: number;
      }
    ).n;
    expect(payeeCount).toBe(0);
  });

  it("moves the account balance by the signed amount", async () => {
    const { createQuickTransaction } = await import("@/app/(app)/transactions/actions");

    await createQuickTransaction({
      amount: -25,
      account_id: "acct-1",
      category_id: "cat-groceries",
    });
    expect(getBalance("acct-1")).toBe(-25);

    await createQuickTransaction({
      amount: 100,
      account_id: "acct-1",
      category_id: "cat-salary",
    });
    expect(getBalance("acct-1")).toBe(75);
  });

  it("persists the memo when provided", async () => {
    const { createQuickTransaction } = await import("@/app/(app)/transactions/actions");

    const txn = await createQuickTransaction({
      amount: -10,
      account_id: "acct-1",
      category_id: "cat-groceries",
      memo: "Birthday dinner",
    });

    expect(getTxn(txn.id)!.memo).toBe("Birthday dinner");
  });
});

describe("createQuickSplitTransaction", () => {
  it("returns ok:false too_few_splits when fewer than 2 splits are supplied", async () => {
    const { createQuickSplitTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const result = await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      splits: [{ category_id: "cat-groceries", amount: -50 }],
    });

    expect(result).toEqual({ ok: false, error: "too_few_splits" });
  });

  it("returns ok:false sum_mismatch with got+expected when splits don't total", async () => {
    const { createQuickSplitTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const result = await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -19.99 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: "sum_mismatch",
      got: -49.99,
      expected: -50,
    });
  });

  it("does not write anything on a sum_mismatch result (no parent txn, balance unchanged)", async () => {
    const { createQuickSplitTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const before = getBalance("acct-1");
    await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -19.99 },
      ],
    });

    expect(getBalance("acct-1")).toBe(before);
    const txnCount = (
      db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?").get(USER_ID) as {
        n: number;
      }
    ).n;
    expect(txnCount).toBe(0);
  });

  it("creates a parent transaction stamped source='quick' with no category_id", async () => {
    const { createQuickSplitTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const result = await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      payee: "Costco",
      memo: "weekly run",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -20 },
      ],
    });

    if (!result.ok) throw new Error("expected ok result");
    const stored = getTxn(result.parent.id)!;
    expect(stored.source).toBe("quick");
    expect(stored.is_split_parent).toBe(1);
    expect(stored.category_id).toBeNull();
    expect(stored.amount).toBe(-50);
    expect(stored.payee).toBe("Costco");
    expect(stored.memo).toBe("weekly run");
  });

  it("inserts each split row with the supplied category + amount", async () => {
    const { createQuickSplitTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const result = await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -20 },
      ],
    });

    if (!result.ok) throw new Error("expected ok result");
    const splits = getSplits(result.parent.id);
    expect(splits).toHaveLength(2);
    expect(splits[0]).toEqual({ category_id: "cat-groceries", amount: -30 });
    expect(splits[1]).toEqual({ category_id: "cat-dining", amount: -20 });
  });

  it("moves the account balance by the signed total (not the splits sum)", async () => {
    const { createQuickSplitTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -20 },
      ],
    });

    expect(getBalance("acct-1")).toBe(-50);
  });
});

describe("createQuickTransfer", () => {
  it("creates an outflow + inflow leg, both stamped source='quick'", async () => {
    const { createQuickTransfer } = await import("@/app/(app)/transactions/actions");

    const snapshot = await createQuickTransfer({
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      amount: 100,
    });

    const out = getTxn(snapshot.outflowTxnId)!;
    const inflow = getTxn(snapshot.inflowTxnId)!;

    expect(out.source).toBe("quick");
    expect(inflow.source).toBe("quick");
    expect(out.amount).toBe(-100);
    expect(inflow.amount).toBe(100);
    expect(out.account_id).toBe("acct-1");
    expect(out.transfer_account_id).toBe("acct-2");
    expect(inflow.account_id).toBe("acct-2");
    expect(inflow.transfer_account_id).toBe("acct-1");
  });

  it("moves both balances atomically", async () => {
    const { createQuickTransfer } = await import("@/app/(app)/transactions/actions");

    await createQuickTransfer({
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      amount: 100,
    });

    expect(getBalance("acct-1")).toBe(-100);
    expect(getBalance("acct-2")).toBe(100);
  });

  it("defaults date to today when not specified", async () => {
    const { createQuickTransfer } = await import("@/app/(app)/transactions/actions");

    const snapshot = await createQuickTransfer({
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      amount: 100,
    });

    const today = new Date().toISOString().slice(0, 10);
    expect(getTxn(snapshot.outflowTxnId)!.date).toBe(today);
    expect(getTxn(snapshot.inflowTxnId)!.date).toBe(today);
  });

  it("respects an explicit date when supplied", async () => {
    const { createQuickTransfer } = await import("@/app/(app)/transactions/actions");

    const snapshot = await createQuickTransfer({
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      amount: 25,
      date: "2026-06-01",
    });

    expect(getTxn(snapshot.outflowTxnId)!.date).toBe("2026-06-01");
    expect(getTxn(snapshot.inflowTxnId)!.date).toBe("2026-06-01");
  });
});

describe("updateQuickTransaction", () => {
  it("performs a plain single-category edit (amount + payee + memo)", async () => {
    const { createQuickTransaction, updateQuickTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const txn = await createQuickTransaction({
      amount: -10,
      account_id: "acct-1",
      category_id: "cat-groceries",
      payee: "Old",
    });

    await updateQuickTransaction({
      id: txn.id,
      amount: -15,
      account_id: "acct-1",
      category_id: "cat-dining",
      payee: "New",
      memo: "moved",
      wasSplitParent: false,
    });

    const stored = getTxn(txn.id)!;
    expect(stored.amount).toBe(-15);
    expect(stored.category_id).toBe("cat-dining");
    expect(stored.payee).toBe("New");
    expect(stored.memo).toBe("moved");
    // Balance reconciled: -10 → -15 = additional -5
    expect(getBalance("acct-1")).toBe(-15);
  });

  it("promotes a single-category txn to a split parent", async () => {
    const { createQuickTransaction, updateQuickTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const txn = await createQuickTransaction({
      amount: -50,
      account_id: "acct-1",
      category_id: "cat-groceries",
    });

    await updateQuickTransaction({
      id: txn.id,
      amount: -50,
      account_id: "acct-1",
      category_id: null,
      payee: "",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -20 },
      ],
      wasSplitParent: false,
    });

    const stored = getTxn(txn.id)!;
    expect(stored.is_split_parent).toBe(1);
    expect(stored.category_id).toBeNull();
    expect(getSplits(txn.id)).toHaveLength(2);
  });

  it("demotes a split parent back to a single-category txn", async () => {
    const { createQuickSplitTransaction, updateQuickTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const splitResult = await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -20 },
      ],
    });
    if (!splitResult.ok) throw new Error("expected ok result");
    const parentId = splitResult.parent.id;

    expect(getTxn(parentId)!.is_split_parent).toBe(1);
    expect(getSplits(parentId)).toHaveLength(2);

    const updateResult = await updateQuickTransaction({
      id: parentId,
      amount: -50,
      account_id: "acct-1",
      category_id: "cat-gas",
      payee: "",
      wasSplitParent: true,
    });
    expect(updateResult).toEqual({ ok: true });

    const stored = getTxn(parentId)!;
    expect(stored.is_split_parent).toBe(0);
    expect(stored.category_id).toBe("cat-gas");
    expect(getSplits(parentId)).toHaveLength(0);
  });

  it("returns ok:false sum_mismatch when promoting with a mismatched split set", async () => {
    const { createQuickTransaction, updateQuickTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const txn = await createQuickTransaction({
      amount: -50,
      account_id: "acct-1",
      category_id: "cat-groceries",
    });

    const result = await updateQuickTransaction({
      id: txn.id,
      amount: -50,
      account_id: "acct-1",
      category_id: null,
      payee: "",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -19.99 },
      ],
      wasSplitParent: false,
    });

    expect(result).toEqual({
      ok: false,
      error: "sum_mismatch",
      got: -49.99,
      expected: -50,
    });

    // No write should have landed: amount, category, balance, splits unchanged.
    const stored = getTxn(txn.id)!;
    expect(stored.amount).toBe(-50);
    expect(stored.category_id).toBe("cat-groceries");
    expect(stored.is_split_parent).toBe(0);
    expect(getSplits(txn.id)).toHaveLength(0);
  });
});

describe("deleteQuickTransaction", () => {
  it("removes a single-category txn and reverses the balance", async () => {
    const { createQuickTransaction, deleteQuickTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const txn = await createQuickTransaction({
      amount: -25,
      account_id: "acct-1",
      category_id: "cat-groceries",
    });
    expect(getBalance("acct-1")).toBe(-25);

    await deleteQuickTransaction(txn.id);

    expect(getTxn(txn.id)).toBeUndefined();
    expect(getBalance("acct-1")).toBe(0);
  });

  it("cascades the transfer sibling on delete (both legs gone, both balances revert)", async () => {
    const { createQuickTransfer, deleteQuickTransaction } = await import(
      "@/app/(app)/transactions/actions"
    );

    const snapshot = await createQuickTransfer({
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      amount: 100,
    });

    expect(getBalance("acct-1")).toBe(-100);
    expect(getBalance("acct-2")).toBe(100);

    await deleteQuickTransaction(snapshot.outflowTxnId);

    expect(getTxn(snapshot.outflowTxnId)).toBeUndefined();
    expect(getTxn(snapshot.inflowTxnId)).toBeUndefined();
    expect(getBalance("acct-1")).toBe(0);
    expect(getBalance("acct-2")).toBe(0);
  });
});

describe("getQuickAddData", () => {
  it("returns accounts, category groups, all categories, and empty buckets/recents on a fresh db", async () => {
    const { getQuickAddData } = await import("@/app/(app)/transactions/actions");

    const data = await getQuickAddData();

    expect(data.accounts.map((a) => a.id)).toEqual(["acct-1", "acct-2"]);
    // System groups (System, Inflow) appear alongside user groups.
    expect(data.categoryGroups.map((g) => g.id)).toEqual(
      expect.arrayContaining(["grp-spend", "grp-income"])
    );
    // Categories include the 7 user seeds + any system categories surfaced
    // by migrations; both buckets and recents are empty on a fresh db.
    expect(data.categories.length).toBeGreaterThanOrEqual(7);
    expect(data.recentQuickAdds).toHaveLength(0);
    expect(data.payees).toEqual([]);
  });

  it("maps current-month available per expense category and omits income categories", async () => {
    const { getMonthKey } = await import("@/lib/format");
    const month = getMonthKey();

    // Assign $200 to groceries this month and spend $60 of it.
    db.prepare(
      `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
       VALUES (?, ?, ?, ?, ?)`
    ).run("mb-1", USER_ID, "cat-groceries", month, 200);
    db.prepare(
      `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run("txn-avail", USER_ID, "acct-1", `${month.slice(0, 8)}05`, "Store", -60, "cat-groceries");

    const { getQuickAddData } = await import("@/app/(app)/transactions/actions");
    const data = await getQuickAddData();

    expect(data.availableByCategory["cat-groceries"]).toBeCloseTo(140, 5);
    // Untouched expense categories still map (at 0 available).
    expect(data.availableByCategory["cat-dining"]).toBe(0);
    // Income categories carry no envelope — absent from the map entirely.
    expect("cat-salary" in data.availableByCategory).toBe(false);
  });

  it("pads expense bucket with the first 3 user categories by sort_order (no system leak)", async () => {
    const { getQuickAddData } = await import("@/app/(app)/transactions/actions");

    const data = await getQuickAddData();

    // sort_order: cat-groceries (0), cat-dining (1), cat-gas (2).
    expect(data.topCategoryIds).toEqual(["cat-groceries", "cat-dining", "cat-gas"]);
  });

  it("pads income bucket with the first 3 income categories by sort_order (no system leak)", async () => {
    const { getQuickAddData } = await import("@/app/(app)/transactions/actions");

    const data = await getQuickAddData();

    expect(data.topIncomeCategoryIds).toEqual([
      "cat-salary",
      "cat-side",
      "cat-gift",
    ]);
  });

  it("never surfaces system categories in either bucket, even if seeded recent-usage exists", async () => {
    // Force a system category to appear in recent-usage by inserting a
    // transaction with category_id = STARTING_BALANCE_CATEGORY_ID directly.
    // The action must still skip it during bucket build.
    db.prepare(
      `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run(
      "txn-sys",
      USER_ID,
      "acct-1",
      "2026-06-07",
      "Starting balance",
      -100,
      "ba1a7c00-0000-4000-8000-000000000006"
    );

    const { getQuickAddData } = await import("@/app/(app)/transactions/actions");
    const data = await getQuickAddData();

    for (const id of data.topCategoryIds) {
      expect(id.startsWith("ba1a7c00-")).toBe(false);
    }
    for (const id of data.topIncomeCategoryIds) {
      expect(id.startsWith("ba1a7c00-")).toBe(false);
    }
  });

  it("pinned categories take priority over padding, ordered by sort_order", async () => {
    db.prepare(`UPDATE categories SET pinned_quick = 1 WHERE id = ?`).run("cat-rent");
    db.prepare(`UPDATE categories SET pinned_quick = 1 WHERE id = ?`).run("cat-gas");

    const { getQuickAddData } = await import("@/app/(app)/transactions/actions");
    const data = await getQuickAddData();

    // Pinned first: cat-gas (sort_order 2), cat-rent (sort_order 3), then pad
    // with first available user expense by sort_order (cat-groceries at 0).
    expect(data.topCategoryIds).toEqual(["cat-gas", "cat-rent", "cat-groceries"]);
  });

  it("recent-usage frequency fills slots between pinned and pad fallback", async () => {
    const { createQuickTransaction, getQuickAddData } = await import(
      "@/app/(app)/transactions/actions"
    );

    // Use cat-dining 3x and cat-gas 1x — both should appear ahead of pad
    // fallback, ordered by usage count.
    await createQuickTransaction({
      amount: -5,
      account_id: "acct-1",
      category_id: "cat-dining",
    });
    await createQuickTransaction({
      amount: -5,
      account_id: "acct-1",
      category_id: "cat-dining",
    });
    await createQuickTransaction({
      amount: -5,
      account_id: "acct-1",
      category_id: "cat-dining",
    });
    await createQuickTransaction({
      amount: -5,
      account_id: "acct-1",
      category_id: "cat-gas",
    });

    const data = await getQuickAddData();

    // dining (3x), gas (1x), then pad falls back to next user expense in
    // sort_order — cat-groceries at sort_order 0.
    expect(data.topCategoryIds).toEqual(["cat-dining", "cat-gas", "cat-groceries"]);
  });

  it("surfaces the 5 most recent transactions in recentQuickAdds, newest first", async () => {
    const insertAt = db.prepare(
      `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (let i = 0; i < 7; i++) {
      const id = `txn-${String(i).padStart(2, "0")}`;
      const createdAt = `2026-06-07T10:00:${String(i).padStart(2, "0")}.000Z`;
      insertAt.run(id, USER_ID, "acct-1", "2026-06-07", `payee-${i}`, -1, "cat-groceries", createdAt, createdAt);
    }

    const { getQuickAddData } = await import("@/app/(app)/transactions/actions");
    const data = await getQuickAddData();

    expect(data.recentQuickAdds).toHaveLength(5);
    expect(data.recentQuickAdds[0].transactionId).toBe("txn-06");
    expect(data.recentQuickAdds[4].transactionId).toBe("txn-02");
  });

  it("recent list surfaces transfer outflow leg only (amount < 0)", async () => {
    const { createQuickTransfer, getQuickAddData } = await import(
      "@/app/(app)/transactions/actions"
    );

    const snapshot = await createQuickTransfer({
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      amount: 50,
    });

    const data = await getQuickAddData();

    expect(data.recentQuickAdds).toHaveLength(1);
    expect(data.recentQuickAdds[0].transactionId).toBe(snapshot.outflowTxnId);
    expect(data.recentQuickAdds[0].transferToAccountId).toBe("acct-2");
  });

  it("attaches all child category ids on split-parent recent rows", async () => {
    const { createQuickSplitTransaction, getQuickAddData } = await import(
      "@/app/(app)/transactions/actions"
    );

    const result = await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -20 },
      ],
    });
    if (!result.ok) throw new Error("expected ok result");

    const data = await getQuickAddData();
    const row = data.recentQuickAdds.find(
      (r) => r.transactionId === result.parent.id
    )!;

    expect(row.isSplitParent).toBe(true);
    expect(row.categoryIds.sort()).toEqual(["cat-dining", "cat-groceries"]);
  });

  // Regression: the edit sheet seeds its per-line inputs from `splitAmounts`
  // and writes that state straight back on save. When this field didn't exist
  // the sheet invented an even distribution, so editing only the payee of a
  // $30/$20 split silently rewrote it to $25/$25 — the parent total was
  // untouched, so nothing anywhere flagged the loss.
  it("surfaces the real per-line split amounts, not an even distribution", async () => {
    const { createQuickSplitTransaction, getQuickAddData } = await import(
      "@/app/(app)/transactions/actions"
    );

    const result = await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -20 },
      ],
    });
    if (!result.ok) throw new Error("expected ok result");

    const data = await getQuickAddData();
    const row = data.recentQuickAdds.find(
      (r) => r.transactionId === result.parent.id
    )!;

    // Aligned index-for-index with categoryIds, as magnitudes.
    const byCategory = Object.fromEntries(
      row.categoryIds.map((id, i) => [id, row.splitAmounts[i]])
    );
    expect(byCategory).toEqual({ "cat-groceries": 30, "cat-dining": 20 });
    // The even split this used to produce would have been 25/25.
    expect(row.splitAmounts).not.toEqual([25, 25]);
  });

  it("preserves an uneven split when only the payee is edited", async () => {
    const { createQuickSplitTransaction, getQuickAddData, updateQuickTransaction } =
      await import("@/app/(app)/transactions/actions");

    const result = await createQuickSplitTransaction({
      total_amount: -50,
      account_id: "acct-1",
      splits: [
        { category_id: "cat-groceries", amount: -30 },
        { category_id: "cat-dining", amount: -20 },
      ],
      payee: "Typo",
    });
    if (!result.ok) throw new Error("expected ok result");

    // Replay what the edit sheet does: seed from what the server handed back,
    // change nothing but the payee, save.
    const seeded = (await getQuickAddData()).recentQuickAdds.find(
      (r) => r.transactionId === result.parent.id
    )!;
    const saveResult = await updateQuickTransaction({
      id: result.parent.id,
      amount: seeded.signedAmount,
      account_id: seeded.accountId,
      category_id: null,
      splits: seeded.categoryIds.map((id, i) => ({
        category_id: id,
        amount: -seeded.splitAmounts[i],
      })),
      payee: "Fixed",
      memo: null,
      wasSplitParent: true,
    });
    expect(saveResult.ok).toBe(true);

    const stored = db
      .prepare(
        `SELECT category_id, amount FROM transaction_splits
          WHERE parent_transaction_id = ? ORDER BY created_at ASC`
      )
      .all(result.parent.id) as { category_id: string; amount: number }[];

    expect(
      Object.fromEntries(stored.map((s) => [s.category_id, s.amount]))
    ).toEqual({ "cat-groceries": -30, "cat-dining": -20 });
    expect(getTxn(result.parent.id)!.payee).toBe("Fixed");
  });

  it("returns unique payee names sorted alphabetically", async () => {
    db.prepare(
      `INSERT INTO payees (id, user_id, name) VALUES (?, ?, ?)`
    ).run("p1", USER_ID, "Costco");
    db.prepare(
      `INSERT INTO payees (id, user_id, name) VALUES (?, ?, ?)`
    ).run("p2", USER_ID, "Amazon");
    db.prepare(
      `INSERT INTO payees (id, user_id, name) VALUES (?, ?, ?)`
    ).run("p3", USER_ID, "Trader Joe's");

    const { getQuickAddData } = await import("@/app/(app)/transactions/actions");
    const data = await getQuickAddData();

    expect(data.payees).toEqual(["Amazon", "Costco", "Trader Joe's"]);
  });
});
