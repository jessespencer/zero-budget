"use server";

import { getDb, DEFAULT_USER_ID } from "@/lib/db";
import { newId, now, mapRows } from "@/lib/db-utils";
import { applyToBalance } from "@/lib/balance";
import { revalidatePath } from "next/cache";
import { computeNextDate, computeInitialNextDate } from "@/lib/schedule-utils";
import type {
  ScheduledTransaction,
  ScheduledTransactionWithDetails,
  ScheduleFrequency,
} from "@/lib/types";
import { format } from "date-fns";

function revalidateAll() {
  revalidatePath("/schedules");
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

function today(): string {
  return format(new Date(), "yyyy-MM-dd");
}

// ─── Queries ─────────────────────────────────────────────────

export async function getSchedules(): Promise<ScheduledTransactionWithDetails[]> {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT s.*,
              a.name AS account_name,
              c.name AS category_name,
              CASE WHEN EXISTS (
                SELECT 1 FROM transactions t
                WHERE t.schedule_id = s.id AND t.date = s.next_date AND t.user_id = ?
              ) THEN 1 ELSE 0 END AS has_paid_transaction
       FROM scheduled_transactions s
       LEFT JOIN accounts a ON a.id = s.account_id
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.user_id = ?
       ORDER BY s.completed ASC, s.next_date ASC`
    )
    .all(DEFAULT_USER_ID, DEFAULT_USER_ID) as Record<string, unknown>[];

  return mapRows<ScheduledTransactionWithDetails>(rows);
}

export async function getAccountsAndCategories() {
  const db = getDb();

  const accounts = mapRows<{
    id: string;
    name: string;
    type: string;
    is_budget_account: boolean;
  }>(
    db
      .prepare(
        `SELECT id, name, type, is_budget_account FROM accounts
         WHERE user_id = ? AND archived = 0
         ORDER BY sort_order`
      )
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );

  const categories = db
    .prepare(
      `SELECT id, name, category_group_id FROM categories
       WHERE user_id = ? AND archived = 0
       ORDER BY sort_order`
    )
    .all(DEFAULT_USER_ID) as {
    id: string;
    name: string;
    category_group_id: string;
  }[];

  const categoryGroups = mapRows<{
    id: string;
    name: string;
    is_income: boolean;
    is_system: boolean;
  }>(
    db
      .prepare(
        `SELECT id, name, is_income, is_system FROM category_groups
         WHERE user_id = ?
         ORDER BY sort_order`
      )
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );

  return { accounts, categories, categoryGroups };
}

// ─── Create ──────────────────────────────────────────────────

export type CreateScheduleInput = {
  name?: string;
  account_id: string;
  payee?: string;
  category_id?: string;
  amount: number;
  memo?: string;
  frequency: ScheduleFrequency;
  interval?: number;
  start_date: string;
  end_date?: string;
  day_of_month?: number;
  day_of_week?: number;
  skip_weekend?: string;
  posts_transaction?: boolean;
};

export async function createSchedule(input: CreateScheduleInput) {
  const db = getDb();
  const id = newId();
  const timestamp = now();

  const config = {
    frequency: input.frequency,
    interval: input.interval ?? 1,
    start_date: input.start_date,
    end_date: input.end_date ?? null,
    day_of_month: input.day_of_month ?? null,
    day_of_week: input.day_of_week ?? null,
    skip_weekend: input.skip_weekend ?? null,
  };

  const nextDate = computeInitialNextDate(config);

  db.prepare(
    `INSERT INTO scheduled_transactions
       (id, user_id, name, account_id, payee, category_id, amount, memo,
        frequency, interval, start_date, end_date, day_of_month, day_of_week,
        skip_weekend, next_date, posts_transaction, completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    DEFAULT_USER_ID,
    input.name || null,
    input.account_id,
    input.payee || null,
    input.category_id || null,
    input.amount,
    input.memo || null,
    input.frequency,
    input.interval ?? 1,
    input.start_date,
    input.end_date || null,
    input.day_of_month ?? null,
    input.day_of_week ?? null,
    input.skip_weekend || null,
    nextDate,
    input.posts_transaction !== false ? 1 : 0,
    timestamp,
    timestamp
  );

  revalidateAll();
}

// ─── Update ──────────────────────────────────────────────────

export async function updateSchedule(
  id: string,
  updates: Partial<CreateScheduleInput>
) {
  const db = getDb();

  const existing = db
    .prepare(
      `SELECT * FROM scheduled_transactions WHERE id = ? AND user_id = ?`
    )
    .get(id, DEFAULT_USER_ID) as Record<string, unknown> | undefined;

  if (!existing) return;

  const setClauses: string[] = [];
  const params: unknown[] = [];

  const fields: Record<string, unknown> = {
    name: updates.name,
    account_id: updates.account_id,
    payee: updates.payee,
    category_id: updates.category_id,
    amount: updates.amount,
    memo: updates.memo,
    frequency: updates.frequency,
    interval: updates.interval,
    start_date: updates.start_date,
    end_date: updates.end_date,
    day_of_month: updates.day_of_month,
    day_of_week: updates.day_of_week,
    skip_weekend: updates.skip_weekend,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      setClauses.push(`${key} = ?`);
      params.push(value === "" ? null : value);
    }
  }

  if (updates.posts_transaction !== undefined) {
    setClauses.push("posts_transaction = ?");
    params.push(updates.posts_transaction ? 1 : 0);
  }

  // Only recompute next_date if recurrence fields actually changed from existing values
  const recurrenceFields = {
    frequency: updates.frequency,
    interval: updates.interval,
    start_date: updates.start_date,
    end_date: updates.end_date,
    day_of_month: updates.day_of_month,
    day_of_week: updates.day_of_week,
    skip_weekend: updates.skip_weekend,
  };

  const recurrenceActuallyChanged = Object.entries(recurrenceFields).some(
    ([key, value]) => {
      if (value === undefined) return false;
      const existingVal = existing[key];
      // Normalize: treat "" and null as equivalent
      const normalizedNew = value === "" ? null : value;
      const normalizedExisting = existingVal === "" ? null : existingVal;
      return normalizedNew !== normalizedExisting;
    }
  );

  if (recurrenceActuallyChanged) {
    const config = {
      frequency: (updates.frequency ?? existing.frequency) as ScheduleFrequency,
      interval: (updates.interval ?? existing.interval) as number,
      start_date: (updates.start_date ?? existing.start_date) as string,
      end_date: (updates.end_date ?? existing.end_date) as string | null,
      day_of_month: (updates.day_of_month ?? existing.day_of_month) as number | null,
      day_of_week: (updates.day_of_week ?? existing.day_of_week) as number | null,
      skip_weekend: (updates.skip_weekend ?? existing.skip_weekend) as string | null,
    };
    // Use today as floor so next_date never regresses to the past
    const todayStr = today();
    const nextDate = computeNextDate(config, todayStr) ?? computeInitialNextDate(config);
    setClauses.push("next_date = ?");
    params.push(nextDate);
  }

  if (setClauses.length === 0) return;

  setClauses.push("updated_at = ?");
  params.push(now());

  db.prepare(
    `UPDATE scheduled_transactions SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`
  ).run(...params, id, DEFAULT_USER_ID);

  revalidateAll();
}

