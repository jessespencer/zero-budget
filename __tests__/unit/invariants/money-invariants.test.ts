import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { __resetCutoffCache } from "@/lib/balance";
import { computeBudgetMonth } from "@/lib/budget-engine";

// Money invariants under random action sequences.
//
// Every other money test in this repo checks one hand-written example. This
// one drives the real server actions with long random sequences — create,
// edit, delete, move, duplicate, approve/unapprove, transfer, split, assign,
// move money, adjust a balance, and undo — and after EVERY step asserts the
// promises the product makes, computed independently from the rows:
//
//   1. Balance      — each account's current_balance equals the sum of its
//                     approved transactions dated on/after the budget start
//                     month (the contract in lib/balance.ts + migration 025).
//   2. Transfers    — every transfer leg has a mirror leg, and all transfer
//                     legs together net to zero.
//   3. Splits       — a split parent's splits sum to the parent's amount.
//   4. Budget       — through the real getBudgetData → computeBudgetMonth
//                     chain: every categorized dollar is either in Ready to
//                     assign or in a category's available. Nothing is created
//                     or lost by the engine or the fetch.
//   5. Undo         — undoing an action puts the money back exactly where it
//                     was (balances, transactions, splits, assignments).
//
// The sequences are deterministic: a failure prints its seed and the full op
// log. Re-run one seed with MONEY_INVARIANT_SEED=<n>; raise the sweep with
// MONEY_INVARIANT_SEEDS=<count>.
//
// Deliberately NOT exercised, because the app routes them elsewhere or they
// are documented gaps (see the comments at the op generators below):
//   - approving / un-approving one leg of a transfer (known gap behind
//     FEATURES.BANK_SYNC, documented in updateTransaction)
//   - moving one transfer leg to another account, or duplicating one leg,
//     outside updateTransferPairWithSnapshot
//   - changing the amount of a split parent without re-saving its splits

const USER_ID = "00000000-0000-0000-0000-000000000000";
const CUTOFF = "2026-05-01";
// A month after every date and assignment the generator can produce, so the
// conservation identity sees the whole ledger and no future assignments.
const HORIZON = "2099-01-01";
const EPSILON = 0.005;

const ACCOUNTS = ["acct-chk", "acct-sav", "acct-cc"] as const;
const CATEGORIES = ["c-rent", "c-food", "c-fun", "c-car"] as const;
// Straddles the budget start month on purpose: pre-cutoff rows must never
// move a balance, and an edit that crosses the boundary must move it once.
const DATES = [
  "2026-03-10",
  "2026-04-30",
  "2026-05-01",
  "2026-05-20",
  "2026-06-15",
  "2026-07-03",
  "2026-08-28",
] as const;
const MONTHS = ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01"] as const;

const SEED_COUNT = Number(process.env.MONEY_INVARIANT_SEEDS ?? 40);
const STEPS = 70;
const ONLY_SEED = process.env.MONEY_INVARIANT_SEED;

// ── Deterministic randomness ─────────────────────────────────────────

type Rng = {
  next: () => number;
  int: (maxExclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (p: number) => boolean;
  cents: (maxDollars: number) => number;
};

function makeRng(seed: number): Rng {
  // mulberry32
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    pick: <T,>(items: readonly T[]) => items[int(items.length)],
    chance: (p: number) => next() < p,
    // A positive amount in whole cents, 0.01 … maxDollars.
    cents: (maxDollars: number) => (int(maxDollars * 100) + 1) / 100,
  };
}

