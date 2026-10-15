"use server";

import { getDb, DEFAULT_USER_ID } from "@/lib/db";
import { newId, now, roundCents } from "@/lib/db-utils";
import {
  applyToBalance,
  revertBalanceAdjustment,
  writeBalanceAdjustment,
  type BalanceAdjustmentSnapshot,
} from "@/lib/balance";
import { revalidatePath } from "next/cache";
import { revalidateMoneyPages } from "@/lib/revalidate";
import type { TransactionSource } from "@/lib/types";


// ---------------------------------------------------------------------------
// Transfer plan actuals — persist user-entered bank balances per month
// ---------------------------------------------------------------------------

export async function getTransferPlanActuals(
  month: string
): Promise<Record<string, number>> {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT account_id, actual_balance FROM transfer_plan_actuals WHERE user_id = ? AND month = ?"
    )
    .all(DEFAULT_USER_ID, month) as { account_id: string; actual_balance: number }[];

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.account_id] = row.actual_balance;
  }
  return result;
}

export async function saveTransferPlanActual(
  month: string,
  accountId: string,
  actualBalance: number
): Promise<void> {
  if (!month || !accountId || typeof actualBalance !== "number" || !isFinite(actualBalance)) {
    throw new Error("Invalid input: month, accountId, and a finite actualBalance are required");
  }

  const db = getDb();
  const timestamp = now();
  const rounded = roundCents(actualBalance);

  db.prepare(
    `INSERT INTO transfer_plan_actuals (id, user_id, month, account_id, actual_balance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, month, account_id) DO UPDATE SET
       actual_balance = excluded.actual_balance,
       updated_at = excluded.updated_at`
  ).run(newId(), DEFAULT_USER_ID, month, accountId, rounded, timestamp, timestamp);

  // /transfer-plan only — transfer_plan_actuals is read by exactly one page
  // (getTransferPlanActuals in transfer-plan/page.tsx), so nothing wider needs
  // invalidating. It is not a no-op despite the client holding the number
  // optimistically: `actualBalances` is a useState initializer that never
  // re-syncs from props, so a re-render can't clobber an in-flight edit, but a
  // back/forward navigation *remounts* the component and re-seeds it from
  // whatever savedActuals the Router Cache still holds. Without this the user
  // navigates back and reads the balance they already overwrote.
  revalidatePath("/transfer-plan");
}

// NOTE: BalanceAdjustmentSnapshot is NOT re-exported from here, tempting as it
// was — this module has been its import site since it was written. A
// `"use server"` module may only export async functions, and Next's transform
// emits a runtime re-export for `export type { X }` rather than erasing it, so
// the re-export builds clean under tsc and vitest and then fails `next dev`
// with "Export BalanceAdjustmentSnapshot doesn't exist in target module".
// Import it from "@/lib/balance", which is where it lives now.

export async function updateAccountBalanceWithSnapshot(
  accountId: string,
  actualBalance: number
): Promise<BalanceAdjustmentSnapshot> {
  if (!accountId || typeof actualBalance !== "number" || !isFinite(actualBalance)) {
    throw new Error("Invalid input: accountId and a finite actualBalance are required");
  }

  const db = getDb();
  const snapshot = db.transaction(() =>
    writeBalanceAdjustment(db, accountId, actualBalance)
  )();

  // Includes /budget, whose header shows a "Credit card debt" indicator that
  // depends on the sum of credit_card current_balance — it has to stay in sync
  // when the user adjusts a card balance from any page.
  revalidateMoneyPages();
  return snapshot;
}

export async function undoBalanceAdjustment(
  snapshot: BalanceAdjustmentSnapshot
): Promise<void> {
  const db = getDb();
  db.transaction(() => revertBalanceAdjustment(db, snapshot))();

  // Symmetry with updateAccountBalanceWithSnapshot: undo moves the same
  // balances back, so it owes the same invalidation the forward action gives.
  revalidateMoneyPages();
}

// ---------------------------------------------------------------------------
// Transfer pair — record a one-click transfer between two accounts as two
// linked, atomic, categoryless transactions. Used by the Transfer Plan rows
// (savings transfers + credit-card payments) to skip the manual two-entry
// hand-key in the transactions page.
// ---------------------------------------------------------------------------

