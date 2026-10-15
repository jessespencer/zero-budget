// One-off: apply pending migrations to the resolved DB using the same logic as
// lib/migrations/runner.ts (backup → apply-in-transaction → record). Use when a
// long-running dev server predates a new migration file. Safe to re-run: only
// versions greater than MAX(schema_migrations.version) are applied.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const dbPath = process.env.ZERO_DB_PATH || path.join(process.cwd(), "data", "zero.db");
if (!fs.existsSync(dbPath)) {
  console.error(`[migrate] DB not found at ${dbPath}`);
  process.exit(1);
}

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

const currentVersion =
  db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v ?? 0;

const migrationsDir = path.join(process.cwd(), "lib", "migrations", "files");
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => {
    const m = f.match(/^(\d+)/);
    return m ? { version: parseInt(m[1], 10), filename: f } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.version - b.version);

const pending = files.filter((f) => f.version > currentVersion);
if (pending.length === 0) {
  console.log(`[migrate] up to date at v${currentVersion} — nothing to apply`);
  process.exit(0);
}

for (const migration of pending) {
  const backupPath = `${dbPath}.pre-migration-v${migration.version}.backup`;
  try {
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    console.log(`[migrate] backed up to ${backupPath}`);
  } catch {
    /* non-fatal */
  }
  const sql = fs.readFileSync(path.join(migrationsDir, migration.filename), "utf-8");
  const noTransaction = /^\s*--\s*@no-transaction\b/m.test(sql);
  if (noTransaction) {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
      migration.version,
      migration.filename
    );
  } else {
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.filename
      );
    })();
  }
  console.log(`[migrate] applied ${migration.filename}`);
}
console.log("[migrate] done");