// ── Fixture ──────────────────────────────────────────────────────────

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  __resetCutoffCache();

  const insertAccount = db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 1, ?, 0, ?, 0)`
  );
  insertAccount.run("acct-chk", USER_ID, "Checking", "checking", 0, 0);
  insertAccount.run("acct-sav", USER_ID, "Savings", "savings", 0, 1);
  insertAccount.run("acct-cc", USER_ID, "Card", "credit_card", 1, 2);

  db.prepare(
    "INSERT INTO category_groups (id, user_id, name, sort_order, is_income) VALUES (?, ?, ?, ?, 0)"
  ).run("g-bills", USER_ID, "Bills", 10);
  CATEGORIES.forEach((id, i) => {
    db.prepare(
      "INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived) VALUES (?, ?, ?, ?, ?, 0)"
    ).run(id, USER_ID, "g-bills", id, i);
  });
});

afterEach(() => {
  clearTestDb();
  __resetCutoffCache();
  db.close();
});

// ── Row helpers ──────────────────────────────────────────────────────

type TxnRow = {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  category_id: string | null;
  transfer_account_id: string | null;
  approved: number;
  is_split_parent: number;
};

// Insertion order, not id order: ids are random UUIDs, and picking from an
// id-sorted list would make the same seed walk a different path every run.
function allTxns(): TxnRow[] {
  return db
    .prepare(
      `SELECT id, account_id, date, amount, category_id, transfer_account_id, approved, is_split_parent
         FROM transactions WHERE user_id = ? ORDER BY rowid`
    )
    .all(USER_ID) as TxnRow[];
}

const plainTxns = () => allTxns().filter((t) => t.transfer_account_id === null);
const transferLegs = () => allTxns().filter((t) => t.transfer_account_id !== null);

function signedAmount(rng: Rng): number {
  const amount = rng.cents(500);
  return rng.chance(0.75) ? -amount : amount;
}

// ── Invariants ───────────────────────────────────────────────────────

function checkBalances(): string | null {
  const rows = db
    .prepare(
      `SELECT a.id AS id, a.current_balance AS balance,
              COALESCE((
                SELECT SUM(t.amount) FROM transactions t
                 WHERE t.account_id = a.id AND t.approved = 1 AND t.date >= ?
              ), 0) AS expected
         FROM accounts a WHERE a.user_id = ?`
    )
    .all(CUTOFF, USER_ID) as { id: string; balance: number; expected: number }[];

  for (const row of rows) {
    if (Math.abs(row.balance - row.expected) > EPSILON) {
      return `balance drift on ${row.id}: current_balance=${row.balance.toFixed(2)} but approved post-cutoff transactions sum to ${row.expected.toFixed(2)}`;
    }
  }
  return null;
}

function checkTransfers(): string | null {
  const legs = transferLegs();
  let net = 0;
  for (const leg of legs) {
    net += leg.amount;
    const mirror = legs.find(
      (other) =>
        other.id !== leg.id &&
        other.account_id === leg.transfer_account_id &&
        other.transfer_account_id === leg.account_id &&
        other.date === leg.date &&
        Math.abs(other.amount + leg.amount) < EPSILON
    );
    if (!mirror) {
      return `transfer leg ${leg.id} (${leg.account_id} ${leg.amount} on ${leg.date}) has no mirror leg`;
    }
  }
  if (Math.abs(net) > EPSILON) {
    return `transfer legs net to ${net.toFixed(2)}, expected 0`;
  }
  return null;
}

function checkSplits(): string | null {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.amount AS amount,
              COALESCE((SELECT SUM(s.amount) FROM transaction_splits s WHERE s.parent_transaction_id = t.id), 0) AS split_total
         FROM transactions t WHERE t.user_id = ? AND t.is_split_parent = 1`
    )
    .all(USER_ID) as { id: string; amount: number; split_total: number }[];
  for (const row of rows) {
    if (Math.abs(row.amount - row.split_total) > EPSILON) {
      return `split parent ${row.id} is ${row.amount} but its splits sum to ${row.split_total}`;
    }
  }
  const orphans = db
    .prepare(
      `SELECT COUNT(*) AS n FROM transaction_splits s
        WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = s.parent_transaction_id AND t.is_split_parent = 1)`
    )
    .get() as { n: number };
  if (orphans.n > 0) return `${orphans.n} split rows have no split-parent transaction`;
  return null;
}

