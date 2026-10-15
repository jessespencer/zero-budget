import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Build a SQLite DB with migrations 001-015 applied (everything PRIOR to
 * migration 016 under test). We deliberately stop short of 016 so the test
 * can seed sentinel rows and then apply 016 explicitly to verify behavior.
 */
function buildDbAtMigration015(): Database.Database {
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
      return m ? parseInt(m[1], 10) <= 15 : false;
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

function applyMigration016(db: Database.Database): void {
  const sql = fs.readFileSync(
    path.join(
      process.cwd(),
      "lib",
      "migrations",
      "files",
      "016_fix_credit_card_balance_sign.sql"
    ),
    "utf-8"
  );
  db.exec(sql);
  db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
    16,
    "016_fix_credit_card_balance_sign.sql"
  );
}

const seedAccount = (
  db: Database.Database,
  args: { id: string; balance: number; type?: string; isDebt?: number; updatedAt?: string }
) => {
  const updatedAt = args.updatedAt ?? "2026-01-01T00:00:00.000Z";
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, 0, 0, ?, ?)`
  ).run(
    args.id,
    USER_ID,
    `Card ${args.id}`,
    args.type ?? "credit_card",
    args.isDebt ?? 1,
    args.balance,
    updatedAt,
    updatedAt
  );
};

const readAccount = (db: Database.Database, id: string) =>
  db.prepare("SELECT current_balance, updated_at FROM accounts WHERE id = ?").get(id) as
    | { current_balance: number; updated_at: string }
    | undefined;

let db: Database.Database;

beforeEach(() => {
  db = buildDbAtMigration015();
});

afterEach(() => {
  db.close();
});

describe("migration 016: fix_credit_card_balance_sign", () => {
  it("negates current_balance only for credit_card rows with strictly positive balance", () => {
    seedAccount(db, { id: "cc-positive", balance: 8000 });
    seedAccount(db, { id: "cc-already-negative", balance: -450 });
    seedAccount(db, { id: "cc-zero", balance: 0 });

    applyMigration016(db);

    expect(readAccount(db, "cc-positive")?.current_balance).toBe(-8000);
    expect(readAccount(db, "cc-already-negative")?.current_balance).toBe(-450);
    expect(readAccount(db, "cc-zero")?.current_balance).toBe(0);
  });

  it("refreshes updated_at only on the row that was flipped", () => {
    const seededAt = "2026-01-01T00:00:00.000Z";
    seedAccount(db, { id: "cc-positive", balance: 8000, updatedAt: seededAt });
    seedAccount(db, { id: "cc-already-negative", balance: -450, updatedAt: seededAt });
    seedAccount(db, { id: "cc-zero", balance: 0, updatedAt: seededAt });

    applyMigration016(db);

    expect(readAccount(db, "cc-positive")?.updated_at).not.toBe(seededAt);
    expect(readAccount(db, "cc-already-negative")?.updated_at).toBe(seededAt);
    expect(readAccount(db, "cc-zero")?.updated_at).toBe(seededAt);
  });

  it("does not touch non-debt accounts that happen to have positive balances", () => {
    // Defensive: the migration guards on is_debt = 1, so a checking account
    // with a positive balance must NOT get flipped (would zero out the user's
    // budget). This protects against any future broadening of the predicate.
    db.prepare(
      `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, 'checking', 1, 0, 5000, 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run("chk-positive", USER_ID, "Checking");

    applyMigration016(db);

    const row = db
      .prepare("SELECT current_balance FROM accounts WHERE id = ?")
      .get("chk-positive") as { current_balance: number };
    expect(row.current_balance).toBe(5000);
  });
});
