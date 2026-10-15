"use server";

import { revalidatePath } from "next/cache";
import { revalidateMoneyPages } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import {
  getDb,
  DEFAULT_USER_ID,
  READY_TO_ASSIGN_CATEGORY_ID,
  STARTING_BALANCE_CATEGORY_ID,
} from "@/lib/db";
import { mapRow, newId, now, roundCents } from "@/lib/db-utils";
import { getBudgetStartMonth } from "@/lib/app-settings";
import {
  applyToBalance,
  revertBalanceAdjustment,
  writeBalanceAdjustment,
  type BalanceAdjustmentSnapshot,
} from "@/lib/balance";
import type { Account, AccountType, TransactionWithDetails } from "@/lib/types";

// Account types that get a "Starting balance" transaction when the user
// provides a non-zero starting balance. Both branches use payee "Starting
// balance", but they differ on sign and category:
//   - checking / cash / savings / other (on-budget)
//     → +amount, category = Ready to assign (the money has to be assigned
//     somewhere in envelope budgeting).
//   - checking / cash / savings / other (off-budget — `onBudget=false`)
//     → +amount, category = STARTING_BALANCE_CATEGORY_ID. The balance is still
//     tracked, but the budget engine's totalIncome loop ignores
//     STARTING_BALANCE_CATEGORY_ID, so Ready to Assign is unaffected. This is
//     the same trick credit cards use; 260517-vxf exposes it to non-debt
//     "tracking-only" accounts (a business checking account, a robo-advisor, etc.).
//   - credit_card → -amount, category = STARTING_BALANCE_CATEGORY_ID (debt
//     isn't budgetable income; the reserved category distinguishes it from a
//     budgetable inflow and is filtered out of all category pickers so it
//     never appears as a user-selectable option. See migration 017.)
// 260514-ux8 added `cash`. 260515-k43 added `credit_card` with the inverse
// sign + null-category treatment. 260515-n1a switched the debt branch from
// null to STARTING_BALANCE_CATEGORY_ID so the transaction renders as a
// neutral "Category not needed" pill instead of the yellow Uncategorized
// badge (legacy NULL rows are backfilled by migration 017).
// 260517-vxf added the `onBudget` flag and widened the
// STARTING_BALANCE_CATEGORY_ID branch to cover off-budget non-debt accounts.
const TYPES_WITH_STARTING_TXN = new Set<AccountType>([
  "checking",
  "cash",
  "savings",
  "other",
  "credit_card",
]);

export async function getAccountWithTransactions(accountId: string): Promise<{
  account: Account | null;
  transactions: TransactionWithDetails[];
}> {
  const db = getDb();

  const accountRow = db
    .prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ?")
    .get(accountId, DEFAULT_USER_ID) as Record<string, unknown> | undefined;

  const account = accountRow ? mapRow<Account>(accountRow) : null;

  const rows = db
    .prepare(
      `SELECT t.*, a.name AS account_name, c.name AS category_name, cg.name AS category_group_name
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN category_groups cg ON cg.id = c.category_group_id
       WHERE t.account_id = ? AND t.user_id = ?
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT 500`
    )
    .all(accountId, DEFAULT_USER_ID) as Record<string, unknown>[];

  const transactions = rows.map((row) => {
    const mapped = mapRow<TransactionWithDetails>(row);
    return {
      ...mapped,
      account_name: (row.account_name as string) ?? "",
      category_name: (row.category_name as string) ?? null,
      category_group_name: (row.category_group_name as string) ?? null,
    };
  });

  return { account, transactions };
}