// Conservation, through the real fetch chain. At a month past everything:
//
//   Ready to assign + Σ max(available, 0)  =  Σ categorized money
//
// where "categorized money" is every post-cutoff transaction or split amount
// filed under an income or a regular category. Overspent categories are the
// reason for the max(): their shortfall is already deducted from Ready to
// assign. The right-hand side is summed straight from the tables, so a row
// the fetch drops, double-counts, or mis-dates breaks the equality.
async function checkBudgetConservation(): Promise<string | null> {
  const { getBudgetData } = await import("@/app/(app)/budget/actions");
  const budget = computeBudgetMonth(await getBudgetData(HORIZON));

  const rows = [
    ...budget.groups.flatMap((g) => g.categories),
    ...budget.hiddenCategories,
    ...budget.hiddenGroups.flatMap((g) => g.categories),
  ];
  const held = rows.reduce((sum, c) => sum + Math.max(c.available, 0), 0);
  const actual = budget.readyToAssign + held;

  const budgetable = `(g.is_income = 1 OR g.is_system = 0)`;
  const direct = db
    .prepare(
      `SELECT COALESCE(SUM(t.amount), 0) AS total
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
         JOIN category_groups g ON g.id = c.category_group_id
        WHERE t.user_id = ? AND t.is_split_parent = 0 AND t.date >= ? AND ${budgetable}`
    )
    .get(USER_ID, CUTOFF) as { total: number };
  const viaSplits = db
    .prepare(
      `SELECT COALESCE(SUM(s.amount), 0) AS total
         FROM transaction_splits s
         JOIN transactions t ON t.id = s.parent_transaction_id
         JOIN categories c ON c.id = s.category_id
         JOIN category_groups g ON g.id = c.category_group_id
        WHERE t.user_id = ? AND t.date >= ? AND ${budgetable}`
    )
    .get(USER_ID, CUTOFF) as { total: number };
  const expected = direct.total + viaSplits.total;

  if (Math.abs(actual - expected) > EPSILON) {
    return `budget does not conserve money: Ready to assign (${budget.readyToAssign.toFixed(2)}) + available held in categories (${held.toFixed(2)}) = ${actual.toFixed(2)}, but categorized money totals ${expected.toFixed(2)}`;
  }
  return null;
}

async function firstViolation(): Promise<string | null> {
  return (
    checkBalances() ??
    checkTransfers() ??
    checkSplits() ??
    (await checkBudgetConservation())
  );
}

// Everything that is "the money", in a form two states can be compared by.
// Ids and timestamps that legitimately change across an undo are left out.
function moneyFingerprint(): string {
  const accounts = db
    .prepare("SELECT id, current_balance FROM accounts WHERE user_id = ? ORDER BY id")
    .all(USER_ID) as { id: string; current_balance: number }[];
  const txns = db
    .prepare(
      `SELECT id, account_id, date, amount, category_id, transfer_account_id, approved, is_split_parent
         FROM transactions WHERE user_id = ? ORDER BY id`
    )
    .all(USER_ID) as TxnRow[];
  const splits = db
    .prepare(
      `SELECT parent_transaction_id AS parent, category_id, amount
         FROM transaction_splits ORDER BY parent_transaction_id, category_id, amount`
    )
    .all() as { parent: string; category_id: string | null; amount: number }[];
  const assigned = db
    .prepare(
      `SELECT category_id, month, assigned FROM monthly_budgets
        WHERE user_id = ? AND assigned != 0 ORDER BY category_id, month`
    )
    .all(USER_ID) as { category_id: string; month: string; assigned: number }[];

  const cents = (n: number) => Math.round(n * 100);
  return JSON.stringify({
    accounts: accounts.map((a) => [a.id, cents(a.current_balance)]),
    txns: txns.map((t) => ({ ...t, amount: cents(t.amount) })),
    splits: splits.map((s) => ({ ...s, amount: cents(s.amount) })),
    assigned: assigned.map((m) => ({ ...m, assigned: cents(m.assigned) })),
  });
}

// ── Ops ──────────────────────────────────────────────────────────────

// An op runs one user action. If the action is undoable it returns the undo,
// which the runner sometimes invokes to check the round trip.
type Undo = () => Promise<void>;
type OpResult = { label: string; undo?: Undo } | null;
type Op = (rng: Rng) => Promise<OpResult>;

const txnActions = () => import("@/app/(app)/transactions/actions");
const transferActions = () => import("@/app/(app)/transfer-plan/actions");
const budgetActions = () => import("@/app/(app)/budget/actions");

const createTxn: Op = async (rng) => {
  const { createTransaction, deleteTransactionWithSnapshot } = await txnActions();
  const input = {
    date: rng.pick(DATES),
    payee: "",
    amount: signedAmount(rng),
    account_id: rng.pick(ACCOUNTS),
    category_id: rng.chance(0.8) ? rng.pick(CATEGORIES) : undefined,
  };
  const { id } = await createTransaction(input);
  return {
    label: `create ${input.amount} in ${input.account_id} on ${input.date} cat=${input.category_id ?? "auto"}`,
    undo: async () => {
      await deleteTransactionWithSnapshot(id);
    },
  };
};

