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
import { randomUUID } from "node:crypto";

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

const USER_ID = "00000000-0000-0000-0000-000000000000";
const READY_TO_ASSIGN_CATEGORY_ID = "ba1a7c00-0000-4000-8000-000000000004";
const CATEGORY_NOT_NEEDED_ID = "ba1a7c00-0000-4000-8000-000000000006";
const SYSTEM_GROUP_IDS = [
  "ba1a7c00-0000-4000-8000-000000000001", // Transfer-plan System
  "ba1a7c00-0000-4000-8000-000000000003", // Inflow
  "ba1a7c00-0000-4000-8000-000000000005", // K43 System
];

const uid = () => randomUUID();
const round = (v) => Math.round(v * 100) / 100;

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

// --- wipe (preserve system rows the migrations seeded) ---
db.transaction(() => {
  db.prepare("DELETE FROM transaction_splits").run();
  db.prepare("DELETE FROM scheduled_transactions").run();
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM monthly_budgets").run();
  db.prepare("DELETE FROM targets").run();
  db.prepare("DELETE FROM tracked_asset_history").run();
  db.prepare("DELETE FROM tracked_assets").run();
  db.prepare("DELETE FROM transfer_plan_actuals").run();
  db.prepare("DELETE FROM payees").run();

  const placeholders = SYSTEM_GROUP_IDS.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM categories WHERE category_group_id NOT IN (${placeholders})`
  ).run(...SYSTEM_GROUP_IDS);

  db.prepare(
    "DELETE FROM category_groups WHERE is_system = 0 AND is_income = 0"
  ).run();

  db.prepare("DELETE FROM accounts").run();

  // A seeded budget is past first-run setup, so the checklist stays hidden.
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('onboarding_dismissed', '1')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run();
})();

// --- accounts ---
const ACCT = {
  CHECKING: uid(),
  SAVINGS: uid(),
  CASH: uid(),
  CC: uid(),
};
const ACCT_NAME = {
  [ACCT.CHECKING]: "Everyday Checking",
  [ACCT.SAVINGS]: "High Yield Savings",
  [ACCT.CASH]: "Wallet",
  [ACCT.CC]: "Visa Card",
};

const insertAccount = db.prepare(`
  INSERT INTO accounts (
    id, user_id, name, type, current_balance, is_budget_account,
    is_debt, is_primary, sort_order, archived, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, 0, datetime('now'), datetime('now'))
`);
insertAccount.run(ACCT.CHECKING, USER_ID, ACCT_NAME[ACCT.CHECKING], "checking", 0, 1, 0);
insertAccount.run(ACCT.SAVINGS, USER_ID, ACCT_NAME[ACCT.SAVINGS], "savings", 0, 0, 1);
insertAccount.run(ACCT.CASH, USER_ID, ACCT_NAME[ACCT.CASH], "cash", 0, 0, 2);
insertAccount.run(ACCT.CC, USER_ID, ACCT_NAME[ACCT.CC], "credit_card", 1, 0, 3);

// --- dates: everything is relative to today ---
// A fixed window goes stale: months later the app opens on an empty current
// month and the overdue schedules auto-post on load. Instead the window is
// the 12 months before this one plus this month, filled through today.
const TODAY = new Date();
const TODAY_DAY = TODAY.getDate();
const monthKeyOf = (offset) => {
  const dt = new Date(TODAY.getFullYear(), TODAY.getMonth() + offset, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const MONTHS = Array.from({ length: 13 }, (_, i) => monthKeyOf(i - 12));
const CURRENT = MONTHS[MONTHS.length - 1];
const d = (monthKey, day) => `${monthKey}-${String(day).padStart(2, "0")}`;
const calendarMonth = (monthKey) => Number(monthKey.slice(5, 7));
// First date on or after tomorrow that falls on `day` of a month.
const nextOccurrence = (day) => {
  const thisMonth = d(CURRENT, day);
  return day > TODAY_DAY ? thisMonth : d(monthKeyOf(1), day);
};

// Budgeting starts with the window, so every row counts toward Ready to assign.
db.prepare(
  `INSERT INTO app_settings (key, value) VALUES ('budget_start_month', ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
).run(`${MONTHS[0]}-01`);

// --- category groups + categories ---
const GRP = {
  GIVING: uid(),
  HOUSING: uid(),
  TRANSPORT: uid(),
  FOOD: uid(),
  LIFESTYLE: uid(),
  KIDS: uid(),
  SUBS: uid(),
  SAVINGS: uid(),
  ANNUAL: uid(),
};

const insertGroup = db.prepare(`
  INSERT INTO category_groups (
    id, user_id, name, sort_order, is_income, is_system, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))
`);
const groupOrder = [
  [GRP.GIVING, "Giving"],
  [GRP.HOUSING, "Housing"],
  [GRP.TRANSPORT, "Transportation"],
  [GRP.FOOD, "Food"],
  [GRP.LIFESTYLE, "Lifestyle"],
  [GRP.KIDS, "Kids"],
  [GRP.SUBS, "Subscriptions"],
  [GRP.SAVINGS, "Savings goals"],
  [GRP.ANNUAL, "Annual expenses"],
];
groupOrder.forEach(([id, name], i) => insertGroup.run(id, USER_ID, name, i));

const insertCategory = db.prepare(`
  INSERT INTO categories (
    id, category_group_id, user_id, name, sort_order, archived,
    allocation_account_id, is_buffer, pinned_quick, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, datetime('now'), datetime('now'))
`);

// Each category's monthly plan, in funding priority order: bills first,
// savings goals last. `plan` is what a normal month assigns.
const CAT = {};
const cats = [
  ["charity", GRP.GIVING, "Charity", 0, null, 150],
  ["mortgage", GRP.HOUSING, "Mortgage", 0, null, 2100],
  ["utilities", GRP.HOUSING, "Utilities", 1, null, 250],
  ["internet", GRP.HOUSING, "Phone and internet", 2, null, 180],
  ["home_maint", GRP.HOUSING, "Home maintenance", 3, null, 100],
  ["auto_ins", GRP.TRANSPORT, "Auto insurance", 2, null, 180],
  ["gas", GRP.TRANSPORT, "Gas", 0, null, 200],
  ["car_maint", GRP.TRANSPORT, "Car maintenance", 1, null, 50],
  ["groceries", GRP.FOOD, "Groceries", 0, null, 700],
  ["dining", GRP.FOOD, "Dining out", 1, null, 200],
  ["coffee", GRP.FOOD, "Coffee", 2, null, 80],
  ["entertainment", GRP.LIFESTYLE, "Entertainment", 0, null, 100],
  ["personal", GRP.LIFESTYLE, "Personal care", 1, null, 80],
  ["clothing", GRP.LIFESTYLE, "Clothing", 2, null, 60],
  ["kid_act", GRP.KIDS, "Kid activities", 0, null, 150],
  ["kid_misc", GRP.KIDS, "School and supplies", 1, null, 80],
  ["streaming", GRP.SUBS, "Streaming", 0, null, 15],
  ["software", GRP.SUBS, "Software", 1, null, 30],
  ["christmas", GRP.ANNUAL, "Holidays", 0, null, 50],
  ["emergency", GRP.SAVINGS, "Emergency fund", 0, ACCT.SAVINGS, 300],
  ["travel", GRP.SAVINGS, "Travel fund", 1, ACCT.SAVINGS, 200],
  ["home_goal", GRP.SAVINGS, "Home goal", 2, ACCT.SAVINGS, 400],
];
const PLAN = {};
const PRIORITY = [];
for (const [key, group, name, order, alloc, plan] of cats) {
  CAT[key] = uid();
  PLAN[CAT[key]] = plan;
  PRIORITY.push(CAT[key]);
  insertCategory.run(CAT[key], group, USER_ID, name, order, alloc);
}
const SAVINGS_GOALS = [CAT.emergency, CAT.travel, CAT.home_goal];
// Everyday spending categories: past months assign what was actually spent
// (rounded up to $10), so a year of leftovers doesn't pile up in Coffee. Bills
// and sinking funds keep their fixed plan and carry what they don't use.
const SPEND_AS_YOU_GO = new Set([
  CAT.utilities, CAT.gas, CAT.groceries, CAT.dining, CAT.coffee,
  CAT.entertainment, CAT.personal, CAT.kid_act, CAT.kid_misc,
]);

// --- payees ---
const insertPayee = db.prepare(`
  INSERT INTO payees (id, user_id, name, default_category_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
`);
const payeesWithDefault = [
  ["Sunrise Grocery", CAT.groceries],
  ["Roasters Coffee", CAT.coffee],
  ["QuikFill Gas", CAT.gas],
  ["StreamCo", CAT.streaming],
  ["MetroSoft", CAT.software],
  ["City Utility", CAT.utilities],
  ["FiberNet", CAT.internet],
  ["First Bank Mortgage", CAT.mortgage],
  ["Trattoria Bistro", CAT.dining],
  ["SafeDrive Insurance", CAT.auto_ins],
  ["Tune-Up Auto", CAT.car_maint],
  ["Community Food Bank", CAT.charity],
  ["Kids Gym", CAT.kid_act],
  ["Cinema Plus", CAT.entertainment],
  ["Barber Shop", CAT.personal],
  ["Threadworks", CAT.clothing],
  ["Hardware Depot", CAT.home_maint],
  ["Employer", READY_TO_ASSIGN_CATEGORY_ID],
  ["Side Gig", READY_TO_ASSIGN_CATEGORY_ID],
];
for (const [name, defaultCat] of payeesWithDefault) {
  insertPayee.run(uid(), USER_ID, name, defaultCat);
}

// --- transaction helpers ---
// Every write also records its effect per month, so the budget below can be
// computed from what actually happened instead of guessed.
const income = {}; // month -> money into Ready to assign (minus opening card debt)
const activity = {}; // month -> category -> spending (negative)
const addActivity = (date, category, amount) => {
  const m = date.slice(0, 7);
  activity[m] ??= {};
  activity[m][category] = (activity[m][category] ?? 0) + amount;
};

const insertTxn = db.prepare(`
  INSERT INTO transactions (
    id, user_id, account_id, date, payee, memo, amount, category_id,
    transfer_account_id, cleared, approved, is_split_parent, source,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, 'desktop', datetime('now'), datetime('now'))
`);
const txn = (date, account, amount, payee, category, memo = null) => {
  const amt = round(amount);
  insertTxn.run(uid(), USER_ID, account, date, payee, memo, amt, category, null, 0);
  const m = date.slice(0, 7);
  if (category === READY_TO_ASSIGN_CATEGORY_ID) income[m] = (income[m] ?? 0) + amt;
  else if (category === CATEGORY_NOT_NEEDED_ID) income[m] = (income[m] ?? 0) + amt; // opening card debt
  else addActivity(date, category, amt);
};
const splitParent = (date, account, amount, payee) => {
  const id = uid();
  insertTxn.run(id, USER_ID, account, date, payee, null, round(amount), null, null, 1);
  return id;
};
const insertSplit = db.prepare(`
  INSERT INTO transaction_splits (id, parent_transaction_id, category_id, amount, memo, created_at, updated_at)
  VALUES (?, ?, ?, ?, NULL, datetime('now'), datetime('now'))
`);
const split = (date, parentId, category, amount) => {
  insertSplit.run(uid(), parentId, category, round(amount));
  addActivity(date, category, round(amount));
};
const transfer = (date, fromId, toId, amount, memo = null) => {
  const fromName = ACCT_NAME[fromId];
  const toName = ACCT_NAME[toId];
  insertTxn.run(uid(), USER_ID, fromId, date, `Transfer to ${toName}`, memo, round(-amount), null, toId, 0);
  insertTxn.run(uid(), USER_ID, toId, date, `Transfer from ${fromName}`, memo, round(amount), null, fromId, 0);
};

// --- starting balances on the first day of the window ---
const START = d(MONTHS[0], 1);
txn(START, ACCT.CHECKING, 5800, "Starting balance", READY_TO_ASSIGN_CATEGORY_ID);
txn(START, ACCT.SAVINGS, 4500, "Starting balance", READY_TO_ASSIGN_CATEGORY_ID);
txn(START, ACCT.CASH, 180, "Starting balance", READY_TO_ASSIGN_CATEGORY_ID);
txn(START, ACCT.CC, -640, "Starting balance", CATEGORY_NOT_NEEDED_ID);

// --- 13 months of activity ---
// Deterministic per-month variance via the month index; the current month
// stops at today. Seasonal bumps key off the calendar month.
const variance = (i, base, swing) =>
  base + swing * Math.sin(i * 1.7 + 0.3) + swing * 0.3 * Math.cos(i * 0.9);

const generateMonth = (monthKey, i) => {
  const isCurrent = monthKey === CURRENT;
  const allow = (day) => !isCurrent || day <= TODAY_DAY;
  const cal = calendarMonth(monthKey);

  // Income — two paychecks per month + occasional side gig
  if (allow(1)) txn(d(monthKey, 1), ACCT.CHECKING, 4250, "Employer", READY_TO_ASSIGN_CATEGORY_ID, "Paycheck");
  if (allow(15)) txn(d(monthKey, 15), ACCT.CHECKING, 4250, "Employer", READY_TO_ASSIGN_CATEGORY_ID, "Paycheck");
  if (i % 3 === 1 && allow(22)) txn(d(monthKey, 22), ACCT.CHECKING, 380, "Side Gig", READY_TO_ASSIGN_CATEGORY_ID);

  // Fixed bills
  if (allow(1)) txn(d(monthKey, 1), ACCT.CHECKING, -2100, "First Bank Mortgage", CAT.mortgage);
  if (allow(2)) txn(d(monthKey, 2), ACCT.CHECKING, -150, "Community Food Bank", CAT.charity);
  if (allow(5)) txn(d(monthKey, 5), ACCT.CHECKING, round(-variance(i, 245, 35)), "City Utility", CAT.utilities);
  if (allow(15)) txn(d(monthKey, 15), ACCT.CHECKING, -178, "FiberNet", CAT.internet);
  if (allow(18)) txn(d(monthKey, 18), ACCT.CHECKING, -180, "SafeDrive Insurance", CAT.auto_ins);

  // Groceries — five trips through the month
  const groceries = [
    [3, variance(i, 142, 25)],
    [10, variance(i, 118, 20)],
    [17, variance(i, 135, 28)],
    [24, variance(i, 125, 22)],
    [29, variance(i, 95, 18)],
  ];
  for (const [day, amt] of groceries) {
    if (allow(day)) txn(d(monthKey, day), ACCT.CHECKING, -Math.abs(amt), "Sunrise Grocery", CAT.groceries);
  }

  // Gas
  if (allow(4)) txn(d(monthKey, 4), ACCT.CC, round(-variance(i, 48, 8)), "QuikFill Gas", CAT.gas);
  if (allow(19)) txn(d(monthKey, 19), ACCT.CC, round(-variance(i, 52, 8)), "QuikFill Gas", CAT.gas);
  if (allow(28)) txn(d(monthKey, 28), ACCT.CC, round(-variance(i, 45, 7)), "QuikFill Gas", CAT.gas);

  // Coffee / dining
  if (allow(2)) txn(d(monthKey, 2), ACCT.CC, -5.75, "Roasters Coffee", CAT.coffee);
  if (allow(6)) txn(d(monthKey, 6), ACCT.CC, -6.25, "Roasters Coffee", CAT.coffee);
  if (allow(13)) txn(d(monthKey, 13), ACCT.CC, -5.75, "Roasters Coffee", CAT.coffee);
  if (allow(20)) txn(d(monthKey, 20), ACCT.CC, -6.5, "Roasters Coffee", CAT.coffee);
  if (allow(27)) txn(d(monthKey, 27), ACCT.CC, -5.75, "Roasters Coffee", CAT.coffee);
  if (allow(8)) txn(d(monthKey, 8), ACCT.CC, round(-variance(i, 38, 10)), "Trattoria Bistro", CAT.dining);
  if (allow(21)) txn(d(monthKey, 21), ACCT.CC, round(-variance(i, 62, 15)), "Trattoria Bistro", CAT.dining);

  // Lifestyle
  if (allow(11)) txn(d(monthKey, 11), ACCT.CHECKING, round(-variance(i, 72, 18)), "Cinema Plus", CAT.entertainment);
  if (allow(23)) txn(d(monthKey, 23), ACCT.CHECKING, -38, "Barber Shop", CAT.personal);

  // Kids — summer camp bump (Jun-Aug)
  const summer = cal >= 6 && cal <= 8;
  if (allow(7)) txn(d(monthKey, 7), ACCT.CHECKING, summer ? -285 : -125, "Kids Gym", CAT.kid_act);
  if (allow(16)) txn(d(monthKey, 16), ACCT.CHECKING, round(-variance(i, 60, 20)), "Sunrise Grocery", CAT.kid_misc, "School supplies");

  // Subscriptions
  if (allow(12)) txn(d(monthKey, 12), ACCT.CC, -10.99, "StreamCo", CAT.streaming);
  if (allow(14)) txn(d(monthKey, 14), ACCT.CC, -25, "MetroSoft", CAT.software);

  // Card payment + ATM
  if (allow(27)) transfer(d(monthKey, 27), ACCT.CHECKING, ACCT.CC, round(variance(i, 320, 60)), "Credit card payment");
  if (allow(25)) transfer(d(monthKey, 25), ACCT.CHECKING, ACCT.CASH, 80, "ATM withdrawal");

  // Cash spending
  if (allow(9)) txn(d(monthKey, 9), ACCT.CASH, -22.5, "Sunrise Grocery", CAT.groceries);

  // Seasonal one-offs, never in the (partial) current month
  if (isCurrent) return;
  if (cal === 7) txn(d(monthKey, 12), ACCT.CHECKING, -420, "Threadworks", CAT.travel, "Trip kickoff");
  if (cal === 8) txn(d(monthKey, 18), ACCT.CC, -385, "Trattoria Bistro", CAT.travel, "Trip dining");
  if (cal === 12) {
    txn(d(monthKey, 6), ACCT.CC, -240, "Threadworks", CAT.christmas, "Gifts");
    txn(d(monthKey, 14), ACCT.CHECKING, -180, "Sunrise Grocery", CAT.christmas, "Holiday meal");
  }
  if (cal === 3) txn(d(monthKey, 15), ACCT.CHECKING, -340, "Tune-Up Auto", CAT.car_maint, "Brake job");
  if (cal === 4) txn(d(monthKey, 20), ACCT.CHECKING, -180, "Hardware Depot", CAT.home_maint, "Plumbing parts");
  if (cal === 11) txn(d(monthKey, 25), ACCT.CHECKING, -220, "Threadworks", CAT.clothing, "Winter coats");
};

MONTHS.forEach((m, i) => generateMonth(m, i));

// Split demo on last month's first grocery trip
{
  const date = d(MONTHS[MONTHS.length - 2], 8);
  const parentId = splitParent(date, ACCT.CHECKING, -148.0, "Sunrise Grocery");
  split(date, parentId, CAT.groceries, -110.0);
  split(date, parentId, CAT.kid_misc, -38.0);
}

// --- monthly budget assignments ---
// Mirrors how the budget engine computes Ready to assign (income − assigned −
// last month's overspending − opening card debt), month by month:
//   - every category gets enough that its Available never goes negative, so
//     there's no overspending: everyday categories get what they spent in
//     past months, everything else (and the current month) gets its plan;
//   - past months send any surplus beyond a one-month buffer to savings goals,
//     and the buffer rolls forward unassigned, like budgeting next month with
//     this month's money;
//   - the current month funds its plan and puts what's left into the home
//     goal, so Ready to assign lands on exactly $0.
const insertBudget = db.prepare(`
  INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  ON CONFLICT(category_id, month) DO UPDATE SET
    assigned = excluded.assigned, updated_at = datetime('now')
`);
const BUFFER = 6500;
const available = Object.fromEntries(PRIORITY.map((c) => [c, 0]));
const savingsAssigned = {}; // month -> total assigned to savings goals
let pool = 0;
for (const m of MONTHS) {
  pool += income[m] ?? 0;
  const spent = activity[m] ?? {};
  const assigned = {};
  for (const cat of PRIORITY) {
    const cover = -(available[cat] + (spent[cat] ?? 0)); // what keeps Available >= 0
    const target =
      m !== CURRENT && SPEND_AS_YOU_GO.has(cat) ? Math.ceil(Math.max(0, cover) / 10) * 10 : PLAN[cat];
    assigned[cat] = round(Math.max(target, cover));
    pool -= assigned[cat];
  }
  const surplus = m === CURRENT ? pool : pool - BUFFER;
  if (surplus > 0) {
    // Emergency fund until it holds $10k, then the home goal.
    const toEmergency = Math.max(0, Math.min(surplus, 10000 - (available[CAT.emergency] + assigned[CAT.emergency])));
    assigned[CAT.emergency] = round(assigned[CAT.emergency] + toEmergency);
    assigned[CAT.home_goal] = round(assigned[CAT.home_goal] + (surplus - toEmergency));
    pool -= surplus;
  }
  for (const cat of PRIORITY) {
    insertBudget.run(uid(), USER_ID, cat, `${m}-01`, assigned[cat]);
    available[cat] += assigned[cat] + (spent[cat] ?? 0);
  }
  savingsAssigned[m] = SAVINGS_GOALS.reduce((sum, c) => sum + assigned[c], 0);
}
if (Math.round(pool * 100) !== 0) {
  console.error(`Seed bug: Ready to assign should end at $0, got ${pool.toFixed(2)}`);
  process.exit(1);
}

// Move each past month's savings-goal money to the savings account at month
// end, so the transfer plan has only this month's move left to suggest.
let savingsBalance = 4500; // the savings account's starting balance
let savingsOwed = 0;
for (const m of MONTHS.slice(0, -1)) {
  savingsOwed += savingsAssigned[m];
  const move = round(savingsOwed - savingsBalance);
  if (move > 0) {
    transfer(d(m, 28), ACCT.CHECKING, ACCT.SAVINGS, move, "Monthly savings");
    savingsBalance += move;
  }
}

// --- recompute current_balance from transaction sums ---
const balances = db
  .prepare(
    `SELECT account_id, COALESCE(SUM(amount), 0) AS bal
     FROM transactions WHERE user_id = ? GROUP BY account_id`
  )
  .all(USER_ID);
const updateBal = db.prepare(
  "UPDATE accounts SET current_balance = ?, updated_at = datetime('now') WHERE id = ?"
);
for (const row of balances) updateBal.run(round(row.bal), row.account_id);

// --- targets ---
const insertTarget = db.prepare(`
  INSERT INTO targets (
    id, user_id, category_id, type, frequency, target_amount,
    target_date, monthly_contribution, priority, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'))
`);
insertTarget.run(uid(), USER_ID, CAT.travel, "monthly_funding", "monthly", 200, null, 200);
insertTarget.run(uid(), USER_ID, CAT.emergency, "savings_balance", "monthly", 10000, null, null);
insertTarget.run(uid(), USER_ID, CAT.home_goal, "target_by_date", "monthly", 40000, `${TODAY.getFullYear() + 2}-01-01`, null);
insertTarget.run(uid(), USER_ID, CAT.christmas, "monthly_funding", "monthly", 50, null, 50);

// --- scheduled transactions (4 upcoming) ---
// Every next date is after today, so the app's catch-up never auto-posts them.
const insertSched = db.prepare(`
  INSERT INTO scheduled_transactions (
    id, user_id, name, account_id, payee, category_id, amount, memo,
    frequency, interval, start_date, end_date, day_of_month, day_of_week,
    skip_weekend, next_date, posts_transaction, completed, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, NULL, NULL, ?, 1, 0, datetime('now'), datetime('now'))
`);
const sched = (name, account, payee, cat, amount, freq, day, next) =>
  insertSched.run(uid(), USER_ID, name, account, payee, cat, amount, null, freq, next, day, next);

sched("Mortgage", ACCT.CHECKING, "First Bank Mortgage", CAT.mortgage, -2100, "monthly", 1, nextOccurrence(1));
sched("Phone and internet", ACCT.CHECKING, "FiberNet", CAT.internet, -178, "monthly", 15, nextOccurrence(15));
sched("Streaming", ACCT.CC, "StreamCo", CAT.streaming, -10.99, "monthly", 12, nextOccurrence(12));
sched("Auto registration", ACCT.CHECKING, "City Utility", CAT.car_maint, -240, "yearly", 5, d(monthKeyOf(3), 5));

// --- tracked assets with a year of daily history (~$500k net worth) ---
// Each curve runs oldest → today as 13 monthly anchors (a fraction of the
// current value). History is written daily by interpolating between them, so
// the net-worth chart moves a little every day instead of in steps. Market
// assets add a seeded random walk (daily volatility `vol`) that is pinned to
// zero at today, so the series always ends on current_value.
const CURVE = {
  retirement: [0.74, 0.76, 0.79, 0.8, 0.79, 0.83, 0.86, 0.88, 0.9, 0.93, 0.95, 0.98, 1.0],
  growth: [0.7, 0.73, 0.75, 0.74, 0.76, 0.8, 0.84, 0.86, 0.89, 0.92, 0.95, 0.97, 1.0],
  steady: [0.82, 0.83, 0.85, 0.86, 0.88, 0.89, 0.91, 0.92, 0.94, 0.95, 0.97, 0.98, 1.0],
  house: [0.93, 0.935, 0.94, 0.946, 0.952, 0.958, 0.964, 0.97, 0.976, 0.982, 0.988, 0.994, 1.0],
  crypto: [0.45, 0.55, 0.72, 0.95, 1.2, 1.05, 0.82, 0.7, 0.86, 1.02, 1.18, 1.08, 1.0],
  vehicle: [1.16, 1.145, 1.13, 1.115, 1.1, 1.085, 1.07, 1.056, 1.042, 1.028, 1.014, 1.006, 1.0],
  flat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
};

const insertAsset = db.prepare(`
  INSERT INTO tracked_assets (
    id, user_id, name, asset_type, current_value, sort_order,
    archived, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
`);
const insertHistory = db.prepare(`
  INSERT INTO tracked_asset_history (id, asset_id, value, recorded_at, created_at)
  VALUES (?, ?, ?, ?, datetime('now'))
`);

const assets = [
  { name: "Workplace 401(k)", type: "retirement", finalValue: 68000, curve: CURVE.retirement, vol: 0.009 },
  { name: "Roth IRA", type: "retirement", finalValue: 24000, curve: CURVE.retirement, vol: 0.009 },
  { name: "HSA", type: "investment", finalValue: 6000, curve: CURVE.steady, vol: 0 },
  { name: "Brokerage", type: "investment", finalValue: 9000, curve: CURVE.growth, vol: 0.011 },
  { name: "Crypto wallet", type: "crypto", finalValue: 1500, curve: CURVE.crypto, vol: 0.035 },
  { name: "Home", type: "real_estate", finalValue: 300000, curve: CURVE.house, vol: 0 },
  { name: "Minivan", type: "vehicle", finalValue: 21000, curve: CURVE.vehicle, vol: 0 },
  { name: "Commuter car", type: "vehicle", finalValue: 6500, curve: CURVE.vehicle, vol: 0 },
  { name: "Household items", type: "other", finalValue: 15000, curve: CURVE.flat, vol: 0 },
];

// Every day from the first day of the window through today.
const DAYS = [];
for (let t = new Date(`${MONTHS[0]}-01T00:00:00`); t <= TODAY; t.setDate(t.getDate() + 1)) {
  DAYS.push(new Date(t));
}
// Deterministic pseudo-random normals (mulberry32 + Box-Muller), so the same
// day always produces the same chart.
const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normals = (seed, n) => {
  const next = rng(seed);
  return Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next()));
};
const isoDate = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
// Position of a date along the 13 anchors (0 = first month, 12 = today).
const START_MS = new Date(`${MONTHS[0]}-01T00:00:00`).getTime();
const anchorIndex = (dt) => (12 * (dt.getTime() - START_MS)) / (TODAY.getTime() - START_MS);
const curveAt = (curve, x) => {
  const i = Math.min(11, Math.floor(x));
  const f = x - i;
  return curve[i] + (curve[i + 1] - curve[i]) * f;
};

assets.forEach((a, idx) => {
  const id = uid();
  insertAsset.run(id, USER_ID, a.name, a.type, a.finalValue, idx);
  // Random walk in log space, then bridged so it's 0 on the last day.
  const steps = normals(1000 + idx, DAYS.length);
  const walk = [];
  let w = 0;
  for (const z of steps) walk.push((w += a.vol * z));
  const last = walk[walk.length - 1];
  DAYS.forEach((dt, i) => {
    if (isoDate(dt) === isoDate(TODAY)) return; // today's row is written below
    const x = Math.min(12, anchorIndex(dt));
    const noise = Math.exp(walk[i] - (last * i) / (DAYS.length - 1));
    insertHistory.run(uid(), id, round(a.finalValue * curveAt(a.curve, x) * noise), isoDate(dt));
  });
  // Today's value matches current_value exactly.
  insertHistory.run(uid(), id, a.finalValue, isoDate(TODAY));
});

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
