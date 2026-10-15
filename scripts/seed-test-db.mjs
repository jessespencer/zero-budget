/**
 * Seed an isolated test database for exercising the per-category Auto-assign
 * panel. NEVER touches data/zero.db.
 *
 * Defaults to data/zero-test.db. Set ZERO_DB_PATH to override.
 *
 * Usage:
 *   ZERO_DB_PATH=data/zero-test.db node scripts/seed-test-db.mjs
 *   ZERO_DB_PATH=data/zero-test.db PORT=3002 npm run dev
 */

import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";
const READY_TO_ASSIGN_CATEGORY_ID = "ba1a7c00-0000-4000-8000-000000000004";

const dbPath =
  process.env.ZERO_DB_PATH ?? path.join(process.cwd(), "data", "zero-test.db");

if (dbPath.endsWith("zero.db")) {
  console.error(
    "Refusing to seed into zero.db. Set ZERO_DB_PATH to a different file (default: data/zero-test.db)."
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Migrations (replicates lib/migrations/runner.ts) ─────────────────

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
const migrations = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ version: parseInt(f.match(/^(\d+)/)[1], 10), filename: f }))
  .sort((a, b) => a.version - b.version);

for (const m of migrations.filter((m) => m.version > currentVersion)) {
  const sql = fs.readFileSync(path.join(migrationsDir, m.filename), "utf-8");
  db.transaction(() => {
    db.exec(sql);
    db.prepare(
      "INSERT INTO schema_migrations (version, name) VALUES (?, ?)"
    ).run(m.version, m.filename);
  })();
  console.log("applied:", m.filename);
}

// ── Wipe user data (preserve system rows from migrations) ────────────

db.transaction(() => {
  db.prepare("DELETE FROM transaction_splits").run();
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM monthly_budgets").run();
  db.prepare("DELETE FROM targets").run();
  db.prepare("DELETE FROM payees WHERE user_id = ?").run(DEFAULT_USER_ID);
  db.prepare("DELETE FROM net_worth_snapshots").run();
  db.prepare("DELETE FROM accounts WHERE user_id = ?").run(DEFAULT_USER_ID);
  db.prepare(
    "DELETE FROM categories WHERE user_id = ? AND id NOT IN (SELECT id FROM categories WHERE category_group_id IN (SELECT id FROM category_groups WHERE is_system = 1))"
  ).run(DEFAULT_USER_ID);
  db.prepare(
    "DELETE FROM category_groups WHERE user_id = ? AND is_system = 0"
  ).run(DEFAULT_USER_ID);
})();

// ── Helpers ──────────────────────────────────────────────────────────

const uuid = () => crypto.randomUUID();
const MONTH = {
  feb: "2026-02-01",
  mar: "2026-03-01",
  apr: "2026-04-01",
  may: "2026-05-01",
};

function insertAccount({ id = uuid(), name, type, balance }) {
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, current_balance, is_budget_account)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).run(id, DEFAULT_USER_ID, name, type, balance);
  return id;
}