// What import-txns does: an unposted statement line, held out of the balance.
const insertPending: Op = async (rng) => {
  const id = `pending-${rng.int(1e9)}`;
  const date = rng.pick(DATES);
  const amount = signedAmount(rng);
  const account = rng.pick(ACCOUNTS);
  const category = rng.chance(0.6) ? rng.pick(CATEGORIES) : null;
  db.prepare(
    `INSERT INTO transactions (id, user_id, date, payee, amount, account_id, category_id, approved, source, created_at, updated_at)
     VALUES (?, ?, ?, 'Pending payee', ?, ?, ?, 0, 'import', ?, ?)`
  ).run(id, USER_ID, date, amount, account, category, date, date);
  return { label: `insert pending ${amount} in ${account} on ${date}` };
};

// Field edits on an ordinary (non-transfer) row. Split parents keep their
// amount — the client re-saves splits alongside an amount change, and
// assertSplitsBalanceParent enforces that at save time.
const editTxn: Op = async (rng) => {
  const { updateTransaction } = await txnActions();
  const candidates = plainTxns();
  if (candidates.length === 0) return null;
  const txn = rng.pick(candidates);

  const updates: {
    amount?: number;
    date?: string;
    account_id?: string;
    category_id?: string | null;
  } = {};
  if (rng.chance(0.5) && !txn.is_split_parent) updates.amount = signedAmount(rng);
  if (rng.chance(0.5)) updates.date = rng.pick(DATES);
  if (rng.chance(0.35)) updates.account_id = rng.pick(ACCOUNTS);
  if (rng.chance(0.25) && !txn.is_split_parent) updates.category_id = rng.pick(CATEGORIES);
  if (Object.keys(updates).length === 0) updates.date = rng.pick(DATES);

  await updateTransaction(txn.id, updates);
  return {
    label: `edit ${txn.id.slice(0, 8)} (was ${txn.amount} ${txn.account_id} ${txn.date} approved=${txn.approved}) → ${JSON.stringify(updates)}`,
    undo: async () => {
      await updateTransaction(txn.id, {
        amount: txn.amount,
        date: txn.date,
        account_id: txn.account_id,
        ...(updates.category_id !== undefined ? { category_id: txn.category_id } : {}),
      });
    },
  };
};

// Amount / date edits on ONE leg of a transfer through updateTransaction,
// which mirrors them onto the sibling leg. Account changes on a transfer go
// through updateTransferPairWithSnapshot (editTransfer below).
const editTransferLegInline: Op = async (rng) => {
  const { updateTransaction } = await txnActions();
  const legs = transferLegs();
  if (legs.length === 0) return null;
  const leg = rng.pick(legs);

  const updates: { amount?: number; date?: string } = {};
  if (rng.chance(0.5)) {
    // Keep the leg's direction: an outflow leg stays an outflow.
    updates.amount = Math.sign(leg.amount) * rng.cents(400);
  }
  if (rng.chance(0.6) || updates.amount === undefined) updates.date = rng.pick(DATES);

  await updateTransaction(leg.id, updates);
  return {
    label: `edit transfer leg ${leg.id.slice(0, 8)} inline (was ${leg.amount} ${leg.account_id} ${leg.date}) → ${JSON.stringify(updates)}`,
    undo: async () => {
      await updateTransaction(leg.id, { amount: leg.amount, date: leg.date });
    },
  };
};

// Approve / un-approve through updateTransaction, optionally with field edits
// in the same call (the approveEdit path). Transfer legs are excluded — a
// half-posted pair is a documented gap behind FEATURES.BANK_SYNC.
const toggleApproved: Op = async (rng) => {
  const { updateTransaction } = await txnActions();
  const candidates = plainTxns();
  if (candidates.length === 0) return null;
  const txn = rng.pick(candidates);

  const updates: {
    approved: boolean;
    amount?: number;
    date?: string;
    account_id?: string;
  } = { approved: txn.approved === 0 };
  if (rng.chance(0.3) && !txn.is_split_parent) updates.amount = signedAmount(rng);
  if (rng.chance(0.3)) updates.date = rng.pick(DATES);
  if (rng.chance(0.2)) updates.account_id = rng.pick(ACCOUNTS);

  await updateTransaction(txn.id, updates);
  return {
    label: `set approved on ${txn.id.slice(0, 8)} (was ${txn.amount} ${txn.account_id} ${txn.date} approved=${txn.approved}) → ${JSON.stringify(updates)}`,
    undo: async () => {
      await updateTransaction(txn.id, {
        approved: txn.approved === 1,
        amount: txn.amount,
        date: txn.date,
        account_id: txn.account_id,
      });
    },
  };
};

