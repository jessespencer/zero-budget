import Database from "better-sqlite3";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const MIGRATIONS_DIR = path.join(process.cwd(), "lib", "migrations", "files");
const SEED_SCRIPT = path.join(process.cwd(), "scripts", "seed-dev.mjs");

/**
 * Create a temporary SQLite database with all migrations applied, seeded with
 * the same fixture as `npm run seed:dev` — Wallet, Visa Card, tracked assets,
 * schedules. Specs written against `db:slot seeded` locally see identical data
 * here, so there is one fixture rather than two that drift.
 */
export function createSeededDatabase(): { dbPath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zero-e2e-"));
  const dbPath = path.join(tmpDir, "zero.db");

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    const match = file.match(/^(\d+)/);
    const version = match ? parseInt(match[1], 10) : 0;
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(version, file);
  }
  db.close();

  // ZERO_BACKUP_DIR is dropped so seed-dev's pre-wipe backup lands inside
  // tmpDir and is removed with it, never in a real backups folder.
  const { ZERO_BACKUP_DIR: _ignored, ...inherited } = process.env;
  const env = { ...inherited, ZERO_DB_PATH: dbPath };
  execFileSync(process.execPath, [SEED_SCRIPT], { env, stdio: "ignore" });

  return {
    dbPath,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    },
  };
}