// ─── Delete ──────────────────────────────────────────────────

export async function deleteSchedule(id: string) {
  const db = getDb();
  db.prepare(
    `DELETE FROM scheduled_transactions WHERE id = ? AND user_id = ?`
  ).run(id, DEFAULT_USER_ID);
  revalidateAll();
}

export type ScheduleSnapshot = ScheduledTransaction;

// Snapshot variant so a deleted schedule can be brought back. A schedule is a
// single self-contained row, so the whole thing round-trips: capture before the
// DELETE, re-INSERT at the original id on restore.
//
// Transactions the schedule already posted are untouched either way —
// schedule_id is ON DELETE SET NULL (migration 002). Restoring at the same id
// does NOT re-link them, since SET NULL already discarded the reference. That's
// acceptable: the link is provenance metadata, not money.
export async function deleteScheduleWithSnapshot(
  id: string
): Promise<ScheduleSnapshot | null> {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM scheduled_transactions WHERE id = ? AND user_id = ?`)
    .get(id, DEFAULT_USER_ID) as Record<string, unknown> | undefined;
  if (!row) return null;

  const snapshot = mapRows<ScheduledTransaction>([row])[0];
  db.prepare(
    `DELETE FROM scheduled_transactions WHERE id = ? AND user_id = ?`
  ).run(id, DEFAULT_USER_ID);
  revalidateAll();
  return snapshot;
}

// Returns whether a row was actually inserted. OR IGNORE (see below) swallows
// every constraint failure, not just the PK collision it's here for — a
// category hard-deleted between the delete and the undo would fail the FK and
// leave the restore a silent no-op. Callers surface that instead of reporting
// an undo that didn't happen.
export async function restoreScheduleSnapshot(
  snapshot: ScheduleSnapshot
): Promise<boolean> {
  const db = getDb();
  // OR IGNORE, not OR REPLACE: SQLite implements REPLACE as DELETE-then-INSERT,
  // and with foreign_keys=ON that DELETE fires `transactions.schedule_id ON
  // DELETE SET NULL` (migration 002) — restoring over a live row would orphan
  // every transaction the schedule ever posted and silently weaken the
  // duplicate guard in postDueSchedules. Matches restoreCategoryDeletionSnapshot.
  const result = db.prepare(
    `INSERT OR IGNORE INTO scheduled_transactions
       (id, user_id, name, account_id, payee, category_id, amount, memo,
        frequency, interval, start_date, end_date, day_of_month, day_of_week,
        skip_weekend, next_date, posts_transaction, completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    snapshot.id,
    DEFAULT_USER_ID,
    snapshot.name,
    snapshot.account_id,
    snapshot.payee,
    snapshot.category_id,
    snapshot.amount,
    snapshot.memo,
    snapshot.frequency,
    snapshot.interval,
    snapshot.start_date,
    snapshot.end_date,
    snapshot.day_of_month,
    snapshot.day_of_week,
    snapshot.skip_weekend,
    snapshot.next_date,
    snapshot.posts_transaction ? 1 : 0,
    snapshot.completed ? 1 : 0,
    snapshot.created_at,
    now()
  );
  if (result.changes === 0) return false;
  revalidateAll();
  return true;
}

// ─── Post transaction ────────────────────────────────────────

export async function postScheduleTransaction(
  id: string,
  useToday = false
) {
  const db = getDb();

  const schedule = db
    .prepare(
      `SELECT * FROM scheduled_transactions WHERE id = ? AND user_id = ?`
    )
    .get(id, DEFAULT_USER_ID) as Record<string, unknown> | undefined;

  if (!schedule) return;

  const txnDate = useToday ? today() : (schedule.next_date as string);

  db.transaction(() => {
    // Create the real transaction. Scheduled posts feel like desktop
    // automation (cron-triggered or "Pay now" from the desktop schedules
    // table), so the source flag is 'desktop'. See SEED-014 / migration 018.
    insertScheduledTransaction(db, schedule, txnDate);

    // Advance schedule to next date
    advanceScheduleInTransaction(db, schedule);
  })();

  revalidateAll();
}

// ─── Skip ────────────────────────────────────────────────────

export async function skipScheduleDate(id: string) {
  const db = getDb();

  const schedule = db
    .prepare(
      `SELECT * FROM scheduled_transactions WHERE id = ? AND user_id = ?`
    )
    .get(id, DEFAULT_USER_ID) as Record<string, unknown> | undefined;

  if (!schedule) return;

  advanceScheduleInTransaction(db, schedule);
  revalidateAll();
}

// ─── Complete / Restart ──────────────────────────────────────

export async function completeSchedule(id: string) {
  const db = getDb();
  db.prepare(
    `UPDATE scheduled_transactions SET completed = 1, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(now(), id, DEFAULT_USER_ID);
  revalidateAll();
}

export async function restartSchedule(id: string) {
  const db = getDb();

  const schedule = db
    .prepare(
      `SELECT * FROM scheduled_transactions WHERE id = ? AND user_id = ?`
    )
    .get(id, DEFAULT_USER_ID) as Record<string, unknown> | undefined;

  if (!schedule) return;

  const config = {
    frequency: schedule.frequency as ScheduleFrequency,
    interval: schedule.interval as number,
    start_date: schedule.start_date as string,
    end_date: schedule.end_date as string | null,
    day_of_month: schedule.day_of_month as number | null,
    day_of_week: schedule.day_of_week as number | null,
    skip_weekend: schedule.skip_weekend as string | null,
  };

  // Compute next date from today
  const todayStr = today();
  const nextDate = computeNextDate(config, todayStr) ?? (schedule.next_date as string);

  db.prepare(
    `UPDATE scheduled_transactions SET completed = 0, next_date = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(nextDate, now(), id, DEFAULT_USER_ID);

  revalidateAll();
}

// ─── Auto-post due schedules ─────────────────────────────────

// `revalidate: false` is for the render-time caller (the (app) layout).
// revalidatePath() throws if called during a render pass, and it's redundant
// there anyway: the layout posts before it reads, and the whole (app) segment
// is `dynamic = "force-dynamic"`, so every route re-reads SQLite per request.
// Interactive callers (the row menu) keep the default and revalidate normally.
export async function postDueSchedules({
  revalidate = true,
}: { revalidate?: boolean } = {}) {
  const db = getDb();
  const todayStr = today();

  const dueIds = (
    db
      .prepare(
        `SELECT id FROM scheduled_transactions
         WHERE user_id = ? AND completed = 0 AND posts_transaction = 1
           AND next_date <= ?`
      )
      .all(DEFAULT_USER_ID, todayStr) as { id: string }[]
  ).map((row) => row.id);

  const readSchedule = db.prepare(
    `SELECT * FROM scheduled_transactions WHERE id = ? AND user_id = ?`
  );
  const alreadyPosted = db.prepare(
    `SELECT 1 FROM transactions
     WHERE schedule_id = ? AND date = ? AND user_id = ? LIMIT 1`
  );

  let changed = false;

  for (const id of dueIds) {
    // Post EVERY missed occurrence, not just the oldest one. The scan used to
    // post one per schedule per call, so after a few months away a monthly
    // schedule caught up one month per page load and the balances shifted on
    // each navigation until it was current.
    //
    // Each occurrence is its own transaction, so a failure part-way keeps the
    // earlier posts and the schedule's next_date in step with them. The loop
    // ends because every pass moves next_date strictly forward or completes
    // the schedule; the cap is a backstop against a recurrence bug, not a
    // limit anyone should reach.
    for (let pass = 0; pass < MAX_CATCH_UP_POSTS; pass++) {
      const schedule = readSchedule.get(id, DEFAULT_USER_ID) as
        | Record<string, unknown>
        | undefined;
      if (!schedule || schedule.completed || (schedule.next_date as string) > todayStr) {
        break;
      }

      const dueDate = schedule.next_date as string;
      db.transaction(() => {
        // The duplicate guard. A transaction already linked to this schedule
        // on its due date means the occurrence is paid — the schedules table
        // shows it as "paid" — so the schedule advances WITHOUT posting a
        // second copy. It used to exclude the schedule from the scan instead,
        // which never advanced it: re-dating a posted transaction onto the
        // next due date left the schedule stuck for good.
        if (!alreadyPosted.get(id, dueDate, DEFAULT_USER_ID)) {
          // Auto-posted due schedules also stamp as 'desktop' — see
          // postScheduleTransaction above for rationale.
          insertScheduledTransaction(db, schedule, dueDate);
        }
        advanceScheduleInTransaction(db, schedule);
      })();
      changed = true;
    }
  }

  if (changed && revalidate) {
    revalidateAll();
  }
}

// ─── Internal helpers ────────────────────────────────────────

// See the loop in postDueSchedules. A daily schedule left alone for a decade
// is ~3,650 occurrences; anything past this cap waits for the next page load.
const MAX_CATCH_UP_POSTS = 5000;

// Insert one posted occurrence of `schedule`, dated `date`, and move the
// balance for it. Callers hold a transaction and advance the schedule after.
function insertScheduledTransaction(
  db: ReturnType<typeof getDb>,
  schedule: Record<string, unknown>,
  date: string
) {
  const timestamp = now();
  const amount = schedule.amount as number;
  const accountId = schedule.account_id as string;
  const payee = schedule.payee as string | null;
  const categoryId = schedule.category_id as string | null;

  db.prepare(
    `INSERT INTO transactions
       (id, user_id, date, payee, memo, amount, account_id, category_id,
        cleared, approved, schedule_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, 'desktop', ?, ?)`
  ).run(
    newId(),
    DEFAULT_USER_ID,
    date,
    payee,
    schedule.memo as string | null,
    amount,
    accountId,
    categoryId,
    schedule.id as string,
    timestamp,
    timestamp
  );

  // Gated by the transaction's date (260603-bdb): occurrences dated before
  // the budget start month are historical and don't move the balance.
  applyToBalance(db, {
    account_id: accountId,
    date,
    amount,
    // Posted schedules insert approved = 1 (see the INSERT above).
    approved: true,
  });

  // Upsert payee for auto-complete
  if (payee) {
    db.prepare(
      `INSERT INTO payees (id, user_id, name, default_category_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, name) DO UPDATE SET
         default_category_id = COALESCE(payees.default_category_id, excluded.default_category_id)`
    ).run(newId(), DEFAULT_USER_ID, payee, categoryId);
  }
}

function advanceScheduleInTransaction(
  db: ReturnType<typeof getDb>,
  schedule: Record<string, unknown>
) {
  const frequency = schedule.frequency as ScheduleFrequency;
  const scheduleId = schedule.id as string;

  // One-time schedules complete after posting
  if (frequency === "once") {
    db.prepare(
      `UPDATE scheduled_transactions SET completed = 1, updated_at = ? WHERE id = ?`
    ).run(now(), scheduleId);
    return;
  }

  const config = {
    frequency,
    interval: schedule.interval as number,
    start_date: schedule.start_date as string,
    end_date: schedule.end_date as string | null,
    day_of_month: schedule.day_of_month as number | null,
    day_of_week: schedule.day_of_week as number | null,
    skip_weekend: schedule.skip_weekend as string | null,
  };

  const nextDate = computeNextDate(config, schedule.next_date as string);

  if (nextDate) {
    db.prepare(
      `UPDATE scheduled_transactions SET next_date = ?, updated_at = ? WHERE id = ?`
    ).run(nextDate, now(), scheduleId);
  } else {
    // No more occurrences — mark completed
    db.prepare(
      `UPDATE scheduled_transactions SET completed = 1, updated_at = ? WHERE id = ?`
    ).run(now(), scheduleId);
  }
}
