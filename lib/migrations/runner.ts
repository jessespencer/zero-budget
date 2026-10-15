import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export function runMigrations(db: Database.Database, dbPath: string): void {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentVersion =
    (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null })
      ?.v ?? 0;

  // Discover migration files
  const migrationsDir = path.join(process.cwd(), "lib", "migrations", "files");
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => {
      const match = f.match(/^(\d+)/);
      return match ? { version: parseInt(match[1], 10), filename: f } : null;
    })
    .filter((f): f is { version: number; filename: string } => f !== null)
    .sort((a, b) => a.version - b.version);

  const pending = files.filter((f) => f.version > currentVersion);
  if (pending.length === 0) return;

  // One snapshot before the batch — enough to roll back the whole upgrade —
  // named for the first migration it protects. A fresh database (nothing
  // applied yet) has nothing to protect: snapshotting before each of its
  // migrations left a new install with a backup file per migration.
  if (currentVersion > 0) {
    const backupPath = `${dbPath}.pre-migration-v${pending[0].version}.backup`;
    try {
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    } catch {
      // If backup fails, continue — each migration is wrapped in a transaction
    }
  }

  for (const migration of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, migration.filename), "utf-8");

    // Migrations that need to toggle PRAGMA foreign_keys (or run their own
    // BEGIN/COMMIT) must opt out of the implicit transaction wrap. SQLite
    // makes `PRAGMA foreign_keys` a no-op inside an open transaction.
    const noTransaction = /^\s*--\s*@no-transaction\b/m.test(sql);

    try {
      if (noTransaction) {
        // Migration manages its own BEGIN/COMMIT. If it throws, ROLLBACK any
        // pending transaction and force foreign_keys back ON so subsequent
        // queries on this connection don't run with FK enforcement disabled.
        try {
          db.exec(sql);
        } catch (err) {
          try { db.exec("ROLLBACK"); } catch { /* not in a transaction */ }
          try { db.exec("PRAGMA foreign_keys = ON"); } catch { /* best effort */ }
          throw err;
        }
        db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
          migration.version,
          migration.filename
        );
      } else {
        const applyMigration = db.transaction(() => {
          db.exec(sql);
          db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
            migration.version,
            migration.filename
          );
        });
        applyMigration();
      }
      console.log("[zero] applied migration:", migration.filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration ${migration.filename} failed: ${message}`);
    }
  }
}