const postPending: Op = async (rng) => {
  const { postPendingTransactionsWithSnapshot, unpostPendingTransactions } = await txnActions();
  const pending = plainTxns().filter((t) => t.approved === 0);
  if (pending.length === 0) return null;
  const ids = pending.filter(() => rng.chance(0.6)).map((t) => t.id);
  if (ids.length === 0) ids.push(pending[0].id);
  const snapshot = await postPendingTransactionsWithSnapshot(ids);
  return {
    label: `post ${ids.length} pending`,
    undo: () => unpostPendingTransactions(snapshot),
  };
};

const deleteTxn: Op = async (rng) => {
  const { deleteTransactionWithSnapshot, restoreTransactionSnapshots } = await txnActions();
  const candidates = allTxns();
  if (candidates.length === 0) return null;
  const txn = rng.pick(candidates);
  const snapshots = await deleteTransactionWithSnapshot(txn.id);
  return {
    label: `delete ${txn.id.slice(0, 8)} (${txn.amount} ${txn.account_id} ${txn.date} approved=${txn.approved}${txn.transfer_account_id ? " transfer" : ""})`,
    undo: () => restoreTransactionSnapshots(snapshots),
  };
};

const bulkDelete: Op = async (rng) => {
  const { bulkDeleteTransactionsWithSnapshot, restoreTransactionSnapshots } = await txnActions();
  const ids = allTxns()
    .filter(() => rng.chance(0.3))
    .map((t) => t.id);
  if (ids.length === 0) return null;
  const snapshots = await bulkDeleteTransactionsWithSnapshot(ids);
  return {
    label: `bulk delete ${ids.length}`,
    undo: () => restoreTransactionSnapshots(snapshots),
  };
};

// Transfer legs change accounts through updateTransferPairWithSnapshot, not
// the bulk "move to account" action.
const bulkMove: Op = async (rng) => {
  const { bulkMoveTransactionsToAccountWithSnapshot, restoreAccountMoveSnapshot } =
    await txnActions();
  const ids = plainTxns()
    .filter(() => rng.chance(0.4))
    .map((t) => t.id);
  if (ids.length === 0) return null;
  const target = rng.pick(ACCOUNTS);
  const snapshot = await bulkMoveTransactionsToAccountWithSnapshot(ids, target);
  return {
    label: `move ${ids.length} to ${target}`,
    undo: () => restoreAccountMoveSnapshot(snapshot),
  };
};

const duplicate: Op = async (rng) => {
  const { duplicateTransactions, bulkDeleteTransactionsWithSnapshot } = await txnActions();
  const ids = plainTxns()
    .filter(() => rng.chance(0.25))
    .map((t) => t.id);
  if (ids.length === 0) return null;
  const newIds = await duplicateTransactions(ids);
  return {
    label: `duplicate ${ids.length}`,
    undo: async () => {
      await bulkDeleteTransactionsWithSnapshot(newIds);
    },
  };
};

const createTransfer: Op = async (rng) => {
  const { createTransferPairWithSnapshot, undoTransferPair } = await transferActions();
  const from = rng.pick(ACCOUNTS);
  const to = rng.pick(ACCOUNTS.filter((a) => a !== from));
  const input = { fromAccountId: from, toAccountId: to, amount: rng.cents(400), date: rng.pick(DATES) };
  const snapshot = await createTransferPairWithSnapshot(input);
  return {
    label: `transfer ${input.amount} ${from} → ${to} on ${input.date}`,
    undo: () => undoTransferPair(snapshot),
  };
};

