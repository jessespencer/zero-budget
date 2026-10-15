#!/usr/bin/env node
// Smoke test for migration 013_add_tracked_assets.sql.
//
// Re-implements just enough of lib/migrations/runner.ts inline (as plain JS)
// to apply ALL migration files in order against a fresh temp DB, then
// asserts:
//   - tracked_assets table exists
//   - tracked_asset_history table exists
//   - net_worth_snapshots table is gone
//   - idx_tracked_asset_history_asset_recorded index exists
//   - valid asset_type insert succeeds
//   - invalid asset_type insert (e.g. 'checking') fails with CHECK constraint
//
// Runs from `npm`-aware cwd so `process.cwd()/lib/migrations/files` resolves.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.ZERO_DB_PATH ?? "/tmp/zero-mig-test.db";

// Only auto-wipe a clearly disposable scratch path. Refusing to unlink any
// path that isn't under /tmp/ keeps this script from ever clobbering the
// dev DB (data/zero.db) or a production DB if invoked with a real path.
if (dbPath.startsWith("/tmp/") || dbPath.startsWith("/var/folders/")) {
  try { fs.unlinkSync(dbPath); } catch { /* fresh DB */ }
} else if (!fs.existsSync(dbPath)) {
  // Non-temp path that doesn't exist yet — fine to create.
} // Existing non-temp DB — leave it alone; migration runner is idempotent.

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- migration runner (mirrors lib/migrations/runner.ts) ---------------------

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
  .map((f) => {
    const m = f.match(/^(\d+)/);
    return m ? { version: parseInt(m[1], 10), filename: f } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.version - b.version);

for (const migration of files) {
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
    console.log("[smoke] applied:", migration.filename);
  } catch (err) {
    console.error("FAIL: migration", migration.filename, "→", err.message);
    process.exit(1);
  }
}

// --- assertions --------------------------------------------------------------

const tracked = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='tracked_assets'"
).get();
const hist = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='tracked_asset_history'"
).get();
const snap = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='net_worth_snapshots'"
).all();
const idx = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tracked_asset_history_asset_recorded'"
).get();

if (!tracked) { console.error("FAIL: tracked_assets table missing"); process.exit(1); }
if (!hist)    { console.error("FAIL: tracked_asset_history table missing"); process.exit(1); }
if (snap.length !== 0) { console.error("FAIL: net_worth_snapshots still exists"); process.exit(1); }
if (!idx)     { console.error("FAIL: idx_tracked_asset_history_asset_recorded missing"); process.exit(1); }

// Valid asset_type should succeed
db.prepare(
  "INSERT INTO tracked_assets (id,user_id,name,asset_type,current_value) VALUES (?,?,?,?,?)"
).run("t1", "u", "Crypto stash", "investment", 100);

// Invalid asset_type should fail with CHECK constraint
let checkConstraintFired = false;
try {
  db.prepare(
    "INSERT INTO tracked_assets (id,user_id,name,asset_type,current_value) VALUES (?,?,?,?,?)"
  ).run("t2", "u", "Bad", "checking", 1);
} catch (e) {
  if (/CHECK constraint/.test(String(e))) {
    checkConstraintFired = true;
  } else {
    console.error("FAIL: wrong error for invalid asset_type →", String(e));
    process.exit(1);
  }
}
if (!checkConstraintFired) {
  console.error("FAIL: invalid asset_type 'checking' was accepted");
  process.exit(1);
}

// Cascade check: deleting a parent asset removes its history rows
db.prepare(
  "INSERT INTO tracked_asset_history (id,asset_id,value,recorded_at) VALUES (?,?,?,?)"
).run("h1", "t1", 100, "2026-05-15");
const beforeDelete = db.prepare("SELECT COUNT(*) AS c FROM tracked_asset_history").get().c;
db.prepare("DELETE FROM tracked_assets WHERE id = ?").run("t1");
const afterDelete = db.prepare("SELECT COUNT(*) AS c FROM tracked_asset_history").get().c;
if (beforeDelete !== 1 || afterDelete !== 0) {
  console.error("FAIL: cascade delete didn't remove history rows", { beforeDelete, afterDelete });
  process.exit(1);
}

db.close();
console.log("PASS");
