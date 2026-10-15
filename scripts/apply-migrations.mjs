#!/usr/bin/env node
// Apply pending migrations to a SQLite DB (default: data/zero.db). Mirrors
// lib/migrations/runner.ts. Idempotent — re-running is a no-op once the DB is
// up to date.
//
// Use this when you want to apply a new migration to the dev DB without
// booting `next dev`. Production deploys still run the TS runner on app boot.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath =
  process.env.ZERO_DB_PATH ?? path.join(process.cwd(), "data", "zero.db");

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
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
  console.log(`[apply-migrations] DB at version ${currentVersion} — no pending migrations.`);
  process.exit(0);
}

for (const migration of pending) {
  const backupPath = `${dbPath}.pre-migration-v${migration.version}.backup`;
  try {
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  } catch {
    /* empty DB or backup write failure — keep going; migration is still wrapped */
  }

  const sql = fs.readFileSync(path.join(migrationsDir, migration.filename), "utf-8");
  const noTransaction = /^\s*--\s*@no-transaction\b/m.test(sql);

  try {
    if (noTransaction) {
      try {
        db.exec(sql);
      } catch (err) {
        try { db.exec("ROLLBACK"); } catch { /* not in txn */ }
        try { db.exec("PRAGMA foreign_keys = ON"); } catch { /* best effort */ }
        throw err;
      }
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.filename
      );
    } else {
      const apply = db.transaction(() => {
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
          migration.version,
          migration.filename
        );
      });
      apply();
    }
    console.log("[apply-migrations] applied:", migration.filename);
  } catch (err) {
    console.error("[apply-migrations] FAILED:", migration.filename, err.message);
    process.exit(1);
  }
}

db.close();
console.log("[apply-migrations] done.");
