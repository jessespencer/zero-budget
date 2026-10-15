import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import {
  applyToBalance,
  applyPostingToBalance,
  __resetCutoffCache,
} from "@/lib/balance";

const USER_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_CUTOFF = "2026-05-01"; // matches DEFAULT_BUDGET_START_MONTH

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  __resetCutoffCache();
});

afterEach(() => {
  clearTestDb();
  __resetCutoffCache();
  db.close();
});

const seedAccount = (id: string, balance: number) => {
  const ts = "2026-01-01T00:00:00.000Z";
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, ?, 'checking', 1, 0, ?, 0, 0, ?, ?)`
  ).run(id, USER_ID, `Acct ${id}`, balance, ts, ts);
};

const readBalance = (id: string): number | undefined => {
  const row = db
    .prepare("SELECT current_balance FROM accounts WHERE id = ?")
    .get(id) as { current_balance: number } | undefined;
  return row?.current_balance;
};

describe("lib/balance — applyToBalance gate", () => {
  it("pre-cutoff date + positive amount → no change", () => {
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: "2026-04-30", amount: 50, approved: true });
    expect(readBalance("a")).toBe(1000);
  });

  it("pre-cutoff date + negative amount → no change", () => {
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: "2026-04-30", amount: -50, approved: true });
    expect(readBalance("a")).toBe(1000);
  });

  it("post-cutoff date + positive amount → balance increased by amount", () => {
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: "2026-06-15", amount: 50, approved: true });
    expect(readBalance("a")).toBe(1050);
  });

  it("post-cutoff date + negative amount → balance decreased by |amount|", () => {
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: "2026-06-15", amount: -75, approved: true });
    expect(readBalance("a")).toBe(925);
  });

  it("date == cutoff is treated as post-cutoff (inclusive)", () => {
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: DEFAULT_CUTOFF, amount: 100, approved: true });
    expect(readBalance("a")).toBe(1100);
  });

  it("pair: reverse old (post-cutoff, -amount) + apply new (pre-cutoff, +amount) — new leg is gated out", () => {
    // Simulates "moved a May txn to April": the original $200 May txn is
    // reversed (-200 post-cutoff applies), the new April leg is gated out.
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: "2026-05-15", amount: -200, approved: true });
    applyToBalance(db, { account_id: "a", date: "2026-04-15", amount: 200, approved: true });
    expect(readBalance("a")).toBe(800);
  });

  it("pair: reverse old (pre-cutoff, -amount) + apply new (post-cutoff, +amount) — only new leg applies", () => {
    // Simulates "moved an April txn to May": the April reversal is gated out,
    // the new May leg applies.
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: "2026-04-15", amount: -200, approved: true });
    applyToBalance(db, { account_id: "a", date: "2026-05-15", amount: 200, approved: true });
    expect(readBalance("a")).toBe(1200);
  });

  it("custom cutoff via app_settings: with cache reset, new cutoff is honored", () => {
    seedAccount("a", 1000);
    // First call uses default cutoff (2026-05-01) — June txn applies.
    applyToBalance(db, { account_id: "a", date: "2026-06-15", amount: 100, approved: true });
    expect(readBalance("a")).toBe(1100);

    // Override the cutoff to 2026-07-01 and reset the cache.
    db.prepare(
      `UPDATE app_settings SET value = '2026-07-01' WHERE key = 'budget_start_month'`
    ).run();
    __resetCutoffCache();

    // Now a 2026-06-15 txn is pre-cutoff and should be gated out.
    applyToBalance(db, { account_id: "a", date: "2026-06-15", amount: 100, approved: true });
    expect(readBalance("a")).toBe(1100);

    // A 2026-07-15 txn should still apply.
    applyToBalance(db, { account_id: "a", date: "2026-07-15", amount: 50, approved: true });
    expect(readBalance("a")).toBe(1150);
  });
});

describe("lib/balance — approval gate", () => {
  it("unapproved row → no change, even post-cutoff", () => {
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: "2026-06-15", amount: -50, approved: false });
    expect(readBalance("a")).toBe(1000);
  });

  it("accepts the raw 0/1 column value a SELECT hands back", () => {
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: "2026-06-15", amount: -50, approved: 0 });
    expect(readBalance("a")).toBe(1000);
    applyToBalance(db, { account_id: "a", date: "2026-06-15", amount: -50, approved: 1 });
    expect(readBalance("a")).toBe(950);
  });

  it("both gates must pass — unapproved AND pre-cutoff is still a no-op", () => {
    seedAccount("a", 1000);
    applyToBalance(db, { account_id: "a", date: "2026-04-15", amount: -50, approved: false });
    expect(readBalance("a")).toBe(1000);
  });

  it("applyPostingToBalance moves a held amount despite the row being unapproved", () => {
    // The approve/unapprove transition: the row is still approved = 0 at the
    // moment the amount enters the balance.
    seedAccount("a", 1000);
    applyPostingToBalance(db, { account_id: "a", date: "2026-06-15", amount: -50 });
    expect(readBalance("a")).toBe(950);
  });

  it("applyPostingToBalance still respects the cutoff", () => {
    seedAccount("a", 1000);
    applyPostingToBalance(db, { account_id: "a", date: "2026-04-15", amount: -50 });
    expect(readBalance("a")).toBe(1000);
  });
});
