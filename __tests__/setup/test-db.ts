import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

/**
 * Create a fresh in-memory SQLite database with all migrations applied.
 * Each call returns an isolated database — safe for parallel test execution.
 */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Apply migrations in order
  const migrationsDir = path.join(process.cwd(), "lib", "migrations", "files");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Create schema_migrations table first (mirrors runner.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    const match = file.match(/^(\d+)/);
    const version = match ? parseInt(match[1], 10) : 0;

    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(version, file);
  }

  // Migration 030 starts an empty database in the current month, which would
  // make every fixture dated in 2026 depend on when the suite runs. Pin the
  // cutover the fixtures were written against; tests that need a different
  // one still override it.
  db.prepare("UPDATE app_settings SET value = '2026-05-01' WHERE key = 'budget_start_month'").run();

  return db;
}

/**
 * Install a test database on globalThis so that `getDb()` returns it.
 * Call this in beforeEach to ensure server actions use the test database.
 */
export function setTestDb(db: Database.Database): void {
  (globalThis as Record<string, unknown>).__zero_db = db;
}

/**
 * Clear the test database from globalThis.
 */
export function clearTestDb(): void {
  delete (globalThis as Record<string, unknown>).__zero_db;
}
