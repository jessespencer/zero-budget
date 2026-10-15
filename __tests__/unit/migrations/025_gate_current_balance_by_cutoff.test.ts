import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Build a SQLite DB with migrations 001-024 applied (everything PRIOR to
 * migration 025 under test). The test then seeds accounts + transactions
 * and applies migration 025 explicitly to verify the rebuild behavior.
 *
 * Quick task 260603-bdb. Modeled on 016_fix_credit_card_balance_sign.test.ts.
 */
function buildDbAtMigration024(): Database.Database {
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
      return m ? parseInt(m[1], 10) <= 24 : false;
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

function applyMigration025(db: Database.Database): void {
  const sql = fs.readFileSync(
    path.join(
      process.cwd(),
      "lib",
      "migrations",
      "files",
      "025_gate_current_balance_by_cutoff.sql"
    ),
    "utf-8"
  );
  db.exec(sql);
  db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
    25,
    "025_gate_current_balance_by_cutoff.sql"
  );
}

const seedAccount = (
  db: Database.Database,
  args: { id: string; balance: number; type?: string; isDebt?: number }
) => {
  const ts = "2026-01-01T00:00:00.000Z";
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, 0, 0, ?, ?)`
  ).run(
    args.id,
    USER_ID,
    `Acct ${args.id}`,
    args.type ?? "checking",
    args.isDebt ?? 0,
    args.balance,
    ts,
    ts
  );
};

const seedTxn = (
  db: Database.Database,
  args: { id: string; account_id: string; date: string; amount: number }
) => {
  const ts = "2026-01-01T00:00:00.000Z";
  db.prepare(
    `INSERT INTO transactions (id, user_id, date, payee, amount, account_id, category_id, cleared, approved, is_split_parent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 0, ?, ?)`
  ).run(args.id, USER_ID, args.date, "Test", args.amount, args.account_id, ts, ts);
};

const readBalance = (db: Database.Database, id: string): number | undefined => {
  const row = db
    .prepare("SELECT current_balance FROM accounts WHERE id = ?")
    .get(id) as { current_balance: number } | undefined;
  return row?.current_balance;
};

let db: Database.Database;

beforeEach(() => {
  db = buildDbAtMigration024();
});

afterEach(() => {
  db.close();
});

describe("migration 025: gate_current_balance_by_cutoff", () => {
  it("rebuilds current_balance to 0 for accounts with only pre-cutoff transactions", () => {
    // Default cutoff is 2026-05-01 (seeded by migration 019).
    seedAccount(db, { id: "acct-pre", balance: 999.99 });
    seedTxn(db, { id: "t1", account_id: "acct-pre", date: "2026-01-15", amount: 100 });
    seedTxn(db, { id: "t2", account_id: "acct-pre", date: "2026-04-30", amount: -50 });

    applyMigration025(db);

    expect(readBalance(db, "acct-pre")).toBe(0);
  });

  it("rebuilds current_balance to SUM(amount) for accounts with only post-cutoff transactions", () => {
    seedAccount(db, { id: "acct-post", balance: 999.99 });
    seedTxn(db, { id: "t1", account_id: "acct-post", date: "2026-05-01", amount: 100 });
    seedTxn(db, { id: "t2", account_id: "acct-post", date: "2026-05-15", amount: 50 });
    seedTxn(db, { id: "t3", account_id: "acct-post", date: "2026-06-01", amount: -25 });

    applyMigration025(db);

    expect(readBalance(db, "acct-post")).toBe(125);
  });

  it("rebuilds current_balance to SUM of post-cutoff only, ignoring pre-cutoff", () => {
    seedAccount(db, { id: "acct-mixed", balance: 999.99 });
    // Pre-cutoff (ignored)
    seedTxn(db, { id: "t1", account_id: "acct-mixed", date: "2026-01-15", amount: 1000 });
    seedTxn(db, { id: "t2", account_id: "acct-mixed", date: "2026-04-30", amount: -500 });
    // Post-cutoff (counted)
    seedTxn(db, { id: "t3", account_id: "acct-mixed", date: "2026-05-01", amount: 200 });
    seedTxn(db, { id: "t4", account_id: "acct-mixed", date: "2026-05-15", amount: -75 });

    applyMigration025(db);

    expect(readBalance(db, "acct-mixed")).toBe(125);
  });

  it("rebuilds current_balance to 0 for accounts with NO transactions (COALESCE)", () => {
    seedAccount(db, { id: "acct-empty", balance: 123.45 });

    applyMigration025(db);

    expect(readBalance(db, "acct-empty")).toBe(0);
  });

  it("honors a custom cutoff value from app_settings (not a hardcoded date)", () => {
    // Override the default cutoff to 2026-06-01 BEFORE applying migration 025.
    db.prepare(
      `UPDATE app_settings SET value = '2026-06-01' WHERE key = 'budget_start_month'`
    ).run();

    seedAccount(db, { id: "acct-custom", balance: 999.99 });
    // May txns are now pre-cutoff (ignored)
    seedTxn(db, { id: "t1", account_id: "acct-custom", date: "2026-05-01", amount: 1000 });
    seedTxn(db, { id: "t2", account_id: "acct-custom", date: "2026-05-31", amount: 500 });
    // June txns are post-cutoff (counted)
    seedTxn(db, { id: "t3", account_id: "acct-custom", date: "2026-06-01", amount: 100 });
    seedTxn(db, { id: "t4", account_id: "acct-custom", date: "2026-06-15", amount: -20 });

    applyMigration025(db);

    expect(readBalance(db, "acct-custom")).toBe(80);
  });

  it("is idempotent — re-running migration 025 on already-clean data is a no-op", () => {
    seedAccount(db, { id: "acct-idem", balance: 999.99 });
    seedTxn(db, { id: "t1", account_id: "acct-idem", date: "2026-05-15", amount: 200 });
    seedTxn(db, { id: "t2", account_id: "acct-idem", date: "2026-06-15", amount: -50 });

    applyMigration025(db);
    const afterFirst = readBalance(db, "acct-idem");

    // Re-run the SQL (bypass schema_migrations gate — just exec the raw SQL again)
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "lib",
        "migrations",
        "files",
        "025_gate_current_balance_by_cutoff.sql"
      ),
      "utf-8"
    );
    db.exec(sql);

    expect(afterFirst).toBe(150);
    expect(readBalance(db, "acct-idem")).toBe(150);
  });
});
