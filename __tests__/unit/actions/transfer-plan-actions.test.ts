import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";

const USER_ID = "00000000-0000-0000-0000-000000000000";
const MONTH = "2026-05-01";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 1, 0, 0, 0)`
  ).run("acct-1", USER_ID, "Checking", "checking");
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 1, 0, 1, 0)`
  ).run("acct-2", USER_ID, "Savings", "savings");
});

afterEach(() => {
  clearTestDb();
  db.close();
  vi.restoreAllMocks();
});

const rows = () =>
  db.prepare(`SELECT * FROM transfer_plan_actuals ORDER BY account_id`).all() as {
    month: string;
    account_id: string;
    actual_balance: number;
  }[];

// The only mutation the transfer-plan page owns outright, and it had no action
// coverage at all. The component tier proves the call site acknowledges the
// result; this proves the row that lands is correct.
describe("saveTransferPlanActual", () => {
  it("inserts a row for a new (month, account) pair", async () => {
    const { saveTransferPlanActual } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await saveTransferPlanActual(MONTH, "acct-1", 1234.56);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      month: MONTH,
      account_id: "acct-1",
      actual_balance: 1234.56,
    });
  });

  // The ON CONFLICT upsert. Without it a month's actuals would accumulate a
  // row per keystroke-commit and getTransferPlanActuals would return whichever
  // one the query happened to reach first.
  it("updates in place rather than duplicating on a second save", async () => {
    const { saveTransferPlanActual } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await saveTransferPlanActual(MONTH, "acct-1", 100);
    await saveTransferPlanActual(MONTH, "acct-1", 250);

    expect(rows()).toHaveLength(1);
    expect(rows()[0].actual_balance).toBe(250);
  });

  it("keeps accounts and months independent", async () => {
    const { saveTransferPlanActual } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await saveTransferPlanActual(MONTH, "acct-1", 100);
    await saveTransferPlanActual(MONTH, "acct-2", 200);
    await saveTransferPlanActual("2026-06-01", "acct-1", 300);

    expect(rows()).toHaveLength(3);
  });

  it("rounds to cents rather than storing float drift", async () => {
    const { saveTransferPlanActual } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await saveTransferPlanActual(MONTH, "acct-1", 0.1 + 0.2);

    expect(rows()[0].actual_balance).toBe(0.3);
  });

  it("stores a negative balance unchanged, for credit cards", async () => {
    const { saveTransferPlanActual } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await saveTransferPlanActual(MONTH, "acct-1", -1245.13);

    expect(rows()[0].actual_balance).toBe(-1245.13);
  });

  // These are the throws the component's catch exists for.
  describe("rejects input it cannot store", () => {
    it("throws on a non-finite balance", async () => {
      const { saveTransferPlanActual } = await import(
        "@/app/(app)/transfer-plan/actions"
      );
      await expect(
        saveTransferPlanActual(MONTH, "acct-1", Number.NaN)
      ).rejects.toThrow();
      await expect(
        saveTransferPlanActual(MONTH, "acct-1", Number.POSITIVE_INFINITY)
      ).rejects.toThrow();
      expect(rows()).toHaveLength(0);
    });

    it("throws on a missing month or account", async () => {
      const { saveTransferPlanActual } = await import(
        "@/app/(app)/transfer-plan/actions"
      );
      await expect(saveTransferPlanActual("", "acct-1", 10)).rejects.toThrow();
      await expect(saveTransferPlanActual(MONTH, "", 10)).rejects.toThrow();
      expect(rows()).toHaveLength(0);
    });
  });
});