let groupSort = 0;
function insertGroup(name, { isIncome = false } = {}) {
  const id = uuid();
  db.prepare(
    `INSERT INTO category_groups (id, user_id, name, sort_order, is_income)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, DEFAULT_USER_ID, name, groupSort++, isIncome ? 1 : 0);
  return id;
}

let catSort = 0;
function insertCategory(groupId, name) {
  const id = uuid();
  db.prepare(
    `INSERT INTO categories (id, category_group_id, user_id, name, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, groupId, DEFAULT_USER_ID, name, catSort++);
  return id;
}

function insertTarget(categoryId, { type, amount, date = null, monthly = null }) {
  db.prepare(
    `INSERT INTO targets (id, user_id, category_id, type, target_amount, target_date, monthly_contribution)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(uuid(), DEFAULT_USER_ID, categoryId, type, amount, date, monthly);
}

function assign(categoryId, month, amount) {
  if (amount === 0) return;
  db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  ).run(uuid(), DEFAULT_USER_ID, categoryId, month, amount);
}

// `amount` is signed: outflows negative, inflows positive.
function txn(accountId, date, payee, amount, categoryId) {
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, cleared, approved)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`
  ).run(uuid(), DEFAULT_USER_ID, accountId, date, payee, amount, categoryId);
}

// ── Seed ─────────────────────────────────────────────────────────────

const account = insertAccount({
  name: "Test Checking",
  type: "checking",
  balance: 5000,
});

const billsGroup = insertGroup("Monthly bills");
const spendingGroup = insertGroup("Spending");
const goalsGroup = insertGroup("Goals");

// Cat A: Groceries — monthly_funding target, full history, current = $0.
//   exercises Underfunded ($400), last-month ($400 / $420), avg ($400 / $400)
const groceries = insertCategory(billsGroup, "Groceries");
insertTarget(groceries, { type: "monthly_funding", amount: 400 });
assign(groceries, MONTH.feb, 400);
assign(groceries, MONTH.mar, 400);
assign(groceries, MONTH.apr, 400);
txn(account, "2026-02-15", "Trader Joe's", -380, groceries);
txn(account, "2026-03-15", "Trader Joe's", -380, groceries);
txn(account, "2026-04-15", "Whole Foods", -420, groceries);

// Cat B: Gas — NO target, overspent this month → exercises the new
// underfunded fallback ($200 to cover overspending).
const gas = insertCategory(billsGroup, "Gas");
txn(account, "2026-03-10", "Costco Gas", -120, gas);
txn(account, "2026-04-10", "Costco Gas", -150, gas);
txn(account, "2026-05-05", "Costco Gas", -200, gas);

// Cat C: Dining out — NO target, varying spend, NOT overspent now.
//   exercises Avg assigned/spent with non-trivial numbers.
const dining = insertCategory(spendingGroup, "Dining out");
assign(dining, MONTH.feb, 200);
assign(dining, MONTH.mar, 200);
assign(dining, MONTH.apr, 250);
assign(dining, MONTH.may, 100);
txn(account, "2026-02-20", "Chipotle", -180, dining);
txn(account, "2026-03-20", "Chipotle", -180, dining);
txn(account, "2026-04-20", "Sushi Hana", -240, dining);
txn(account, "2026-05-03", "Local Cafe", -80, dining);

// Cat D: Vacation — target_by_date $1200 by Dec 2026, partial funding.
//   exercises Underfunded via target_by_date with a long horizon.
const vacation = insertCategory(goalsGroup, "Vacation");
insertTarget(vacation, {
  type: "target_by_date",
  amount: 1200,
  date: "2026-12-01",
});
assign(vacation, MONTH.feb, 100);
assign(vacation, MONTH.mar, 100);
assign(vacation, MONTH.apr, 100);

// Cat E: Subscriptions — monthly target $50, fully funded.
//   Underfunded row HIDDEN. Other rows still useful (all $50).
const subs = insertCategory(billsGroup, "Subscriptions");
insertTarget(subs, { type: "monthly_funding", amount: 50 });
assign(subs, MONTH.feb, 50);
assign(subs, MONTH.mar, 50);
assign(subs, MONTH.apr, 50);
assign(subs, MONTH.may, 50);
txn(account, "2026-02-01", "Netflix", -50, subs);
txn(account, "2026-03-01", "Netflix", -50, subs);
txn(account, "2026-04-01", "Netflix", -50, subs);
txn(account, "2026-05-01", "Netflix", -50, subs);

// Income — bump Ready to Assign so there's money to play with.
txn(account, "2026-02-01", "Salary", 3000, READY_TO_ASSIGN_CATEGORY_ID);
txn(account, "2026-03-01", "Salary", 3000, READY_TO_ASSIGN_CATEGORY_ID);
txn(account, "2026-04-01", "Salary", 3000, READY_TO_ASSIGN_CATEGORY_ID);
txn(account, "2026-05-01", "Salary", 3000, READY_TO_ASSIGN_CATEGORY_ID);

console.log("\nDB:", dbPath);
console.log(
  "Counts:",
  db.prepare("SELECT (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM categories) AS categories, (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM monthly_budgets) AS monthly_budgets, (SELECT COUNT(*) FROM targets) AS targets").get()
);
console.log(
  "\nNext: ZERO_DB_PATH=" + dbPath + " PORT=3002 npm run dev"
);
