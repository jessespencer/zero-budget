import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

function seedCategory(id: string) {
  db.prepare(
    "INSERT INTO category_groups (id, user_id, name, sort_order, is_income) VALUES (?, ?, ?, 0, 0)"
  ).run(`grp-${id}`, USER_ID, `Group ${id}`);
  db.prepare(
    "INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived) VALUES (?, ?, ?, ?, 0, 0)"
  ).run(id, USER_ID, `grp-${id}`, `Category ${id}`);
}

function seedPayee(id: string, name: string, defaultCategoryId: string | null = null) {
  db.prepare(
    "INSERT INTO payees (id, user_id, name, default_category_id) VALUES (?, ?, ?, ?)"
  ).run(id, USER_ID, name, defaultCategoryId);
}

function seedTxn(id: string, payee: string) {
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, date, payee, amount)
     VALUES (?, ?, 'acct-1', '2026-04-15', ?, -10)`
  ).run(id, USER_ID, payee);
}

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 1, 0, 0, 0)`
  ).run("acct-1", USER_ID, "Checking", "checking");
});

afterEach(() => {
  clearTestDb();
  db.close();
});

describe("mergePayees", () => {
  it("rewrites loser transactions to the winner name and deletes loser rows", async () => {
    const { mergePayees } = await import("@/app/(app)/transactions/actions");

    seedPayee("p-winner", "Beau Jo's Pizza");
    seedPayee("p-loser", "Beau Joes");
    seedTxn("t-1", "Beau Joes");
    seedTxn("t-2", "Beau Joes");
    seedTxn("t-3", "Beau Jo's Pizza");

    await mergePayees(["p-loser"], "p-winner");

    const losers = db
      .prepare("SELECT id FROM payees WHERE id = ?")
      .all("p-loser");
    expect(losers).toHaveLength(0);

    const winner = db
      .prepare("SELECT name FROM payees WHERE id = ?")
      .get("p-winner") as { name: string };
    expect(winner.name).toBe("Beau Jo's Pizza");

    const payees = db
      .prepare("SELECT payee FROM transactions WHERE user_id = ? ORDER BY id")
      .all(USER_ID) as { payee: string }[];
    expect(payees.map((p) => p.payee)).toEqual([
      "Beau Jo's Pizza",
      "Beau Jo's Pizza",
      "Beau Jo's Pizza",
    ]);
  });

  it("leaves the winner's default_category_id untouched", async () => {
    const { mergePayees } = await import("@/app/(app)/transactions/actions");

    seedCategory("cat-keep");
    seedCategory("cat-drop");
    seedPayee("p-winner", "Winner", "cat-keep");
    seedPayee("p-loser", "Loser", "cat-drop");

    await mergePayees(["p-loser"], "p-winner");

    const winner = db
      .prepare("SELECT default_category_id FROM payees WHERE id = ?")
      .get("p-winner") as { default_category_id: string | null };
    expect(winner.default_category_id).toBe("cat-keep");
  });

  it("is a no-op when the loser list is empty", async () => {
    const { mergePayees } = await import("@/app/(app)/transactions/actions");

    seedPayee("p-winner", "Winner");
    await mergePayees([], "p-winner");

    const count = db
      .prepare("SELECT COUNT(*) as c FROM payees")
      .get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("does not delete the winner even if it appears in the loser list", async () => {
    const { mergePayees } = await import("@/app/(app)/transactions/actions");

    seedPayee("p-winner", "Winner");
    await mergePayees(["p-winner"], "p-winner");

    const winner = db
      .prepare("SELECT id FROM payees WHERE id = ?")
      .get("p-winner");
    expect(winner).toBeDefined();
  });

  it("merges multiple losers at once", async () => {
    const { mergePayees } = await import("@/app/(app)/transactions/actions");

    seedPayee("p-winner", "Costco");
    seedPayee("p-loser-a", "COSTCO WHOLESALE");
    seedPayee("p-loser-b", "Costco Gas");
    seedTxn("t-1", "COSTCO WHOLESALE");
    seedTxn("t-2", "Costco Gas");

    await mergePayees(["p-loser-a", "p-loser-b"], "p-winner");

    const remaining = db
      .prepare("SELECT id FROM payees")
      .all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(["p-winner"]);

    const payees = db
      .prepare("SELECT payee FROM transactions WHERE user_id = ?")
      .all(USER_ID) as { payee: string }[];
    expect(payees.every((p) => p.payee === "Costco")).toBe(true);
  });
});

describe("mergePayeesWithSnapshot + restoreMergePayeesSnapshot", () => {
  it("round-trips to the pre-merge state on restore", async () => {
    const { mergePayeesWithSnapshot, restoreMergePayeesSnapshot } = await import(
      "@/app/(app)/transactions/actions"
    );

    seedCategory("cat-1");
    seedCategory("cat-2");
    seedPayee("p-winner", "Beau Jo's Pizza", "cat-1");
    seedPayee("p-loser", "Beau Joes", "cat-2");
    seedTxn("t-1", "Beau Joes");
    seedTxn("t-2", "Beau Joes");
    seedTxn("t-3", "Beau Jo's Pizza");

    const snapshot = await mergePayeesWithSnapshot(["p-loser"], "p-winner");

    // Snapshot captures the deleted loser row + rewritten transactions.
    expect(snapshot.loserPayees).toEqual([
      { id: "p-loser", name: "Beau Joes", default_category_id: "cat-2" },
    ]);
    expect(snapshot.rewrittenTransactions.map((r) => r.transactionId).sort()).toEqual([
      "t-1",
      "t-2",
    ]);
    expect(
      snapshot.rewrittenTransactions.every((r) => r.originalPayee === "Beau Joes")
    ).toBe(true);

    await restoreMergePayeesSnapshot(snapshot);

    // Loser payee row is back, with its original default category.
    const loser = db
      .prepare("SELECT name, default_category_id FROM payees WHERE id = ?")
      .get("p-loser") as { name: string; default_category_id: string | null };
    expect(loser).toEqual({ name: "Beau Joes", default_category_id: "cat-2" });

    // Rewritten transactions are restored to their original payee.
    const t1 = db.prepare("SELECT payee FROM transactions WHERE id = 't-1'").get() as {
      payee: string;
    };
    const t2 = db.prepare("SELECT payee FROM transactions WHERE id = 't-2'").get() as {
      payee: string;
    };
    const t3 = db.prepare("SELECT payee FROM transactions WHERE id = 't-3'").get() as {
      payee: string;
    };
    expect(t1.payee).toBe("Beau Joes");
    expect(t2.payee).toBe("Beau Joes");
    expect(t3.payee).toBe("Beau Jo's Pizza");
  });
});