export type TransferPairInput = {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  // Provenance — defaults to 'desktop' in callers. /quick callers pass
  // 'quick' so both legs of the pair are stamped consistently. See
  // SEED-014 / migration 018.
  source?: TransactionSource;
  // Optional note, written to both legs. Blank → NULL.
  memo?: string;
};

export type TransferPairSnapshot = {
  outflowTxnId: string;
  inflowTxnId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  payeeOutflow: string;
  payeeInflow: string;
  // Carries provenance across undo/redo so a /quick-originated transfer
  // re-inserts with source='quick' after a redo. Optional for legacy
  // snapshots in flight (pre-018 callers); defaults to 'desktop'.
  source?: TransactionSource;
  // Carried so a redo re-inserts the note. null/absent → no note.
  memo?: string | null;
};

function insertTransferPair(
  db: ReturnType<typeof getDb>,
  params: {
    outflowTxnId: string;
    inflowTxnId: string;
    fromAccountId: string;
    toAccountId: string;
    fromName: string;
    toName: string;
    amount: number;
    date: string;
    timestamp: string;
    source: TransactionSource;
    memo: string | null;
  }
): { payeeOutflow: string; payeeInflow: string } {
  const {
    outflowTxnId,
    inflowTxnId,
    fromAccountId,
    toAccountId,
    fromName,
    toName,
    amount,
    date,
    timestamp,
    source,
    memo,
  } = params;

  const payeeOutflow = `Transfer to ${toName}`;
  const payeeInflow = `Transfer from ${fromName}`;

  const insert = db.prepare(
    `INSERT INTO transactions
       (id, user_id, account_id, date, payee, memo, amount, category_id, transfer_account_id, cleared, approved, is_split_parent, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 1, 0, ?, ?, ?)`
  );

  insert.run(
    outflowTxnId,
    DEFAULT_USER_ID,
    fromAccountId,
    date,
    payeeOutflow,
    memo,
    -amount,
    toAccountId,
    source,
    timestamp,
    timestamp
  );

  insert.run(
    inflowTxnId,
    DEFAULT_USER_ID,
    toAccountId,
    date,
    payeeInflow,
    memo,
    amount,
    fromAccountId,
    source,
    timestamp,
    timestamp
  );

  // Route balance writes through applyToBalance so each leg is gated by the
  // txn's date (260603-bdb). updated_at refresh is separated since the helper
  // doesn't touch it.
  // Both legs are inserted approved (the INSERT above omits the column, so it
  // takes the schema default of 1).
  applyToBalance(db, { account_id: fromAccountId, date, amount: -amount, approved: true });
  applyToBalance(db, { account_id: toAccountId, date, amount, approved: true });
  const refreshUpdatedAt = db.prepare(
    "UPDATE accounts SET updated_at = ? WHERE id = ? AND user_id = ?"
  );
  refreshUpdatedAt.run(timestamp, fromAccountId, DEFAULT_USER_ID);
  refreshUpdatedAt.run(timestamp, toAccountId, DEFAULT_USER_ID);

  return { payeeOutflow, payeeInflow };
}

export async function createTransferPairWithSnapshot(
  input: TransferPairInput
): Promise<TransferPairSnapshot> {
  const { fromAccountId, toAccountId, date } = input;
  const amount = roundCents(input.amount);
  const source: TransactionSource = input.source ?? "desktop";
  const memo = input.memo?.trim() || null;

  if (!fromAccountId || !toAccountId) {
    throw new Error("From and to accounts are required.");
  }
  if (fromAccountId === toAccountId) {
    throw new Error("From and to accounts must be different.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Transfer amount must be greater than zero.");
  }
  if (!date) {
    throw new Error("Transfer date is required.");
  }

  const db = getDb();
  const accounts = db
    .prepare(
      "SELECT id, name FROM accounts WHERE user_id = ? AND id IN (?, ?)"
    )
    .all(DEFAULT_USER_ID, fromAccountId, toAccountId) as { id: string; name: string }[];

  if (accounts.length !== 2) {
    throw new Error("One or both accounts could not be found.");
  }

  const fromName = accounts.find((a) => a.id === fromAccountId)?.name ?? "";
  const toName = accounts.find((a) => a.id === toAccountId)?.name ?? "";

  const outflowTxnId = newId();
  const inflowTxnId = newId();
  const timestamp = now();

  const { payeeOutflow, payeeInflow } = db.transaction(() =>
    insertTransferPair(db, {
      outflowTxnId,
      inflowTxnId,
      fromAccountId,
      toAccountId,
      fromName,
      toName,
      amount,
      date,
      timestamp,
      source,
      memo,
    })
  )();

  revalidateMoneyPages();

  return {
    outflowTxnId,
    inflowTxnId,
    fromAccountId,
    toAccountId,
    amount,
    date,
    payeeOutflow,
    payeeInflow,
    source,
    memo,
  };
}

