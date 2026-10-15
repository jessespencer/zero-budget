import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import {
  READY_TO_ASSIGN_CATEGORY_ID,
  STARTING_BALANCE_CATEGORY_ID,
} from "@/lib/db";

// 260517-vxf — covers setAccountBudgetStatusWithSnapshot, undo round-trip,
// the RTA delta as observed through the real budget engine, and edge cases
// (no Starting-balance txn, idempotent no-op, credit_card rejection).

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  clearTestDb();
  db.close();
});

// Test month must match the month in which `createAccount` writes its
// "Starting balance" transaction — that txn is dated `today` server-side,
// and the budget engine only counts transactions whose date is ≤ month-end.
// Originally hardcoded to "2026-05-01" (v1.1 milestone), which broke on
// 2026-06-01 when the txn date crossed the month boundary. Derive
// dynamically so the assertion stays correct as the calendar moves.
const TEST_MONTH = (() => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
})();

type AccountRow = {
  id: string;
  is_budget_account: number;
  current_balance: number;
  updated_at: string;
};

type TxnRow = {
  id: string;
  category_id: string | null;
  payee: string | null;
  amount: number;
  updated_at: string;
};

const accountRow = (id: string): AccountRow | undefined =>
  db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as
    | AccountRow
    | undefined;

const txnsFor = (accountId: string): TxnRow[] =>
  db
    .prepare("SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at")
    .all(accountId) as TxnRow[];

const startingBalanceTxn = (accountId: string): TxnRow | undefined =>
  txnsFor(accountId).find((t) => t.payee === "Starting balance");

async function computeRta(month: string): Promise<number> {
  // Dynamic import so the action-level vi.mock for next/cache (loaded by
  // setupFiles) is applied before budget actions pull in revalidatePath.
  const { getBudgetData } = await import("@/app/(app)/budget/actions");
  const { computeBudgetMonth } = await import("@/lib/budget-engine");
  const data = await getBudgetData(month);
  return computeBudgetMonth(data).readyToAssign;
}

