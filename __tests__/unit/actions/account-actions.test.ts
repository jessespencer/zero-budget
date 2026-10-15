import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import {
  INFLOW_CATEGORY_GROUP_ID,
  READY_TO_ASSIGN_CATEGORY_ID,
  STARTING_BALANCE_CATEGORY_ID,
} from "@/lib/db";

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

const todayIso = () => new Date().toISOString().slice(0, 10);

const accountRow = (id: string) =>
  db
    .prepare("SELECT * FROM accounts WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;

const transactionRows = (accountId: string) =>
  db
    .prepare("SELECT * FROM transactions WHERE account_id = ?")
    .all(accountId) as Record<string, unknown>[];

describe("createAccount", () => {
  // ── No starting-balance transaction expected ──────────────────────────

  it("creates account with no transaction when balance is 0", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "Checking",
      type: "checking",
      currentBalance: 0,
    });

    const acct = accountRow(id);
    expect(acct).toBeDefined();
    expect(acct?.current_balance).toBe(0);
    expect(transactionRows(id)).toHaveLength(0);
  });

  it("creates account with no transaction when balance is omitted", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({ name: "Checking", type: "checking" });

    expect(accountRow(id)?.current_balance).toBe(0);
    expect(transactionRows(id)).toHaveLength(0);
  });

  it("creates account with no transaction when balance is negative", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "Overdrawn",
      type: "checking",
      currentBalance: -50,
    });

    expect(accountRow(id)?.current_balance).toBe(-50);
    expect(transactionRows(id)).toHaveLength(0);
  });

  it("creates credit_card with negative balance + starting outflow when 'amount owed' is positive", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "Chase",
      type: "credit_card",
      currentBalance: 1000,
    });

    const acct = accountRow(id);
    // Debt: stored as negative regardless of how the user typed it.
    expect(acct?.current_balance).toBe(-1000);
    expect(acct?.is_debt).toBe(1);

    // Exactly one starting-balance transaction.
    const txns = transactionRows(id);
    expect(txns).toHaveLength(1);
    const txn = txns[0];
    expect(txn.payee).toBe("Starting balance");
    expect(txn.amount).toBe(-1000);
    // Debt isn't budgetable income — category STARTING_BALANCE_CATEGORY_ID
    // distinguishes it from checking/savings starting balances (which target
    // Ready to assign) and is filtered out of all category pickers; the
    // transactions table renders it as a neutral "Category not needed" pill.
    // See migration 017.
    expect(txn.category_id).toBe(STARTING_BALANCE_CATEGORY_ID);
    expect(txn.cleared).toBe(1);
    expect(txn.approved).toBe(1);
    expect(txn.is_split_parent).toBe(0);
    expect(txn.date).toBe(todayIso());
  });

  it("tolerates negative input for credit_card (Math.abs) — same final state", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "Chase",
      type: "credit_card",
      currentBalance: -1000,
    });

    const acct = accountRow(id);
    expect(acct?.current_balance).toBe(-1000);
    expect(acct?.is_debt).toBe(1);

    const txns = transactionRows(id);
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(-1000);
    expect(txns[0].category_id).toBe(STARTING_BALANCE_CATEGORY_ID);
    expect(txns[0].payee).toBe("Starting balance");
  });

  it("creates no transaction for credit_card with zero balance", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "Empty card",
      type: "credit_card",
      currentBalance: 0,
    });

    expect(accountRow(id)?.current_balance).toBe(0);
    expect(accountRow(id)?.is_debt).toBe(1);
    expect(transactionRows(id)).toHaveLength(0);
  });

  it("creates no transaction for credit_card when balance is omitted", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({ name: "Empty card", type: "credit_card" });

    expect(accountRow(id)?.current_balance).toBe(0);
    expect(accountRow(id)?.is_debt).toBe(1);
    expect(transactionRows(id)).toHaveLength(0);
  });

  // ── Starting-balance transaction expected ─────────────────────────────

  it.each([
    ["checking" as const],
    ["savings" as const],
    ["other" as const],
  ])(
    "creates a Starting balance income transaction for %s with positive balance",
    async (type) => {
      const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
      const id = await createAccount({
        name: "TEST",
        type,
        currentBalance: 400000,
      });

      // Account ends at the requested balance.
      const acct = accountRow(id);
      expect(acct?.current_balance).toBe(400000);

      // Exactly one transaction with the expected shape.
      const txns = transactionRows(id);
      expect(txns).toHaveLength(1);
      const txn = txns[0];
      expect(txn.payee).toBe("Starting balance");
      expect(txn.memo).toBeNull();
      expect(txn.amount).toBe(400000);
      expect(txn.cleared).toBe(1);
      expect(txn.approved).toBe(1);
      expect(txn.is_split_parent).toBe(0);
      expect(txn.date).toBe(todayIso());

      // The transaction lands in the seeded "Ready to assign" category.
      expect(txn.category_id).toBe(READY_TO_ASSIGN_CATEGORY_ID);
    }
  );

  it("seeds Inflow group and Ready to assign category from migration 008", () => {
    // Sanity check on the seed itself: every freshly-migrated DB has the
    // system Inflow group and Ready to assign category before any user action.
    const group = db
      .prepare("SELECT * FROM category_groups WHERE id = ?")
      .get(INFLOW_CATEGORY_GROUP_ID) as Record<string, unknown> | undefined;
    expect(group).toBeDefined();
    expect(group?.name).toBe("Inflow");
    expect(group?.is_income).toBe(1);
    expect(group?.is_system).toBe(1);

    const category = db
      .prepare("SELECT * FROM categories WHERE id = ?")
      .get(READY_TO_ASSIGN_CATEGORY_ID) as Record<string, unknown> | undefined;
    expect(category).toBeDefined();
    expect(category?.name).toBe("Ready to assign");
    expect(category?.category_group_id).toBe(INFLOW_CATEGORY_GROUP_ID);
    expect(category?.archived).toBe(0);
  });

  it("targets the system Ready to assign category even when user-defined income categories exist", async () => {
    // Pre-seed a user-created income group + category. The starting-balance
    // transaction must STILL go to the system Ready to assign category, not
    // pollute the user's "Salary" or similar.
    const groupId = "g-user-income";
    const catId = "c-user-salary";
    db.prepare(
      `INSERT INTO category_groups (id, user_id, name, is_income, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, ?)`
    ).run(groupId, USER_ID, "Income", todayIso(), todayIso());
    db.prepare(
      `INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
    ).run(catId, USER_ID, groupId, "Salary", todayIso(), todayIso());

    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "TEST",
      type: "checking",
      currentBalance: 100,
    });

    const txns = transactionRows(id);
    expect(txns).toHaveLength(1);
    expect(txns[0].category_id).toBe(READY_TO_ASSIGN_CATEGORY_ID);
    expect(txns[0].category_id).not.toBe(catId);
  });

  // ── Integration: Ready to Assign reflects the starting balance ─────────

  it("Ready to Assign reflects the starting balance via the live budget engine", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    await createAccount({
      name: "TEST",
      type: "checking",
      currentBalance: 400000,
    });

    const { getBudgetData } = await import("@/app/(app)/budget/actions");
    const { computeBudgetMonth } = await import("@/lib/budget-engine");

    // Use the first day of the current month to match the engine's month-key
    // convention (`"YYYY-MM-01"`).
    const today = new Date();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;

    const data = await getBudgetData(monthKey);
    const result = computeBudgetMonth(data);

    expect(result.totalIncome).toBe(400000);
    expect(result.totalAssigned).toBe(0);
    expect(result.overspentLastMonth).toBe(0);
    expect(result.readyToAssign).toBe(400000);
  });
});

// Close/reopen fixtures use savings, not checking: the first checking account
// becomes primary (createAccount), and a primary account can't be closed.
describe("closeAccountWithSnapshot", () => {
  const adjustmentRows = (accountId: string) =>
    transactionRows(accountId).filter((t) => t.payee === "Balance adjustment");

  it("archives the account rather than deleting the row", async () => {
    const { createAccount, closeAccountWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await createAccount({ name: "Savings", type: "savings" });

    const result = await closeAccountWithSnapshot(id);

    expect(result).toMatchObject({ accountId: id, balanceAdjustment: null });
    const acct = accountRow(id);
    expect(acct).toBeDefined();
    expect(acct?.archived).toBe(1);
  });

  it("writes no adjustment transaction when the balance is already zero", async () => {
    const { createAccount, closeAccountWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await createAccount({ name: "Savings", type: "savings" });

    const result = await closeAccountWithSnapshot(id);

    expect("balanceAdjustment" in result && result.balanceAdjustment).toBeNull();
    expect(adjustmentRows(id)).toHaveLength(0);
  });

  it("zeroes a non-zero balance with one adjustment against Ready to assign", async () => {
    const { createAccount, closeAccountWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await createAccount({
      name: "Savings",
      type: "savings",
      currentBalance: 400000,
    });
    expect(accountRow(id)?.current_balance).toBe(400000);

    const result = await closeAccountWithSnapshot(id);

    expect("balanceAdjustment" in result && result.balanceAdjustment).toMatchObject({
      accountId: id,
      previousBalance: 400000,
    });
    const adjustments = adjustmentRows(id);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amount).toBe(-400000);
    expect(adjustments[0].category_id).toBe(READY_TO_ASSIGN_CATEGORY_ID);
    expect(accountRow(id)?.current_balance).toBe(0);
  });

  it("leaves the account's existing transactions intact", async () => {
    const { createAccount, closeAccountWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await createAccount({
      name: "Savings",
      type: "savings",
      currentBalance: 400000,
    });
    expect(transactionRows(id)).toHaveLength(1);

    await closeAccountWithSnapshot(id);

    // The starting-balance row survives; the adjustment is additive.
    const rows = transactionRows(id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((t) => t.payee === "Starting balance")).toHaveLength(1);
  });

  it("zeroes a credit card's negative balance with a positive adjustment", async () => {
    const { createAccount, closeAccountWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await createAccount({
      name: "Capital One",
      type: "credit_card",
      currentBalance: 31753,
    });
    // Debt is stored negative — that's the invariant the sign math protects.
    expect(accountRow(id)?.current_balance).toBe(-31753);

    await closeAccountWithSnapshot(id);

    const adjustments = adjustmentRows(id);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amount).toBe(31753);
    expect(accountRow(id)?.current_balance).toBe(0);
  });

  it("returns not_found for an unknown id", async () => {
    const { closeAccountWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );

    const result = await closeAccountWithSnapshot("does-not-exist");

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found for an already-archived account — closing twice is not idempotent", async () => {
    const { createAccount, closeAccountWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await createAccount({ name: "Savings", type: "savings" });

    await closeAccountWithSnapshot(id);
    expect(accountRow(id)?.archived).toBe(1);

    const second = await closeAccountWithSnapshot(id);

    expect(second).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns is_primary for the primary account, leaving it unarchived and unadjusted", async () => {
    const { createAccount, setPrimaryAccount, closeAccountWithSnapshot } =
      await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "Savings",
      type: "savings",
      currentBalance: 400000,
    });
    await setPrimaryAccount(id);

    const result = await closeAccountWithSnapshot(id);

    expect(result).toEqual({ ok: false, reason: "is_primary" });
    expect(accountRow(id)?.archived).toBe(0);
    // The refusal must come before the money moves, not after.
    expect(adjustmentRows(id)).toHaveLength(0);
    expect(accountRow(id)?.current_balance).toBe(400000);
  });

  it("does not archive an account belonging to a different user", async () => {
    const { closeAccountWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const otherUserId = "11111111-1111-1111-1111-111111111111";
    const id = "acct-other-user";
    db.prepare(
      `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, 0, 0, 0, ?, ?)`
    ).run(id, otherUserId, "Someone else's checking", "checking", todayIso(), todayIso());

    const result = await closeAccountWithSnapshot(id);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(accountRow(id)?.archived).toBe(0);
  });

  it("does not redirect — the caller stays put", async () => {
    const { createAccount, closeAccountWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const { redirect } = await import("next/navigation");
    const id = await createAccount({ name: "Savings", type: "savings" });

    await closeAccountWithSnapshot(id);

    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("reopenAccountFromSnapshot", () => {
  it("restores archived, updated_at, and the balance the adjustment moved", async () => {
    const { createAccount, closeAccountWithSnapshot, reopenAccountFromSnapshot } =
      await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "Savings",
      type: "savings",
      currentBalance: 400000,
    });
    const before = accountRow(id);

    const snapshot = await closeAccountWithSnapshot(id);
    if ("ok" in snapshot) throw new Error("expected a snapshot");
    expect(accountRow(id)?.current_balance).toBe(0);

    await reopenAccountFromSnapshot(snapshot);

    const after = accountRow(id);
    expect(after?.archived).toBe(0);
    expect(after?.current_balance).toBe(400000);
    expect(after?.updated_at).toBe(before?.updated_at);
    // The synthetic adjustment is gone, not merely offset by a second one.
    expect(
      transactionRows(id).filter((t) => t.payee === "Balance adjustment")
    ).toHaveLength(0);
  });

  it("un-archives without touching transactions when there was no adjustment", async () => {
    const { createAccount, closeAccountWithSnapshot, reopenAccountFromSnapshot } =
      await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({ name: "Savings", type: "savings" });

    const snapshot = await closeAccountWithSnapshot(id);
    if ("ok" in snapshot) throw new Error("expected a snapshot");
    await reopenAccountFromSnapshot(snapshot);

    expect(accountRow(id)?.archived).toBe(0);
    expect(transactionRows(id)).toHaveLength(0);
  });

  it("throws when the adjustment was already reversed, rather than double-undoing", async () => {
    const { createAccount, closeAccountWithSnapshot, reopenAccountFromSnapshot } =
      await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "Savings",
      type: "savings",
      currentBalance: 400000,
    });

    const snapshot = await closeAccountWithSnapshot(id);
    if ("ok" in snapshot) throw new Error("expected a snapshot");
    await reopenAccountFromSnapshot(snapshot);

    await expect(reopenAccountFromSnapshot(snapshot)).rejects.toThrow(
      /may have already been undone/
    );
    // The failed undo must not have moved the balance a second time.
    expect(accountRow(id)?.current_balance).toBe(400000);
  });
});

describe("reopenAccount", () => {
  it("un-archives the account and leaves the write-off on the ledger", async () => {
    const { createAccount, closeAccountWithSnapshot, reopenAccount } =
      await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({
      name: "Savings",
      type: "savings",
      currentBalance: 400000,
    });
    await closeAccountWithSnapshot(id);

    const result = await reopenAccount(id);

    expect(result).toEqual({ ok: true });
    expect(accountRow(id)?.archived).toBe(0);
    // Deliberate reopen is not an undo — the account comes back at $0 with the
    // adjustment still recorded.
    expect(accountRow(id)?.current_balance).toBe(0);
    expect(
      transactionRows(id).filter((t) => t.payee === "Balance adjustment")
    ).toHaveLength(1);
  });

  it("returns not_found for an unknown id", async () => {
    const { reopenAccount } = await import("@/app/(app)/accounts/[id]/actions");

    expect(await reopenAccount("does-not-exist")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

// The Convert dialog's figure and the mutation behind it. Both were wrong
// against production data — the dialog by naming the current balance instead
// of the starting-balance row, the mutation by matching that row's payee
// case-sensitively when the historical import wrote a different casing.
describe("Convert — starting-balance impact", () => {
  const CUTOFF = "2026-05-01"; // seeded by migration 019

  // Inserts a starting-balance row directly so the date and casing can be
  // controlled; createAccount always writes today's date and lowercase.
  const seedStartingBalance = (
    accountId: string,
    opts: { payee?: string; date: string; amount: number; category?: string }
  ) => {
    db.prepare(
      `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, cleared, approved, is_split_parent, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 'desktop', ?, ?)`
    ).run(
      `txn-${accountId}-${opts.date}`,
      USER_ID,
      accountId,
      opts.date,
      opts.payee ?? "Starting balance",
      opts.amount,
      opts.category ?? READY_TO_ASSIGN_CATEGORY_ID,
      todayIso(),
      todayIso()
    );
  };

  const seedAccount = async (name = "Checking") => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    return createAccount({ name, type: "checking" });
  };

  it("reports the starting-balance amount, not the account's current balance", async () => {
    const { getStartingBalanceImpact } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await seedAccount();
    seedStartingBalance(id, { date: "2026-05-02", amount: 180 });
    // Activity since, so current_balance and the starting balance disagree —
    // the exact condition under which the old copy was wrong.
    db.prepare("UPDATE accounts SET current_balance = 900 WHERE id = ?").run(id);

    expect(await getStartingBalanceImpact(id)).toBe(180);
  });

  // The case the todo singled out as the one a naive implementation gets wrong
  // again: computeBudgetMonth skips anything dated before budget_start_month,
  // so the row is invisible to the engine and Ready to assign does not move.
  it("reports zero when the starting balance predates the budget start", async () => {
    const { getStartingBalanceImpact } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await seedAccount();
    seedStartingBalance(id, { date: "2025-06-01", amount: 4867.69 });

    expect(CUTOFF > "2025-06-01").toBe(true);
    expect(await getStartingBalanceImpact(id)).toBe(0);
  });

  it("counts a capital-B 'Starting Balance' row the way production stores it", async () => {
    const { getStartingBalanceImpact } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await seedAccount();
    seedStartingBalance(id, {
      payee: "Starting Balance",
      date: "2026-05-02",
      amount: 1234.56,
    });

    expect(await getStartingBalanceImpact(id)).toBe(1234.56);
  });

  // The regression: with BINARY collation this matched 0 rows on the Pi, so
  // Convert flipped the flag and recategorised nothing.
  it("recategorises a capital-B row when converting", async () => {
    const { setAccountBudgetStatusWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );
    const id = await seedAccount();
    seedStartingBalance(id, {
      payee: "Starting Balance",
      date: "2026-05-02",
      amount: 900,
    });

    const snapshot = await setAccountBudgetStatusWithSnapshot(id, false);

    expect(snapshot?.txn_category_changes).toHaveLength(1);
    const row = transactionRows(id).find((t) => t.payee === "Starting Balance");
    expect(row?.category_id).toBe(STARTING_BALANCE_CATEGORY_ID);
    expect(accountRow(id)?.is_budget_account).toBe(0);
  });
});
