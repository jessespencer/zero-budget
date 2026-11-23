#!/usr/bin/env node
// scripts/seed-dev.mjs
//
// Wipe the LOCAL dev database and insert a demo household: 4 accounts,
// 22 categories across 9 groups, 13 months of activity ending today, ~$500k
// of tracked assets with a year of daily, market-like history, and 4 upcoming scheduled
// transactions. Dates are relative to today, so the demo never goes stale;
// the same day always produces the same data. The budget is assigned so the
// current month's Ready to assign lands on exactly $0.
//
// SAFETY: refuses to run against the Pi paths AND against any DB path outside
// this repo — except a `zero-e2e-*` dir under the OS temp dir, which is the
// throwaway DB the Playwright harness seeds (__tests__/e2e/fixtures/
// test-database.ts). Backs up the existing DB to data/backups/ before wiping.
// Use `npm run seed:dev`.

import Database from "better-sqlite3";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { seedSampleData } from "../lib/sample-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DB_PATH = resolve(
  process.env.ZERO_DB_PATH ?? join(REPO_ROOT, "data", "zero.db")
);

// Never seed a self-hosted install's live DB: anything under the XDG data dir,
// plus any extra paths listed (colon-separated) in ZERO_PROTECTED_DB_PATHS.
const PROTECTED_DIR = join(homedir(), ".local", "share", "zero") + "/";
const PROTECTED_PATHS = (process.env.ZERO_PROTECTED_DB_PATHS ?? "")
  .split(":")
  .filter(Boolean)
  .map((p) => resolve(p));
if (DB_PATH.startsWith(PROTECTED_DIR) || PROTECTED_PATHS.includes(DB_PATH)) {
  console.error(`Refusing to seed protected database at ${DB_PATH}`);
  process.exit(2);
}
const tmpRoot = realpathSync(tmpdir());
const isE2eTmpDb =
  basename(dirname(DB_PATH)).startsWith("zero-e2e-") &&
  [tmpRoot, tmpdir()].includes(dirname(dirname(DB_PATH)));
if (!DB_PATH.startsWith(REPO_ROOT + "/") && !isE2eTmpDb) {
  console.error(`Refusing to seed DB outside repo: ${DB_PATH}`);
  process.exit(2);
}

// --- backup ---
if (existsSync(DB_PATH)) {
  const backupDir =
    process.env.ZERO_BACKUP_DIR ?? join(dirname(DB_PATH), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `pre-seed-${stamp}.db`);
  copyFileSync(DB_PATH, backupPath);
  console.log(`Backed up existing DB → ${backupPath}`);
} else {
  console.log(`No existing DB at ${DB_PATH}; will create fresh`);
}

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

seedSampleData(db);

// --- summary ---
const count = (sql) => db.prepare(sql).get().c;
const trackedTotal = db.prepare("SELECT COALESCE(SUM(current_value), 0) AS c FROM tracked_assets").get().c;
const liquid = db.prepare(
  "SELECT COALESCE(SUM(current_balance), 0) AS c FROM accounts WHERE archived = 0"
).get().c;
const netWorth = trackedTotal + liquid;

console.log("\nSeed complete:");
console.log(`  Accounts:       ${count("SELECT COUNT(*) c FROM accounts")}`);
console.log(`  Groups:         ${count("SELECT COUNT(*) c FROM category_groups WHERE is_system = 0")}`);
console.log(`  Categories:     ${count("SELECT COUNT(*) c FROM categories WHERE category_group_id NOT IN ('ba1a7c00-0000-4000-8000-000000000001','ba1a7c00-0000-4000-8000-000000000003','ba1a7c00-0000-4000-8000-000000000005')")}`);
console.log(`  Transactions:   ${count("SELECT COUNT(*) c FROM transactions")}`);
console.log(`  Splits:         ${count("SELECT COUNT(*) c FROM transaction_splits")}`);
console.log(`  Budgets:        ${count("SELECT COUNT(*) c FROM monthly_budgets")}`);
console.log(`  Targets:        ${count("SELECT COUNT(*) c FROM targets")}`);
console.log(`  Scheduled:      ${count("SELECT COUNT(*) c FROM scheduled_transactions")}`);
console.log(`  Tracked assets: ${count("SELECT COUNT(*) c FROM tracked_assets")}`);
console.log(`  Asset history:  ${count("SELECT COUNT(*) c FROM tracked_asset_history")}`);

const accountSummary = db
  .prepare("SELECT name, type, current_balance FROM accounts ORDER BY sort_order")
  .all();
console.log("\nAccount balances:");
for (const a of accountSummary) {
  const sign = a.current_balance < 0 ? "-" : " ";
  const abs = Math.abs(a.current_balance).toFixed(2);
  console.log(`  ${sign}$${abs.padStart(10)} ${a.name} (${a.type})`);
}
console.log(`\nLiquid:    $${liquid.toFixed(2)}`);
console.log(`Tracked:   $${trackedTotal.toFixed(2)}`);
console.log(`Net worth: $${netWorth.toFixed(2)}`);

db.close();