describe("setAccountBudgetStatusWithSnapshot — 260517-vxf", () => {
  // ── Test 1: toggle off drops RTA by current_balance ────────────────────
  it("toggling off-budget drops RTA by exactly current_balance", async () => {
    const { createAccount, setAccountBudgetStatusWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );

    const id = await createAccount({
      name: "Business checking",
      type: "checking",
      currentBalance: 900,
    });

    const before = await computeRta(TEST_MONTH);
    expect(before).toBe(900);

    const snapshot = await setAccountBudgetStatusWithSnapshot(id, false);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.previous_on_budget).toBe(true);
    expect(snapshot?.txn_category_changes).toHaveLength(1);
    expect(snapshot?.txn_category_changes[0].prev_category_id).toBe(
      READY_TO_ASSIGN_CATEGORY_ID
    );

    const after = await computeRta(TEST_MONTH);
    expect(after).toBe(0);
    expect(before - after).toBe(900);

    expect(accountRow(id)?.is_budget_account).toBe(0);
    expect(startingBalanceTxn(id)?.category_id).toBe(
      STARTING_BALANCE_CATEGORY_ID
    );
  });

  // ── Test 2: toggle on restores RTA ──────────────────────────────────────
  it("toggling back on-budget restores RTA by current_balance", async () => {
    const { createAccount, setAccountBudgetStatusWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );

    const id = await createAccount({
      name: "Robo-advisor",
      type: "savings",
      currentBalance: 500,
      onBudget: false,
    });

    // Tracking-only at creation: RTA must be 0 even though the account has
    // a positive balance.
    const beforeOn = await computeRta(TEST_MONTH);
    expect(beforeOn).toBe(0);
    expect(accountRow(id)?.is_budget_account).toBe(0);
    expect(startingBalanceTxn(id)?.category_id).toBe(
      STARTING_BALANCE_CATEGORY_ID
    );

    const snapshot = await setAccountBudgetStatusWithSnapshot(id, true);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.previous_on_budget).toBe(false);
    expect(snapshot?.txn_category_changes[0].prev_category_id).toBe(
      STARTING_BALANCE_CATEGORY_ID
    );

    const afterOn = await computeRta(TEST_MONTH);
    expect(afterOn).toBe(500);
    expect(startingBalanceTxn(id)?.category_id).toBe(
      READY_TO_ASSIGN_CATEGORY_ID
    );
  });

  // ── Test 3: snapshot round-trip ─────────────────────────────────────────
  it("undo restores both is_budget_account AND the txn category_id", async () => {
    const {
      createAccount,
      setAccountBudgetStatusWithSnapshot,
      undoSetAccountBudgetStatus,
    } = await import("@/app/(app)/accounts/[id]/actions");

    const id = await createAccount({
      name: "Credit union savings",
      type: "savings",
      currentBalance: 900,
    });

    const snapshot = await setAccountBudgetStatusWithSnapshot(id, false);
    if (!snapshot) throw new Error("expected snapshot");

    // Deep-clone snapshot before undo so we can confirm the action did not
    // mutate the caller's object.
    const snapshotClone = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;

    await undoSetAccountBudgetStatus(snapshot);

    expect(accountRow(id)?.is_budget_account).toBe(1);
    expect(startingBalanceTxn(id)?.category_id).toBe(
      READY_TO_ASSIGN_CATEGORY_ID
    );

    // Snapshot must remain immutable.
    expect(snapshot).toEqual(snapshotClone);
  });

  // ── Test 4: account with no Starting-balance txn (created at $0) ───────
  it("is a txn-level no-op when no Starting-balance txn exists", async () => {
    const { createAccount, setAccountBudgetStatusWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );

    const id = await createAccount({
      name: "Empty checking",
      type: "checking",
      currentBalance: 0,
    });

    expect(txnsFor(id)).toHaveLength(0);
    const before = await computeRta(TEST_MONTH);

    const snapshot = await setAccountBudgetStatusWithSnapshot(id, false);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.txn_category_changes).toEqual([]);
    expect(accountRow(id)?.is_budget_account).toBe(0);

    const after = await computeRta(TEST_MONTH);
    expect(after).toBe(before);

    // Toggle back: column flips, no txn changes still.
    const snapshot2 = await setAccountBudgetStatusWithSnapshot(id, true);
    expect(snapshot2?.txn_category_changes).toEqual([]);
    expect(accountRow(id)?.is_budget_account).toBe(1);
  });

  // ── Test 5: idempotent no-op ────────────────────────────────────────────
  it("returns null and writes nothing when called with the current state", async () => {
    const { createAccount, setAccountBudgetStatusWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );

    const id = await createAccount({
      name: "Business checking",
      type: "checking",
      currentBalance: 100,
      onBudget: false,
    });

    const txnBefore = startingBalanceTxn(id);
    expect(txnBefore?.category_id).toBe(STARTING_BALANCE_CATEGORY_ID);
    const updatedAtBefore = txnBefore?.updated_at;

    const result = await setAccountBudgetStatusWithSnapshot(id, false);
    expect(result).toBeNull();

    const txnAfter = startingBalanceTxn(id);
    expect(txnAfter?.updated_at).toBe(updatedAtBefore);
    expect(txnAfter?.category_id).toBe(STARTING_BALANCE_CATEGORY_ID);
  });

  // ── Test 6: credit_card rejection ───────────────────────────────────────
  it("throws when called on a credit_card account", async () => {
    const { createAccount, setAccountBudgetStatusWithSnapshot } = await import(
      "@/app/(app)/accounts/[id]/actions"
    );

    const id = await createAccount({
      name: "Chase",
      type: "credit_card",
      currentBalance: 1000,
    });

    await expect(
      setAccountBudgetStatusWithSnapshot(id, false)
    ).rejects.toThrow(/credit card/i);
  });
});

describe("createAccount onBudget flag — 260517-vxf", () => {
  it("creates non-debt off-budget accounts with the system Starting-balance category", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");

    const id = await createAccount({
      name: "Business checking",
      type: "checking",
      currentBalance: 500,
      onBudget: false,
    });

    expect(accountRow(id)?.is_budget_account).toBe(0);
    const txn = startingBalanceTxn(id);
    expect(txn?.category_id).toBe(STARTING_BALANCE_CATEGORY_ID);
    expect(txn?.amount).toBe(500);

    const rta = await computeRta(TEST_MONTH);
    expect(rta).toBe(0);
  });

  it("defaults to on-budget when onBudget is omitted (regression guard)", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");

    const id = await createAccount({
      name: "Checking",
      type: "checking",
      currentBalance: 200,
    });

    expect(accountRow(id)?.is_budget_account).toBe(1);
    expect(startingBalanceTxn(id)?.category_id).toBe(
      READY_TO_ASSIGN_CATEGORY_ID
    );
  });

  it("keeps credit_card accounts on-budget regardless of onBudget=false", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");

    const id = await createAccount({
      name: "Chase",
      type: "credit_card",
      currentBalance: 800,
      onBudget: false,
    });

    // Credit cards always remain on-budget — the AddAccountDialog hides the
    // checkbox; this guard is belt-and-suspenders.
    expect(accountRow(id)?.is_budget_account).toBe(1);
    expect(startingBalanceTxn(id)?.category_id).toBe(
      STARTING_BALANCE_CATEGORY_ID
    );
  });
});