export async function updateAccount(
  id: string,
  updates: { name?: string; type?: AccountType }
) {
  const db = getDb();

  const sets: string[] = [];
  const params: (string | number)[] = [];

  // Only update `name` when a non-empty trimmed value was provided. An empty
  // or whitespace-only string is treated as "don't update name", not "set to
  // empty" — matches the prior behavior of the action.
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (trimmed) {
      sets.push("name = ?");
      params.push(trimmed);
    }
  }

  // When type changes, recompute is_debt with the same rule used by
  // createAccount (line 89): only credit_card is a debt account.
  if (updates.type !== undefined) {
    sets.push("type = ?");
    params.push(updates.type);
    sets.push("is_debt = ?");
    params.push(updates.type === "credit_card" ? 1 : 0);
  }

  // No-op when nothing would actually change — don't touch the DB and don't
  // revalidate. The dialog also short-circuits, but this is defensive.
  if (sets.length === 0) return;

  sets.push("updated_at = ?");
  params.push(now());

  db.prepare(
    `UPDATE accounts SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
  ).run(...params, id, DEFAULT_USER_ID);

  revalidatePath("/");
}

export async function createAccount(input: {
  name: string;
  type: AccountType;
  currentBalance?: number;
  /**
   * When false, the account is created off-budget (`is_budget_account = 0`)
   * and any Starting-balance txn lands in STARTING_BALANCE_CATEGORY_ID so it
   * doesn't inflate Ready to Assign. Defaults to true. Credit cards ignore
   * this flag — they're always created on-budget and use the system category
   * for their (debt) Starting-balance txn via the existing `isDebt` branch.
   */
  onBudget?: boolean;
}): Promise<string> {
  const db = getDb();
  const id = newId();
  const timestamp = now();
  const isDebt = input.type === "credit_card" ? 1 : 0;
  // Sign-tolerant input: AddAccountDialog now labels credit-card balance
  // as "Amount owed" and expects positive numbers (e.g. "1234.56"), but
  // muscle-memory or programmatic callers might still pass -1234.56. Either
  // way we want the same outcome: stored as -1234.56 with an outflow txn.
  // For non-debt types, owed === amount typed (already sign-correct).
  const owed = Math.abs(input.currentBalance ?? 0);

  const shouldCreateStartingTxn =
    owed > 0 && TYPES_WITH_STARTING_TXN.has(input.type);

  const maxOrder = db
    .prepare(`SELECT MAX(sort_order) AS max_order FROM accounts WHERE user_id = ?`)
    .get(DEFAULT_USER_ID) as { max_order: number | null } | undefined;
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;

  const dateStr = timestamp.split("T")[0];

  // Branch on debt vs. budgetable for sign + category + balance direction.
  // Negative checking/savings/etc. balances are still no-op (current behavior
  // preserved — there's no obvious "what category does this overdraft go to"
  // story, and the existing tests on lines 60-70 lock that behavior in).
  const isNegativeNonDebt =
    !isDebt && (input.currentBalance ?? 0) < 0;
  const onBudget = input.onBudget ?? true;
  // Credit cards remain on-budget regardless of the onBudget flag — their
  // tracking semantics are already handled via STARTING_BALANCE_CATEGORY_ID
  // and is_debt. The AddAccountDialog hides the "Tracking only" checkbox for
  // credit cards; this guard is belt-and-suspenders.
  const isBudgetAccount = isDebt ? 1 : (onBudget ? 1 : 0);
  const startingTxnAmount = isDebt ? -owed : owed;
  // Off-budget non-debt accounts use STARTING_BALANCE_CATEGORY_ID so the
  // engine's totalIncome loop skips them (matches the credit-card trick).
  const startingTxnCategory =
    isDebt || !onBudget
      ? STARTING_BALANCE_CATEGORY_ID
      : READY_TO_ASSIGN_CATEGORY_ID;
  const balanceDelta = startingTxnAmount;
  // For non-debt accounts with negative input, skip the txn entirely (matches
  // the pre-existing test contract) and insert the account directly at the
  // negative value.
  const effectiveShouldCreateTxn = shouldCreateStartingTxn && !isNegativeNonDebt;

  db.transaction(() => {
    // When a starting-balance txn will follow, insert the account at 0 and
    // let the UPDATE drive current_balance to its target value. Mirrors the
    // canonical insert-then-update pattern in createTransaction. When no txn
    // will follow (zero, omitted, or negative non-debt input), insert
    // directly at the typed balance.
    const initialBalance = effectiveShouldCreateTxn
      ? 0
      : (input.currentBalance ?? 0);

    db.prepare(
      `INSERT INTO accounts (id, user_id, name, type, is_budget_account, is_debt, current_balance, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      id,
      DEFAULT_USER_ID,
      input.name.trim(),
      input.type,
      isBudgetAccount,
      isDebt,
      initialBalance,
      sortOrder,
      timestamp,
      timestamp,
    );

    // The first checking account becomes primary, so a new install's transfer
    // plan works without a trip to the account menu. Never steals the flag
    // from an existing primary; setPrimaryAccount handles any later change.
    if (input.type === "checking" && isBudgetAccount === 1) {
      db.prepare(
        `UPDATE accounts SET is_primary = 1
         WHERE id = ? AND NOT EXISTS (
           SELECT 1 FROM accounts WHERE user_id = ? AND is_primary = 1
         )`
      ).run(id, DEFAULT_USER_ID);
    }

    if (effectiveShouldCreateTxn) {
      const txnId = newId();
      db.prepare(
        `INSERT INTO transactions (id, user_id, account_id, date, payee, memo, amount, category_id, cleared, approved, is_split_parent, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 'desktop', ?, ?)`
      ).run(
        txnId,
        DEFAULT_USER_ID,
        id,
        dateStr,
        "Starting balance",
        null,
        startingTxnAmount,
        startingTxnCategory,
        timestamp,
        timestamp,
      );

      // Starting-balance txn dated today (post-cutoff in any realistic state),
      // so the helper applies as usual. user_id scoping is intrinsic to the
      // account id; the helper's id-only predicate is safe in single-user mode.
      applyToBalance(db, {
        account_id: id,
        date: dateStr,
        amount: balanceDelta,
        // The starting-balance txn is inserted approved (see the INSERT above).
        approved: true,
      });
    }
  })();

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath("/transactions");
  return id;
}

