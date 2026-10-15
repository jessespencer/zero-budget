import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const USER_ID = "00000000-0000-0000-0000-000000000000";
const STARTING_BALANCE_CATEGORY_ID = "ba1a7c00-0000-4000-8000-000000000006";
const STARTING_BALANCE_CATEGORY_GROUP_ID = "ba1a7c00-0000-4000-8000-000000000005";

/**
 * Build a SQLite DB with migrations 001-016 applied (everything PRIOR to
 * migration 017 under test). We deliberately stop short of 017 so the test
 * can seed sentinel rows and then apply 017 explicitly to verify behavior.
 */
function buildDbAtMigration016(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const migrationsDir = path.join(process.cwd(), "lib", "migrations", "files");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => {
      const m = f.match(/^(\d+)/);
      return m ? parseInt(m[1], 10) <= 16 : false;
    })
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    const match = file.match(/^(\d+)/);
    const version = match ? parseInt(match[1], 10) : 0;
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
      version,
      file
    );
  }

  return db;
}

function applyMigration017(db: Database.Database): void {
  const sql = fs.readFileSync(
    path.join(
      process.cwd(),
      "lib",
      "migrations",
      "files",
      "017_starting_balance_category.sql"
    ),
    "utf-8"
  );
  db.exec(sql);
  db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
    17,
    "017_starting_balance_category.sql"
  );
}

const seedAccount = (
  db: Database.Database,
  args: { id: string; type?: string; isDebt?: number }
) => {
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 0, 0, 0, ?, ?)`
  ).run(
    args.id,
    USER_ID,
    `Account ${args.id}`,
    args.type ?? "credit_card",
    args.isDebt ?? 1,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  );
};

const seedTxn = (
  db: Database.Database,
  args: {
    id: string;
    accountId: string;
    categoryId: string | null;
    payee: string;
  }
) => {
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, category_id, date, payee, amount, memo, cleared, approved, created_at, updated_at)
     VALUES (?, ?, ?, ?, '2026-01-01', ?, -100, '', 0, 1, ?, ?)`
  ).run(
    args.id,
    USER_ID,
    args.accountId,
    args.categoryId,
    args.payee,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  );
};

const readTxnCategory = (db: Database.Database, id: string) =>
  db
    .prepare("SELECT category_id FROM transactions WHERE id = ?")
    .get(id) as { category_id: string | null } | undefined;

let db: Database.Database;

beforeEach(() => {
  db = buildDbAtMigration016();
});

afterEach(() => {
  db.close();
});

describe("migration 017: starting_balance_category", () => {
  it("creates the System category_group with is_system=1 and is_income=0", () => {
    applyMigration017(db);

    const group = db
      .prepare(
        "SELECT name, is_income, is_system, sort_order FROM category_groups WHERE id = ?"
      )
      .get(STARTING_BALANCE_CATEGORY_GROUP_ID) as
      | {
          name: string;
          is_income: number;
          is_system: number;
          sort_order: number;
        }
      | undefined;

    expect(group).toBeDefined();
    expect(group?.name).toBe("System");
    expect(group?.is_income).toBe(0);
    expect(group?.is_system).toBe(1);
    expect(group?.sort_order).toBe(2147483645);
  });

  it("creates the 'Category not needed' category in the System group", () => {
    applyMigration017(db);

    const cat = db
      .prepare(
        "SELECT category_group_id, name, archived FROM categories WHERE id = ?"
      )
      .get(STARTING_BALANCE_CATEGORY_ID) as
      | { category_group_id: string; name: string; archived: number }
      | undefined;

    expect(cat).toBeDefined();
    expect(cat?.category_group_id).toBe(STARTING_BALANCE_CATEGORY_GROUP_ID);
    expect(cat?.name).toBe("Category not needed");
    expect(cat?.archived).toBe(0);
  });

  it("backfills NULL→STARTING_BALANCE_CATEGORY_ID only for credit-card starting-balance transactions", () => {
    // Seed two accounts: one debt, one non-debt.
    seedAccount(db, { id: "cc-1", type: "credit_card", isDebt: 1 });
    seedAccount(db, { id: "chk-1", type: "checking", isDebt: 0 });

    // (a) debt account + payee 'Starting balance' + category NULL → SHOULD FLIP
    seedTxn(db, {
      id: "txn-flip",
      accountId: "cc-1",
      categoryId: null,
      payee: "Starting balance",
    });

    // (b) debt account + payee 'Coffee' + category NULL → UNCHANGED
    seedTxn(db, {
      id: "txn-not-starting",
      accountId: "cc-1",
      categoryId: null,
      payee: "Coffee",
    });

    // (c) non-debt account + payee 'Starting balance' + category NULL → UNCHANGED
    seedTxn(db, {
      id: "txn-non-debt",
      accountId: "chk-1",
      categoryId: null,
      payee: "Starting balance",
    });

    // Regression-guard: row with a real category_id stays at that UUID.
    // (FK on transactions.category_id REFERENCES categories(id) — so we have
    // to actually insert a category to satisfy the constraint.)
    const REAL_CATEGORY = "11111111-2222-3333-4444-555555555555";
    const REAL_GROUP = "11111111-2222-3333-4444-555555555556";
    db.prepare(
      `INSERT INTO category_groups (id, user_id, name, sort_order, is_income, is_system, created_at, updated_at)
       VALUES (?, ?, 'Misc', 0, 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run(REAL_GROUP, USER_ID);
    db.prepare(
      `INSERT INTO categories (id, category_group_id, user_id, name, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, 'Real', 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run(REAL_CATEGORY, REAL_GROUP, USER_ID);
    seedTxn(db, {
      id: "txn-has-category",
      accountId: "cc-1",
      categoryId: REAL_CATEGORY,
      payee: "Starting balance",
    });

    applyMigration017(db);

    expect(readTxnCategory(db, "txn-flip")?.category_id).toBe(
      STARTING_BALANCE_CATEGORY_ID
    );
    expect(readTxnCategory(db, "txn-not-starting")?.category_id).toBeNull();
    expect(readTxnCategory(db, "txn-non-debt")?.category_id).toBeNull();
    expect(readTxnCategory(db, "txn-has-category")?.category_id).toBe(REAL_CATEGORY);
  });
});