const editTransfer: Op = async (rng) => {
  const { updateTransferPairWithSnapshot, undoTransferPairEdit } = await transferActions();
  const legs = transferLegs();
  if (legs.length === 0) return null;
  const leg = rng.pick(legs);
  const from = rng.pick(ACCOUNTS);
  const to = rng.pick(ACCOUNTS.filter((a) => a !== from));
  const input = {
    txnId: leg.id,
    fromAccountId: from,
    toAccountId: to,
    amount: rng.cents(400),
    date: rng.pick(DATES),
  };
  const snapshot = await updateTransferPairWithSnapshot(input);
  return {
    label: `edit transfer ${leg.id.slice(0, 8)} → ${input.amount} ${from} → ${to} on ${input.date}`,
    undo: () => undoTransferPairEdit(snapshot),
  };
};

const adjustBalance: Op = async (rng) => {
  const { updateAccountBalanceWithSnapshot, undoBalanceAdjustment } = await transferActions();
  const account = rng.pick(ACCOUNTS);
  const target = rng.cents(2000);
  const snapshot = await updateAccountBalanceWithSnapshot(account, target);
  return {
    label: `adjust ${account} balance to ${target}`,
    undo: () => undoBalanceAdjustment(snapshot),
  };
};

const splitTxn: Op = async (rng) => {
  const { saveSplitsWithSnapshot, restoreSplitSnapshot } = await txnActions();
  const candidates = plainTxns();
  if (candidates.length === 0) return null;
  const txn = rng.pick(candidates);

  // Carve the parent's amount into 2–3 parts that sum to it in whole cents.
  const totalCents = Math.round(txn.amount * 100);
  const parts = 2 + rng.int(2);
  const cuts: number[] = [];
  let remaining = totalCents;
  for (let i = 0; i < parts - 1; i++) {
    const piece = Math.trunc((remaining * (rng.int(60) + 20)) / 100);
    cuts.push(piece);
    remaining -= piece;
  }
  cuts.push(remaining);

  const splits = cuts.map((c) => ({
    category_id: rng.chance(0.9) ? rng.pick(CATEGORIES) : null,
    amount: c / 100,
  }));
  const snapshot = await saveSplitsWithSnapshot(txn.id, splits);
  return {
    label: `split ${txn.id.slice(0, 8)} (${txn.amount}) into ${cuts.map((c) => c / 100).join(" + ")}`,
    undo: () => restoreSplitSnapshot(txn.id, snapshot),
  };
};

const unsplitTxn: Op = async (rng) => {
  const { removeSplitsWithSnapshot, restoreSplitSnapshot } = await txnActions();
  const parents = plainTxns().filter((t) => t.is_split_parent === 1);
  if (parents.length === 0) return null;
  const txn = rng.pick(parents);
  const category = rng.chance(0.8) ? rng.pick(CATEGORIES) : null;
  const snapshot = await removeSplitsWithSnapshot(txn.id, category);
  return {
    label: `unsplit ${txn.id.slice(0, 8)} → cat=${category}`,
    undo: () => restoreSplitSnapshot(txn.id, snapshot),
  };
};

const assign: Op = async (rng) => {
  const { setCategoryAssignedWithSnapshot } = await budgetActions();
  const category = rng.pick(CATEGORIES);
  const month = rng.pick(MONTHS);
  const amount = rng.chance(0.15) ? 0 : rng.cents(600);
  const { previous } = await setCategoryAssignedWithSnapshot(category, month, amount);
  return {
    label: `assign ${amount} to ${category} in ${month}`,
    undo: async () => {
      await setCategoryAssignedWithSnapshot(category, month, previous);
    },
  };
};

const moveMoney: Op = async (rng) => {
  const { moveMoneyBetweenCategoriesWithSnapshot, restoreMoveMoneySnapshot } =
    await budgetActions();
  const source = rng.pick(CATEGORIES);
  const dest = rng.chance(0.3) ? "RTA" : rng.pick(CATEGORIES.filter((c) => c !== source));
  const args = {
    sourceCategoryId: source,
    destCategoryId: dest,
    amount: rng.cents(200),
    month: rng.pick(MONTHS),
  };
  const snapshot = await moveMoneyBetweenCategoriesWithSnapshot(args);
  return {
    label: `move ${args.amount} ${source} → ${dest} in ${args.month}`,
    undo: () => restoreMoveMoneySnapshot(snapshot),
  };
};