export type AccountRemovalError = {
  ok: false;
  reason: "not_found" | "is_primary";
};

export type AccountCloseSnapshot = {
  accountId: string;
  previousUpdatedAt: string;
  /** null when the balance was already zero and no adjustment was needed. */
  balanceAdjustment: BalanceAdjustmentSnapshot | null;
};

/**
 * Close an account, zeroing its balance on the way out.
 *
 * The zeroing exists to keep the ledger honest: an
 * archived account drops out of net worth (`lib/net-worth.ts:50`) whether or not
 * anything records why. Writing the difference as a real "Balance adjustment"
 * transaction against Ready to assign means the write-off shows up in the
 * budget instead of the balance just evaporating.
 *
 * Both halves share one transaction — a zeroed-but-still-open account is a
 * worse state than either end, so they must not be separable.
 *
 * Deliberately does NOT redirect. The sidebar's Closed section keeps the
 * account reachable, and staying put keeps the toast's Undo in front of the
 * user who just pressed the button.
 */
export async function closeAccountWithSnapshot(
  id: string
): Promise<AccountRemovalError | AccountCloseSnapshot> {
  const db = getDb();

  const row = db
    .prepare(
      "SELECT id, is_primary, current_balance, updated_at FROM accounts WHERE id = ? AND user_id = ? AND archived = 0"
    )
    .get(id, DEFAULT_USER_ID) as
    | {
        id: string;
        is_primary: number;
        current_balance: number;
        updated_at: string;
      }
    | undefined;

  if (!row) return { ok: false, reason: "not_found" };
  if (row.is_primary === 1) return { ok: false, reason: "is_primary" };

  // roundCents before the comparison so float drift (-1e-9) doesn't mint a
  // $0.00 adjustment transaction on an account that is already square.
  const needsAdjustment = roundCents(Number(row.current_balance)) !== 0;

  const snapshot = db.transaction((): AccountCloseSnapshot => {
    const balanceAdjustment = needsAdjustment
      ? writeBalanceAdjustment(db, id, 0)
      : null;

    db.prepare(
      "UPDATE accounts SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(now(), id, DEFAULT_USER_ID);

    return {
      accountId: id,
      previousUpdatedAt: row.updated_at,
      balanceAdjustment,
    };
  })();

  // Same helper the adjust-balance path uses: closing writes the same
  // Ready-to-assign adjustment, so it owes the same invalidation — Insights and
  // Transfer plan both read balances this just moved.
  revalidatePath("/");
  revalidateMoneyPages();
  return snapshot;
}

/**
 * Undo path for `closeAccountWithSnapshot` — reverses the adjustment (if there
 * was one) and puts `archived` / `updated_at` back exactly as they were.
 */
export async function reopenAccountFromSnapshot(
  snapshot: AccountCloseSnapshot
): Promise<void> {
  const db = getDb();

  db.transaction(() => {
    if (snapshot.balanceAdjustment) {
      revertBalanceAdjustment(db, snapshot.balanceAdjustment);
    }
    // previousUpdatedAt, not now() — undo restores the row, it doesn't stamp a
    // new edit onto it. revertBalanceAdjustment writes its own updated_at, so
    // this has to come second.
    db.prepare(
      "UPDATE accounts SET archived = 0, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(snapshot.previousUpdatedAt, snapshot.accountId, DEFAULT_USER_ID);
  })();

  revalidatePath("/");
  revalidateMoneyPages();
}

/**
 * Deliberate reopen from the sidebar's Closed section — a different thing from
 * undoing a close. The zeroing adjustment was a real write-off and stays on the
 * ledger; this only un-archives, so the account comes back at $0 and the user
 * can adjust its balance if they want it back.
 */
export async function reopenAccount(
  id: string
): Promise<AccountRemovalError | { ok: true }> {
  const db = getDb();

  const exists = db
    .prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?")
    .get(id, DEFAULT_USER_ID) as { id: string } | undefined;

  if (!exists) return { ok: false, reason: "not_found" };

  db.prepare(
    "UPDATE accounts SET archived = 0, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(now(), id, DEFAULT_USER_ID);

  // Same list as close and undo. Reopening puts the account back into net worth
  // (lib/net-worth.ts), back into the `archived = 0` reads on /insights, and
  // back into transfer-plan eligibility — the same pages closing invalidates,
  // for the same reason.
  revalidatePath("/");
  revalidateMoneyPages();
  return { ok: true };
}

export type SetPrimaryError = { ok: false; reason: "not_found" | "archived" };
export type SetPrimaryResult = SetPrimaryError | { ok: true };

export async function setPrimaryAccount(id: string): Promise<SetPrimaryResult> {
  const db = getDb();

  const row = db
    .prepare("SELECT id, archived FROM accounts WHERE id = ? AND user_id = ?")
    .get(id, DEFAULT_USER_ID) as { id: string; archived: number } | undefined;

  if (!row) return { ok: false, reason: "not_found" };
  if (row.archived === 1) return { ok: false, reason: "archived" };

  const timestamp = now();

  // Atomic swap: clear any existing primary first, then mark the target and
  // float it to the top of its sidebar group by giving it the lowest
  // sort_order. The partial unique index `WHERE is_primary = 1` would
  // otherwise reject a direct UPDATE if another row is already primary.
  db.transaction(() => {
    db.prepare(
      "UPDATE accounts SET is_primary = 0, updated_at = ? WHERE user_id = ? AND is_primary = 1"
    ).run(timestamp, DEFAULT_USER_ID);

    const minRow = db
      .prepare(
        "SELECT MIN(sort_order) AS min_order FROM accounts WHERE user_id = ?"
      )
      .get(DEFAULT_USER_ID) as { min_order: number | null } | undefined;
    const nextSortOrder = (minRow?.min_order ?? 0) - 1;

    db.prepare(
      "UPDATE accounts SET is_primary = 1, sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(nextSortOrder, timestamp, id, DEFAULT_USER_ID);
  })();

  revalidatePath("/");
  return { ok: true };
}

export async function deleteAccount(id: string): Promise<AccountRemovalError | void> {
  const db = getDb();

  const row = db
    .prepare("SELECT id, is_primary FROM accounts WHERE id = ? AND user_id = ?")
    .get(id, DEFAULT_USER_ID) as { id: string; is_primary: number } | undefined;

  if (!row) return { ok: false, reason: "not_found" };
  if (row.is_primary === 1) return { ok: false, reason: "is_primary" };

  db.prepare("DELETE FROM accounts WHERE id = ? AND user_id = ?").run(
    id,
    DEFAULT_USER_ID
  );

  revalidatePath("/");
  redirect("/insights");
}

// ---------------------------------------------------------------------------
// Reconcile — record real-world drift between Zero's tracked balance and the
// user's actual wallet/account balance as a signed transaction against a
// user-picked category. Mirrors updateAccountBalanceWithSnapshot + redoTransferPair
// from transfer-plan/actions.ts. Undo reuses undoBalanceAdjustment from
// transfer-plan/actions.ts (category-agnostic).
// ---------------------------------------------------------------------------

export type ReconcileSnapshot = BalanceAdjustmentSnapshot & {
  actualBalance: number;
  categoryId: string;
};

export async function reconcileAccountWithSnapshot(
  accountId: string,
  actualBalance: number,
  categoryId: string
): Promise<ReconcileSnapshot | null> {
  if (!accountId) {
    throw new Error("Invalid input: accountId is required");
  }
  if (typeof actualBalance !== "number" || !Number.isFinite(actualBalance)) {
    throw new Error("Invalid input: a finite actualBalance is required");
  }
  if (!categoryId) {
    throw new Error("Invalid input: categoryId is required");
  }

  const db = getDb();

  const account = db
    .prepare(
      "SELECT current_balance FROM accounts WHERE id = ? AND user_id = ?"
    )
    .get(accountId, DEFAULT_USER_ID) as
    | { current_balance: number }
    | undefined;

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const rounded = roundCents(actualBalance);
  const diff = roundCents(rounded - account.current_balance);

  // No-op when the user's actual matches the tracked balance within a cent.
  if (Math.abs(diff) < 0.005) {
    return null;
  }

  const txnId = newId();
  const timestamp = now();
  const dateStr = timestamp.split("T")[0];

  db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, cleared, approved, is_split_parent, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 'desktop', ?, ?)`
    ).run(
      txnId,
      DEFAULT_USER_ID,
      accountId,
      dateStr,
      "Reconciliation",
      diff,
      categoryId,
      timestamp,
      timestamp
    );

    // Route balance write through applyToBalance — synthetic txn is dated
    // today (post-cutoff) so the gate applies the delta as usual (260603-bdb).
    applyToBalance(db, {
      account_id: accountId,
      date: dateStr,
      amount: diff,
      // The reconciliation txn is inserted approved (see the INSERT above).
      approved: true,
    });
    db.prepare(
      "UPDATE accounts SET updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(timestamp, accountId, DEFAULT_USER_ID);
  })();

  revalidatePath("/");

  return {
    transactionId: txnId,
    accountId,
    previousBalance: account.current_balance,
    actualBalance: rounded,
    categoryId,
  };
}

export async function redoReconciliation(
  snapshot: ReconcileSnapshot
): Promise<ReconcileSnapshot> {
  const db = getDb();

  const account = db
    .prepare(
      "SELECT current_balance FROM accounts WHERE id = ? AND user_id = ?"
    )
    .get(snapshot.accountId, DEFAULT_USER_ID) as
    | { current_balance: number }
    | undefined;

  if (!account) {
    throw new Error(`Account ${snapshot.accountId} not found`);
  }

  const diff = roundCents(snapshot.actualBalance - account.current_balance);
  const txnId = newId();
  const timestamp = now();
  const dateStr = timestamp.split("T")[0];

  db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (id, user_id, account_id, date, payee, amount, category_id, cleared, approved, is_split_parent, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 'desktop', ?, ?)`
    ).run(
      txnId,
      DEFAULT_USER_ID,
      snapshot.accountId,
      dateStr,
      "Reconciliation",
      diff,
      snapshot.categoryId,
      timestamp,
      timestamp
    );

    // Same pattern as reconcileAccountWithSnapshot — gated through helper,
    // updated_at refreshed separately (260603-bdb).
    applyToBalance(db, {
      account_id: snapshot.accountId,
      date: dateStr,
      amount: diff,
      approved: true,
    });
    db.prepare(
      "UPDATE accounts SET updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(timestamp, snapshot.accountId, DEFAULT_USER_ID);
  })();

  revalidatePath("/");

  return {
    transactionId: txnId,
    accountId: snapshot.accountId,
    previousBalance: account.current_balance,
    actualBalance: snapshot.actualBalance,
    categoryId: snapshot.categoryId,
  };
}

// ---------------------------------------------------------------------------
// Tracking-only toggle (260517-vxf) — flip an account between on-budget and
// off-budget by reclassifying its Starting-balance txn between
// READY_TO_ASSIGN_CATEGORY_ID and STARTING_BALANCE_CATEGORY_ID. The budget
// engine's totalIncome loop only sums income-category txns, so flipping to
// STARTING_BALANCE_CATEGORY_ID drops Ready to Assign by exactly the account's
// starting balance. Reversing flips it back. Same trick credit cards already
// use (migration 017); 260517-vxf exposes it to non-debt accounts so business
// / partner cash can be excluded from RTA without breaking net worth.
// ---------------------------------------------------------------------------

export type BudgetStatusSnapshot = {
  accountId: string;
  previous_on_budget: boolean;
  txn_category_changes: { txn_id: string; prev_category_id: string | null }[];
};

/**
 * What Convert would actually move into or out of Ready to assign.
 *
 * The Convert dialog used to interpolate `account.current_balance`, which is
 * the wrong number twice over. The action recategorises the *Starting-balance
 * transaction*, and that amount diverges from the current balance the moment
 * the account has any activity — in practice most accounts disagree, some by
 * thousands. And `computeBudgetMonth` skips any transaction dated
 * before `budget_start_month` (`if (txn.date < cutoff) continue`), so a row
 * predating the user's budget start is invisible to the engine and the true
 * impact is exactly $0 no matter how large the row is.
 *
 * So this sums only the rows the engine can actually see, using the same
 * predicate as the mutation below — including its COLLATE NOCASE — so the
 * number always describes exactly the rows that will move.
 */
export async function getStartingBalanceImpact(
  accountId: string
): Promise<number> {
  const db = getDb();
  const cutoff = getBudgetStartMonth();

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
       WHERE account_id = ? AND user_id = ?
         AND payee = 'Starting balance' COLLATE NOCASE
         AND (category_id = ? OR category_id = ?)
         AND date >= ?`
    )
    .get(
      accountId,
      DEFAULT_USER_ID,
      READY_TO_ASSIGN_CATEGORY_ID,
      STARTING_BALANCE_CATEGORY_ID,
      cutoff
    ) as { total: number };

  return roundCents(row.total);
}

export async function setAccountBudgetStatusWithSnapshot(
  id: string,
  onBudget: boolean
): Promise<BudgetStatusSnapshot | null> {
  const db = getDb();

  const account = db
    .prepare(
      "SELECT type, is_budget_account FROM accounts WHERE id = ? AND user_id = ?"
    )
    .get(id, DEFAULT_USER_ID) as
    | { type: AccountType; is_budget_account: number }
    | undefined;

  if (!account) {
    throw new Error(`Account ${id} not found`);
  }

  // Credit cards already use STARTING_BALANCE_CATEGORY_ID for their debt
  // Starting-balance txn AND remain `is_budget_account = 1` so their
  // categorized spending still routes through the budget. Toggling the column
  // separately would muddy the model — reject explicitly.
  if (account.type === "credit_card") {
    throw new Error("Cannot toggle tracking status on credit cards");
  }

  // No-op when state already matches — mirrors reconcileAccountWithSnapshot's
  // zero-diff branch.
  if (Number(account.is_budget_account) === (onBudget ? 1 : 0)) {
    return null;
  }

  const targetCategory = onBudget
    ? READY_TO_ASSIGN_CATEGORY_ID
    : STARTING_BALANCE_CATEGORY_ID;
  const timestamp = now();

  // Narrow the txn predicate to rows that look like the Starting-balance
  // seed: payee "Starting balance" AND currently in one of the two known
  // category states. This protects user-edited rows that happen to share a
  // payee from being silently reclassified.
  //
  // COLLATE NOCASE is load-bearing, not defensive. `payee` is plain TEXT, so
  // the default BINARY collation made this case-sensitive, and production
  // holds seven rows reading "Starting Balance" with a capital B — written by
  // the historical import, while the app (createAccount below, seed-dev.mjs)
  // writes the lowercase form. The counts on the Pi were 0 against 7: Convert
  // flipped is_budget_account and recategorised nothing, so an account left
  // the budget pickers while its starting balance stayed wherever the import
  // had put it. Migration 017's backfill used the same lowercase literal and
  // skipped those rows for the same reason.
  const txnRows = db
    .prepare(
      `SELECT id, category_id FROM transactions
       WHERE account_id = ? AND user_id = ?
         AND payee = 'Starting balance' COLLATE NOCASE
         AND (category_id = ? OR category_id = ?)`
    )
    .all(
      id,
      DEFAULT_USER_ID,
      READY_TO_ASSIGN_CATEGORY_ID,
      STARTING_BALANCE_CATEGORY_ID
    ) as { id: string; category_id: string | null }[];

  const txn_category_changes = txnRows.map((row) => ({
    txn_id: row.id,
    prev_category_id: row.category_id,
  }));

  db.transaction(() => {
    for (const row of txnRows) {
      db.prepare(
        "UPDATE transactions SET category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).run(targetCategory, timestamp, row.id, DEFAULT_USER_ID);
    }

    db.prepare(
      "UPDATE accounts SET is_budget_account = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(onBudget ? 1 : 0, timestamp, id, DEFAULT_USER_ID);
  })();

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath("/transactions");

  return {
    accountId: id,
    previous_on_budget: Number(account.is_budget_account) === 1,
    txn_category_changes,
  };
}

export async function undoSetAccountBudgetStatus(
  snapshot: BudgetStatusSnapshot
): Promise<void> {
  const db = getDb();
  const timestamp = now();

  db.transaction(() => {
    db.prepare(
      "UPDATE accounts SET is_budget_account = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(
      snapshot.previous_on_budget ? 1 : 0,
      timestamp,
      snapshot.accountId,
      DEFAULT_USER_ID
    );

    for (const change of snapshot.txn_category_changes) {
      db.prepare(
        "UPDATE transactions SET category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).run(change.prev_category_id, timestamp, change.txn_id, DEFAULT_USER_ID);
    }
  })();

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath("/transactions");
}

// Accounts that can pay a credit card: non-debt (so checking / cash / savings /
// non-debt "other"), non-archived, not the card itself. Primary surfaces first
// so the dialog can default to it without an extra lookup. Used only by the
// credit-card account header — keeping it scoped here avoids widening
// getAccountsAndCategories for every page.
export async function getPayCardSourceAccounts(excludeAccountId: string): Promise<
  Array<{ id: string; name: string; currentBalance: number; isPrimary: boolean }>
> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, current_balance, is_primary FROM accounts
       WHERE user_id = ?
         AND archived = 0
         AND is_debt = 0
         AND id != ?
       ORDER BY is_primary DESC, sort_order`
    )
    .all(DEFAULT_USER_ID, excludeAccountId) as Array<{
      id: string;
      name: string;
      current_balance: number;
      is_primary: number;
    }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    currentBalance: Number(r.current_balance),
    isPrimary: r.is_primary === 1,
  }));
}