export async function undoTransferPair(
  snapshot: TransferPairSnapshot
): Promise<void> {
  const db = getDb();
  const timestamp = now();

  db.transaction(() => {
    const rows = db
      .prepare(
        "SELECT id, account_id, amount, date, approved FROM transactions WHERE user_id = ? AND id IN (?, ?)"
      )
      .all(DEFAULT_USER_ID, snapshot.outflowTxnId, snapshot.inflowTxnId) as {
        id: string;
        account_id: string;
        amount: number;
        date: string;
        approved: number;
      }[];

    if (rows.length !== 2) {
      throw new Error("Transfer pair not found -- may have already been undone");
    }

    const refreshUpdatedAt = db.prepare(
      "UPDATE accounts SET updated_at = ? WHERE id = ? AND user_id = ?"
    );
    for (const row of rows) {
      // Each leg's reversal gated by its own date (260603-bdb).
      applyToBalance(db, {
        account_id: row.account_id,
        date: row.date,
        amount: -row.amount,
        approved: row.approved,
      });
      refreshUpdatedAt.run(timestamp, row.account_id, DEFAULT_USER_ID);
    }

    db.prepare(
      "DELETE FROM transactions WHERE user_id = ? AND id IN (?, ?)"
    ).run(DEFAULT_USER_ID, snapshot.outflowTxnId, snapshot.inflowTxnId);
  })();

  revalidateMoneyPages();
}

export async function redoTransferPair(
  snapshot: TransferPairSnapshot
): Promise<TransferPairSnapshot> {
  const db = getDb();
  const accounts = db
    .prepare("SELECT id, name FROM accounts WHERE user_id = ? AND id IN (?, ?)")
    .all(DEFAULT_USER_ID, snapshot.fromAccountId, snapshot.toAccountId) as {
      id: string;
      name: string;
    }[];

  if (accounts.length !== 2) {
    throw new Error("One or both accounts could not be found.");
  }

  const fromName = accounts.find((a) => a.id === snapshot.fromAccountId)?.name ?? "";
  const toName = accounts.find((a) => a.id === snapshot.toAccountId)?.name ?? "";

  const outflowTxnId = newId();
  const inflowTxnId = newId();
  const timestamp = now();

  const redoSource: TransactionSource = snapshot.source ?? "desktop";

  const { payeeOutflow, payeeInflow } = db.transaction(() =>
    insertTransferPair(db, {
      outflowTxnId,
      inflowTxnId,
      fromAccountId: snapshot.fromAccountId,
      toAccountId: snapshot.toAccountId,
      fromName,
      toName,
      amount: snapshot.amount,
      date: snapshot.date,
      timestamp,
      source: redoSource,
      memo: snapshot.memo ?? null,
    })
  )();

  revalidateMoneyPages();

  return {
    outflowTxnId,
    inflowTxnId,
    fromAccountId: snapshot.fromAccountId,
    toAccountId: snapshot.toAccountId,
    amount: snapshot.amount,
    date: snapshot.date,
    payeeOutflow,
    payeeInflow,
    source: redoSource,
    memo: snapshot.memo ?? null,
  };
}