// Weighted so the ledger grows: creation outpaces deletion.
const OPS: readonly [weight: number, name: string, op: Op][] = [
  [14, "createTxn", createTxn],
  [6, "insertPending", insertPending],
  [14, "editTxn", editTxn],
  [6, "toggleApproved", toggleApproved],
  [4, "postPending", postPending],
  [6, "deleteTxn", deleteTxn],
  [2, "bulkDelete", bulkDelete],
  [4, "bulkMove", bulkMove],
  [3, "duplicate", duplicate],
  [8, "createTransfer", createTransfer],
  [6, "editTransfer", editTransfer],
  [4, "editTransferLegInline", editTransferLegInline],
  [3, "adjustBalance", adjustBalance],
  [5, "splitTxn", splitTxn],
  [2, "unsplitTxn", unsplitTxn],
  [8, "assign", assign],
  [4, "moveMoney", moveMoney],
];
const TOTAL_WEIGHT = OPS.reduce((sum, [w]) => sum + w, 0);

function pickOp(rng: Rng): Op {
  let roll = rng.next() * TOTAL_WEIGHT;
  for (const [weight, , op] of OPS) {
    roll -= weight;
    if (roll < 0) return op;
  }
  return OPS[0][2];
}

// ── Runner ───────────────────────────────────────────────────────────

async function runSequence(seed: number): Promise<void> {
  const rng = makeRng(seed);
  const log: string[] = [];

  const fail = (what: string): never => {
    throw new Error(
      `Money invariant broken (seed ${seed}, step ${log.length}).\n${what}\n\n` +
        `Reproduce: MONEY_INVARIANT_SEED=${seed} npx vitest run __tests__/unit/invariants\n\n` +
        `Ops:\n${log.map((l, i) => `  ${i + 1}. ${l}`).join("\n")}`
    );
  };

  for (let step = 0; step < STEPS; step++) {
    const before = moneyFingerprint();
    const result = await pickOp(rng)(rng);
    if (result === null) continue;

    log.push(result.label);
    const violation = await firstViolation();
    if (violation) fail(violation);

    // Sometimes take the action straight back, as Cmd+Z would.
    if (result.undo && rng.chance(0.35)) {
      await result.undo();
      log.push(`  ↩ undo: ${result.label}`);
      const afterUndo = await firstViolation();
      if (afterUndo) fail(afterUndo);
      if (moneyFingerprint() !== before) {
        fail("undo did not restore the money to its state before the action");
      }
    }
  }
}

describe("money invariants hold under random action sequences", () => {
  const seeds = ONLY_SEED
    ? [Number(ONLY_SEED)]
    : Array.from({ length: SEED_COUNT }, (_, i) => i + 1);

  it.each(seeds)("seed %i", async (seed) => {
    await runSequence(seed);
  });

  it("the invariant checks themselves notice a corrupted balance", async () => {
    // Guards against a vacuous suite: a raw write that bypasses lib/balance.ts
    // must trip the balance invariant.
    const { createTransaction } = await txnActions();
    await createTransaction({ date: "2026-06-15", payee: "", amount: -20, account_id: "acct-chk" });
    expect(checkBalances()).toBeNull();
    db.prepare("UPDATE accounts SET current_balance = current_balance + 1 WHERE id = 'acct-chk'").run();
    expect(checkBalances()).toMatch(/balance drift on acct-chk/);
  });

  // The first bug the sweep found, pinned as a plain example so it stays
  // readable (and fixed) even if the generator changes. updateTransaction only
  // touched the balance when the amount or account changed, so re-dating a row
  // across the budget start month left its amount on the wrong side.
  it("a date-only edit across the budget start month moves the whole amount", async () => {
    const { createTransaction, updateTransaction } = await txnActions();
    const balance = () =>
      (
        db.prepare("SELECT current_balance FROM accounts WHERE id = 'acct-chk'").get() as {
          current_balance: number;
        }
      ).current_balance;

    const { id } = await createTransaction({
      date: "2026-06-15",
      payee: "",
      amount: -40,
      account_id: "acct-chk",
    });
    expect(balance()).toBe(-40);

    // Back before the cutoff: the row is historical now and leaves the balance.
    await updateTransaction(id, { date: "2026-04-30" });
    expect(balance()).toBe(0);

    // And forward again: it comes back, once.
    await updateTransaction(id, { date: "2026-05-01" });
    expect(balance()).toBe(-40);
    expect(checkBalances()).toBeNull();
  });
});
