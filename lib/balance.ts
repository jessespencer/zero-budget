import type Database from "better-sqlite3";
import { getBudgetStartMonth } from "./app-settings";
import { DEFAULT_USER_ID, READY_TO_ASSIGN_CATEGORY_ID } from "./db-constants";
import { newId, now } from "./db-utils";

// Quick task 260603-bdb — gated runtime helper for accounts.current_balance.
//
// All raw `UPDATE accounts SET current_balance = current_balance + ?` sites
// across the codebase should route through this helper. Two gates guard every
// write, and BOTH must pass:
//
//   1. Cutoff — when the transaction's date sits before
//      `app_settings.budget_start_month`, the write is a no-op: pre-cutoff txns
//      are historical, inert, and must not move the live balance.
//   2. Approval — an unapproved row (`approved = 0`) is deliberately held OUT
//      of the balance until it is posted. An unposted statement line must not
//      move the balance that line is being reconciled against (import-txns).
//
// `approved` is a REQUIRED argument for the same reason the date is: a gate a
// call site can forget is not a gate. It used to live at the call sites, where
// exactly one of them — duplicateTransactions — remembered it, and the delete /
// restore / edit / move paths silently drifted the balance.
//
// The approve/unapprove transition — the moment a held amount finally enters or
// leaves the balance — goes through `applyPostingToBalance` instead. That is
// the ONLY sanctioned way to move money for a row that is (or was) pending;
// grep it to find every such site.
//
// Pairs with migration 025, which one-shot-rebuilds every account's
// current_balance to COALESCE(SUM(amount), 0) for post-cutoff txns. Migration
// = the rebuild; helper = the going-forward invariant. 025 predates the
// approval gate and so doesn't exclude pending rows — any future rebuild needs
// `AND approved = 1` to match what this helper maintains.
//
// Sign convention: callers pass a signed `amount` — positive applies, negative
// reverses. Mirrors the raw UPDATE pattern this replaces. The helper does NOT
// touch `updated_at`; callers that need to refresh it (transfer-plan,
// accounts/[id]) issue a separate `UPDATE accounts SET updated_at = ?` AFTER
// applying the delta. transactions/actions.ts and schedules/actions.ts call
// sites today omit updated_at, and the helper preserves that.
//
// Date comparison is lexicographic — `t.date` is always an ISO `YYYY-MM-DD`
// string, so `"2026-04-30" < "2026-05-01"` works without parsing. Same
// convention as lib/budget-engine.ts.

let cachedCutoff: string | null = null;

function getCutoff(): string {
  if (cachedCutoff === null) {
    cachedCutoff = getBudgetStartMonth();
  }
  return cachedCutoff;
}

function writeBalance(
  db: Database.Database,
  args: { account_id: string; date: string; amount: number }
): void {
  const cutoff = getCutoff();
  if (args.date < cutoff) return;
  db.prepare(
    `UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?`
  ).run(args.amount, args.account_id);
}

/**
 * Apply a signed delta to `accounts.current_balance` IFF the transaction is
 * approved AND its date is on or after `app_settings.budget_start_month`.
 * Either gate failing is a silent no-op — both are intentional: historical
 * data and unposted lines do not move the live balance.
 *
 * The cutoff comparison is inclusive at the boundary (date == cutoff applies).
 *
 * `approved` takes the row's own value — pass the raw 0/1 a SELECT hands back,
 * or a boolean. It describes the row as it stands, so a mutation of a pending
 * row (edit, delete, restore, move) is a balance no-op: the money was never in
 * the balance, so there is nothing to reverse and nothing to re-apply.
 */
export function applyToBalance(
  db: Database.Database,
  args: {
    account_id: string;
    date: string;
    amount: number;
    approved: boolean | number;
  }
): void {
  if (!args.approved) return;
  writeBalance(db, args);
}

/**
 * Move a held amount across the approval boundary — the ONE thing that may
 * write the balance for a row that is (or was) pending. Posting applies the
 * amount; un-posting reverses it. Still cutoff-gated.
 *
 * Separate from `applyToBalance` because the row's `approved` column is, by
 * definition, the wrong answer here: on the posting path it still reads 0 as
 * the money goes in, and on the un-posting path it still reads 1 as the money
 * comes out. Naming the transition keeps `applyToBalance`'s gate honest
 * instead of inviting callers to pass a value they know is stale.
 */
export function applyPostingToBalance(
  db: Database.Database,
  args: { account_id: string; date: string; amount: number }
): void {
  writeBalance(db, args);
}