// CLAUDE.md: "revalidatePath after every mutation". The other nine mutations in
// this file comply; this one didn't. It isn't cosmetic: nothing invalidates the
// Router Cache entry for /transfer-plan, so a back/forward navigation remounts
// TransferPlanClient from the pre-save RSC payload and re-seeds `actualBalances`
// (a useState initializer, never synced from props) with the balance the user
// already overwrote.
describe("saveTransferPlanActual — cache invalidation", () => {
  it("revalidates /transfer-plan, the only route that reads the actuals", async () => {
    const { revalidatePath } = await import("next/cache");
    vi.mocked(revalidatePath).mockClear();

    const { saveTransferPlanActual } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await saveTransferPlanActual(MONTH, "acct-1", 1234.56);

    expect(revalidatePath).toHaveBeenCalledWith("/transfer-plan");
  });

  // Guards the ordering: revalidating before the insert would advertise a write
  // that never happened.
  it("does not revalidate when the input is rejected", async () => {
    const { revalidatePath } = await import("next/cache");
    vi.mocked(revalidatePath).mockClear();

    const { saveTransferPlanActual } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await expect(
      saveTransferPlanActual(MONTH, "acct-1", Number.NaN)
    ).rejects.toThrow();

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// The forward action revalidates /budget on purpose — the budget header's
// "Credit card debt" indicator sums credit_card current_balance. Undo moves the
// same balance back, so it owes the same invalidation; without it the indicator
// keeps showing the adjusted figure after the undo.
describe("undoBalanceAdjustment — cache invalidation", () => {
  it("revalidates the same paths its forward action does", async () => {
    const { revalidatePath } = await import("next/cache");
    const {
      updateAccountBalanceWithSnapshot,
      undoBalanceAdjustment,
    } = await import("@/app/(app)/transfer-plan/actions");

    const snapshot = await updateAccountBalanceWithSnapshot("acct-1", 500);

    vi.mocked(revalidatePath).mockClear();
    await undoBalanceAdjustment(snapshot);

    for (const path of MONEY_PAGES) {
      expect(revalidatePath).toHaveBeenCalledWith(...path);
    }
  });
});

// Every page that renders the money these actions move. They all used to pass
// "/" and nothing else, which names no payload — app/page.tsx is a bare
// redirect to /budget. Note "/accounts" is absent on purpose: there is no such
// route, so asking for it would be the same mistake in a different costume.
const MONEY_PAGES: [string, ("page" | "layout")?][] = [
  ["/transactions"],
  ["/budget"],
  ["/transfer-plan"],
  ["/insights"],
  ["/accounts/[id]", "page"],
];

// The four actions that write real transactions and move two account balances.
// Each is exercised through its own entry point rather than asserting on the
// helper, so a call site that forgets to invalidate still fails here.
describe("transfer pair actions — cache invalidation", () => {
  async function recordPair() {
    const { createTransferPairWithSnapshot } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    return createTransferPairWithSnapshot({
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      amount: 250,
      date: "2026-05-15",
      source: "desktop",
    });
  }

  it("invalidates every money page when a pair is recorded", async () => {
    const { revalidatePath } = await import("next/cache");
    vi.mocked(revalidatePath).mockClear();

    await recordPair();

    for (const path of MONEY_PAGES) {
      expect(revalidatePath).toHaveBeenCalledWith(...path);
    }
  });

  it("invalidates on undo and redo of a recorded pair", async () => {
    const { revalidatePath } = await import("next/cache");
    const { undoTransferPair, redoTransferPair } = await import(
      "@/app/(app)/transfer-plan/actions"
    );

    const snapshot = await recordPair();

    vi.mocked(revalidatePath).mockClear();
    await undoTransferPair(snapshot);
    for (const path of MONEY_PAGES) {
      expect(revalidatePath).toHaveBeenCalledWith(...path);
    }

    vi.mocked(revalidatePath).mockClear();
    await redoTransferPair(snapshot);
    for (const path of MONEY_PAGES) {
      expect(revalidatePath).toHaveBeenCalledWith(...path);
    }
  });

  // The bare "/" these used to pass is the regression this guards: it invalidated
  // nothing on its own and only worked through Next's blanket Router Cache sweep.
  it("no longer asks for the payload-less root path", async () => {
    const { revalidatePath } = await import("next/cache");
    vi.mocked(revalidatePath).mockClear();

    await recordPair();

    expect(revalidatePath).not.toHaveBeenCalledWith("/");
  });
});

describe("transfer pair memo", () => {
  const memos = () =>
    db
      .prepare(`SELECT memo FROM transactions WHERE transfer_account_id IS NOT NULL ORDER BY amount`)
      .all() as { memo: string | null }[];

  async function recordPair(memo?: string) {
    const { createTransferPairWithSnapshot } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    return createTransferPairWithSnapshot({
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      amount: 250,
      date: "2026-05-15",
      memo,
    });
  }

  it("writes the note to both legs of the pair", async () => {
    await recordPair("  Vacation fund  ");

    expect(memos()).toEqual([{ memo: "Vacation fund" }, { memo: "Vacation fund" }]);
  });

  it("stores no memo when the note is blank", async () => {
    await recordPair("   ");

    expect(memos()).toEqual([{ memo: null }, { memo: null }]);
  });

  it("keeps the note through undo and redo", async () => {
    const { undoTransferPair, redoTransferPair } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    const snapshot = await recordPair("Vacation fund");

    await undoTransferPair(snapshot);
    expect(memos()).toEqual([]);

    const redone = await redoTransferPair(snapshot);
    expect(memos()).toEqual([{ memo: "Vacation fund" }, { memo: "Vacation fund" }]);
    expect(redone.memo).toBe("Vacation fund");
  });
});

describe("getTransferPlanActuals", () => {
  it("returns only the requested month, keyed by account", async () => {
    const { saveTransferPlanActual, getTransferPlanActuals } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    await saveTransferPlanActual(MONTH, "acct-1", 100);
    await saveTransferPlanActual(MONTH, "acct-2", 200);
    await saveTransferPlanActual("2026-06-01", "acct-1", 999);

    expect(await getTransferPlanActuals(MONTH)).toEqual({
      "acct-1": 100,
      "acct-2": 200,
    });
  });

  // The fallback path the page relies on: no row means "use
  // account.current_balance", which is also what a failed save must leave
  // behind rather than a persisted phantom.
  it("returns an empty map for a month with no saved actuals", async () => {
    const { getTransferPlanActuals } = await import(
      "@/app/(app)/transfer-plan/actions"
    );
    expect(await getTransferPlanActuals("2027-01-01")).toEqual({});
  });
});