// ---------------------------------------------------------------------------
// Transfer pair EDIT — mutate both legs of an existing transfer in one shot.
//
// A transfer is two ordinary rows sharing an implicit invariant (swapped
// accounts, mirrored amount, same date). Editing one leg inline would desync
// the pair, so all transfer edits route here. Legs are updated IN PLACE (not
// deleted/reinserted) so `approved`, `cleared`, `source`, `memo`, and the row
// ids all survive — which keeps undo/redo stable (the snapshot carries the two
// leg ids and the before/after states; applying a state re-reads live balance
// so it reverses correctly regardless of direction).
// ---------------------------------------------------------------------------

type TransferLegState = {
  fromAccountId: string;
  toAccountId: string;
  amount: number; // positive magnitude
  date: string;
};

export type TransferPairEditSnapshot = {
  outflowTxnId: string; // always holds the from-side (negative) leg
  inflowTxnId: string; // always holds the to-side (positive) leg
  before: TransferLegState;
  after: TransferLegState;
};

// Reverse the current balance effect of both legs, rewrite them to `state`, and
// apply the new balance effect. Reads live rows so it's correct for edit, undo,
// and redo alike. Assumes it runs inside a db.transaction().
function applyTransferPairState(
  db: ReturnType<typeof getDb>,
  params: {
    outflowTxnId: string;
    inflowTxnId: string;
    state: TransferLegState;
    timestamp: string;
  }
): void {
  const { outflowTxnId, inflowTxnId, state, timestamp } = params;
  const { fromAccountId, toAccountId, date } = state;
  const amount = roundCents(state.amount);

  const current = db
    .prepare(
      "SELECT id, account_id, amount, date, approved FROM transactions WHERE user_id = ? AND id IN (?, ?)"
    )
    .all(DEFAULT_USER_ID, outflowTxnId, inflowTxnId) as {
      id: string;
      account_id: string;
      amount: number;
      date: string;
      approved: number;
    }[];

  if (current.length !== 2) {
    throw new Error("Transfer pair not found -- may have been deleted");
  }

  const touched = new Set<string>();

  // Reverse each leg's current balance effect, gated by its own date.
  for (const row of current) {
    applyToBalance(db, {
      account_id: row.account_id,
      date: row.date,
      amount: -row.amount,
      approved: row.approved,
    });
    touched.add(row.account_id);
  }

  const accounts = db
    .prepare("SELECT id, name FROM accounts WHERE user_id = ? AND id IN (?, ?)")
    .all(DEFAULT_USER_ID, fromAccountId, toAccountId) as {
      id: string;
      name: string;
    }[];
  if (accounts.length !== 2) {
    throw new Error("One or both accounts could not be found.");
  }
  const fromName = accounts.find((a) => a.id === fromAccountId)?.name ?? "";
  const toName = accounts.find((a) => a.id === toAccountId)?.name ?? "";

  const update = db.prepare(
    `UPDATE transactions
        SET account_id = ?, transfer_account_id = ?, amount = ?, payee = ?, date = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`
  );
  // From-side leg: negative amount, points at the to-account.
  update.run(
    fromAccountId,
    toAccountId,
    -amount,
    `Transfer to ${toName}`,
    date,
    timestamp,
    outflowTxnId,
    DEFAULT_USER_ID
  );
  // To-side leg: positive amount, points at the from-account.
  update.run(
    toAccountId,
    fromAccountId,
    amount,
    `Transfer from ${fromName}`,
    date,
    timestamp,
    inflowTxnId,
    DEFAULT_USER_ID
  );

  // Apply the new balance effect for each leg — approval carried from the row
  // being edited, so the apply is gated the same way its reversal above was.
  const outflowApproved =
    current.find((r) => r.id === outflowTxnId)?.approved ?? 1;
  const inflowApproved =
    current.find((r) => r.id === inflowTxnId)?.approved ?? 1;
  applyToBalance(db, {
    account_id: fromAccountId,
    date,
    amount: -amount,
    approved: outflowApproved,
  });
  applyToBalance(db, {
    account_id: toAccountId,
    date,
    amount,
    approved: inflowApproved,
  });
  touched.add(fromAccountId);
  touched.add(toAccountId);

  const refreshUpdatedAt = db.prepare(
    "UPDATE accounts SET updated_at = ? WHERE id = ? AND user_id = ?"
  );
  for (const id of touched) {
    refreshUpdatedAt.run(timestamp, id, DEFAULT_USER_ID);
  }
}