// ---------------------------------------------------------------------------
// Balance adjustments — the synthetic "Balance adjustment" transaction
// ---------------------------------------------------------------------------
//
// Typing a new balance (adjust-balance, reconcile) and closing an account with
// a non-zero balance are the same money move: write one synthetic txn for the
// difference against Ready to assign, then route the delta through
// applyToBalance so the cutoff/approval gates above still hold.
//
// These two live here, next to the gate, and take an OPEN db rather than
// opening their own transaction, so a caller doing more than one thing can wrap
// the lot atomically. `closeAccountWithSnapshot` needs exactly that — zeroing
// the balance and flipping `archived` must not be separable. The server actions
// in transfer-plan/actions.ts are the thin `db.transaction()` + revalidatePath
// wrappers over them.
//
// CALLERS MUST hold a transaction. Neither function opens one.

export type BalanceAdjustmentSnapshot = {
  transactionId: string;
  accountId: string;
  previousBalance: number;
};

/**
 * Move `accountId` to `targetBalance`, recording the difference as a synthetic
 * "Balance adjustment" transaction against Ready to assign.
 *
 * Debt accounts (credit cards) store balance as negative. Callers pass the
 * amount the way the user thinks about it — the dialog labels its input "Amount
 * owed" and the user types a positive number — so the sign is normalised here
 * rather than at every call site. `Math.abs` first, so a caller that already
 * passes a negative is tolerated too (matches the createAccount pattern).
 *
 * Throws when the account does not exist.
 */
export function writeBalanceAdjustment(
  db: Database.Database,
  accountId: string,
  targetBalance: number
): BalanceAdjustmentSnapshot {
  const account = db
    .prepare(
      "SELECT current_balance, is_debt FROM accounts WHERE id = ? AND user_id = ?"
    )
    .get(accountId, DEFAULT_USER_ID) as
    | { current_balance: number; is_debt: number }
    | undefined;

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const normalised =
    account.is_debt === 1 ? -Math.abs(targetBalance) : targetBalance;

  const diff = normalised - account.current_balance;
  const txnId = newId();
  const timestamp = now();
  const dateStr = timestamp.split("T")[0];

  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, cleared, approved, is_split_parent, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 'desktop', ?, ?)`
  ).run(
    txnId,
    DEFAULT_USER_ID,
    accountId,
    dateStr,
    "Balance adjustment",
    diff,
    READY_TO_ASSIGN_CATEGORY_ID,
    timestamp,
    timestamp
  );

  // The synthetic txn is dated today (post-cutoff in any realistic state) and
  // inserted approved, so the helper applies the delta as usual. updated_at is
  // refreshed separately — applyToBalance deliberately doesn't touch it.
  applyToBalance(db, {
    account_id: accountId,
    date: dateStr,
    amount: diff,
    approved: true,
  });
  db.prepare(
    "UPDATE accounts SET updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(timestamp, accountId, DEFAULT_USER_ID);

  return {
    transactionId: txnId,
    accountId,
    // RAW prior balance (already-negative for debt). Undo restores it directly,
    // so no sign math is needed on the undo path.
    previousBalance: account.current_balance,
  };
}

/**
 * Reverse a `writeBalanceAdjustment`: delete the synthetic txn and back its
 * amount out of the balance.
 *
 * Throws when the txn is already gone, which is the signal that this snapshot
 * has been undone once already.
 */
export function revertBalanceAdjustment(
  db: Database.Database,
  snapshot: BalanceAdjustmentSnapshot
): void {
  const timestamp = now();

  // Capture date + amount BEFORE deleting so the reversal routes through
  // applyToBalance and stays cutoff-gated.
  const txnRow = db
    .prepare(
      "SELECT date, amount, approved FROM transactions WHERE id = ? AND user_id = ?"
    )
    .get(snapshot.transactionId, DEFAULT_USER_ID) as
    | { date: string; amount: number; approved: number }
    | undefined;

  const deleted = db
    .prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?")
    .run(snapshot.transactionId, DEFAULT_USER_ID);

  if (deleted.changes === 0 || !txnRow) {
    throw new Error(
      "Balance adjustment transaction not found -- may have already been undone"
    );
  }

  applyToBalance(db, {
    account_id: snapshot.accountId,
    date: txnRow.date,
    amount: -Number(txnRow.amount),
    approved: txnRow.approved,
  });
  db.prepare(
    "UPDATE accounts SET updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(timestamp, snapshot.accountId, DEFAULT_USER_ID);
}

/**
 * @internal Test-only — clears the memoized cutoff so a test can swap the
 * `app_settings.budget_start_month` row and immediately observe the new value
 * without needing to reset module state via vi.resetModules().
 */
export function __resetCutoffCache(): void {
  cachedCutoff = null;
}
