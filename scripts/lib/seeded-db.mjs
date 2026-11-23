// Build a fresh SQLite database at `dbPath`: every migration applied, then the
// seed:dev demo household. Used by the demo server for its template. Mirrors
// __tests__/e2e/fixtures/test-database.ts, which builds the same thing for e2e.
//
// `dbPath` must not exist yet and must sit inside the checkout — seed-dev
// refuses to write anywhere else.

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "lib", "migrations", "files");
const SEED_SCRIPT = join(REPO_ROOT, "scripts", "seed-dev.mjs");

export function buildSeededDb(dbPath) {
  if (existsSync(dbPath)) throw new Error(`Refusing to overwrite ${dbPath}`);

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
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const record = db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)");
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf-8"));
    record.run(parseInt(file.match(/^(\d+)/)?.[1] ?? "0", 10), file);
  }
  db.close();

  // seed-dev backs up the file it is about to wipe — here, the empty migrated
  // one. Point that at a throwaway dir so it never lands in a real backups
  // folder or piles up beside the template.
  const backupDir = mkdtempSync(join(tmpdir(), "zero-seed-backup-"));
  try {
    execFileSync(process.execPath, [SEED_SCRIPT], {
      env: { ...process.env, ZERO_DB_PATH: dbPath, ZERO_BACKUP_DIR: backupDir },
      stdio: "ignore",
    });
  } finally {
    rmSync(backupDir, { recursive: true, force: true });
  }

  // Fold the WAL back in so the template is one self-contained file to copy.
  const seeded = new Database(dbPath);
  seeded.pragma("wal_checkpoint(TRUNCATE)");
  seeded.pragma("journal_mode = DELETE");
  seeded.close();
}