export async function updateTransferPairWithSnapshot(input: {
  // Any one leg of the pair — the sibling is resolved server-side, so this
  // works even when the other leg is filtered out of the caller's view.
  txnId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
}): Promise<TransferPairEditSnapshot> {
  const { txnId, fromAccountId, toAccountId, date } = input;
  const amount = roundCents(input.amount);

  if (!fromAccountId || !toAccountId) {
    throw new Error("From and to accounts are required.");
  }
  if (fromAccountId === toAccountId) {
    throw new Error("From and to accounts must be different.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Transfer amount must be greater than zero.");
  }
  if (!date) {
    throw new Error("Transfer date is required.");
  }

  const db = getDb();

  const snapshot = db.transaction((): TransferPairEditSnapshot => {
    const leg = db
      .prepare(
        "SELECT id, account_id, amount, transfer_account_id, date FROM transactions WHERE id = ? AND user_id = ?"
      )
      .get(txnId, DEFAULT_USER_ID) as {
        id: string;
        account_id: string;
        amount: number;
        transfer_account_id: string | null;
        date: string;
      } | undefined;

    if (!leg) throw new Error("Transfer not found.");
    if (leg.transfer_account_id === null) {
      throw new Error("This transaction is not a transfer.");
    }

    // Resolve the sibling via the transfer invariant (swapped accounts,
    // mirrored amount, same date). Mirrors findTransferSibling in the
    // transactions actions; kept inline because that helper is sync-private
    // to a "use server" module and can't be imported.
    const sibling = db
      .prepare(
        `SELECT id, account_id, amount, transfer_account_id, date
           FROM transactions
          WHERE user_id = ?
            AND id != ?
            AND account_id = ?
            AND transfer_account_id = ?
            AND date = ?
            AND amount = ?
          ORDER BY created_at ASC
          LIMIT 1`
      )
      .get(
        DEFAULT_USER_ID,
        leg.id,
        leg.transfer_account_id,
        leg.account_id,
        leg.date,
        -Number(leg.amount)
      ) as {
        id: string;
        account_id: string;
        amount: number;
        transfer_account_id: string | null;
        date: string;
      } | undefined;

    if (!sibling) {
      throw new Error("Transfer sibling not found -- pair may be broken.");
    }

    // The from-side leg is the negative one; the to-side leg is positive.
    const outflow = Number(leg.amount) < 0 ? leg : sibling;
    const inflow = Number(leg.amount) < 0 ? sibling : leg;

    const before: TransferLegState = {
      fromAccountId: outflow.account_id,
      toAccountId: inflow.account_id,
      amount: Math.abs(Number(outflow.amount)),
      date: outflow.date,
    };
    const after: TransferLegState = { fromAccountId, toAccountId, amount, date };

    applyTransferPairState(db, {
      outflowTxnId: outflow.id,
      inflowTxnId: inflow.id,
      state: after,
      timestamp: now(),
    });

    return {
      outflowTxnId: outflow.id,
      inflowTxnId: inflow.id,
      before,
      after,
    };
  })();

  revalidateMoneyPages();
  return snapshot;
}

export async function undoTransferPairEdit(
  snapshot: TransferPairEditSnapshot
): Promise<void> {
  const db = getDb();
  db.transaction(() => {
    applyTransferPairState(db, {
      outflowTxnId: snapshot.outflowTxnId,
      inflowTxnId: snapshot.inflowTxnId,
      state: snapshot.before,
      timestamp: now(),
    });
  })();
  revalidateMoneyPages();
}

export async function redoTransferPairEdit(
  snapshot: TransferPairEditSnapshot
): Promise<void> {
  const db = getDb();
  db.transaction(() => {
    applyTransferPairState(db, {
      outflowTxnId: snapshot.outflowTxnId,
      inflowTxnId: snapshot.inflowTxnId,
      state: snapshot.after,
      timestamp: now(),
    });
  })();
  revalidateMoneyPages();
}
