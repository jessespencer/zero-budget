import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { __resetCutoffCache } from "@/lib/balance";
import type { ScheduleSnapshot } from "@/app/(app)/schedules/actions";

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  // 260603-bdb: lower the cutoff so schedule next_dates of "2026-04-01"
  // still move balances when posted. The cutoff semantics are covered by
  // __tests__/unit/lib/balance.test.ts; this suite tests schedule mechanics.
  db.prepare(
    `UPDATE app_settings SET value = '1900-01-01' WHERE key = 'budget_start_month'`
  ).run();
  __resetCutoffCache();

  // Seed a default account
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 1, 0, 0, 0)`
  ).run("acct-1", USER_ID, "Checking", "checking");
});

afterEach(() => {
  clearTestDb();
  __resetCutoffCache();
  db.close();
  vi.useRealTimers();
});

describe("schedule actions", () => {
  it("createSchedule inserts with computed next_date", async () => {
    const { createSchedule } = await import("@/app/(app)/schedules/actions");

    await createSchedule({
      account_id: "acct-1",
      amount: -1500,
      frequency: "monthly",
      start_date: "2026-04-01",
      day_of_month: 1,
      payee: "Landlord",
    });

    const rows = db
      .prepare("SELECT * FROM scheduled_transactions WHERE user_id = ?")
      .all(USER_ID) as Record<string, unknown>[];

    expect(rows).toHaveLength(1);
    expect(rows[0].payee).toBe("Landlord");
    expect(rows[0].amount).toBe(-1500);
    expect(rows[0].next_date).toBe("2026-04-01");
    expect(rows[0].frequency).toBe("monthly");
  });

  it("deleteSchedule removes the schedule", async () => {
    const { createSchedule, deleteSchedule } = await import("@/app/(app)/schedules/actions");

    await createSchedule({
      account_id: "acct-1",
      amount: -100,
      frequency: "monthly",
      start_date: "2026-04-01",
    });

    const schedule = db
      .prepare("SELECT id FROM scheduled_transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as { id: string };

    await deleteSchedule(schedule.id);

    const count = db
      .prepare("SELECT COUNT(*) as count FROM scheduled_transactions WHERE user_id = ?")
      .get(USER_ID) as { count: number };

    expect(count.count).toBe(0);
  });

  it("postScheduleTransaction creates transaction and advances schedule", async () => {
    const { createSchedule, postScheduleTransaction } = await import("@/app/(app)/schedules/actions");

    await createSchedule({
      account_id: "acct-1",
      amount: -1500,
      frequency: "monthly",
      start_date: "2026-04-01",
      day_of_month: 1,
      payee: "Landlord",
    });

    const schedule = db
      .prepare("SELECT id FROM scheduled_transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as { id: string };

    await postScheduleTransaction(schedule.id);

    // Transaction was created
    const txns = db
      .prepare("SELECT * FROM transactions WHERE user_id = ?")
      .all(USER_ID) as Record<string, unknown>[];
    expect(txns).toHaveLength(1);
    expect(txns[0].payee).toBe("Landlord");
    expect(txns[0].amount).toBe(-1500);
    expect(txns[0].schedule_id).toBe(schedule.id);

    // Account balance updated
    const acct = db
      .prepare("SELECT current_balance FROM accounts WHERE id = ?")
      .get("acct-1") as { current_balance: number };
    expect(acct.current_balance).toBe(-1500);

    // Schedule advanced to next month
    const updated = db
      .prepare("SELECT next_date FROM scheduled_transactions WHERE id = ?")
      .get(schedule.id) as { next_date: string };
    expect(updated.next_date).toBe("2026-05-01");
  });

  it("completeSchedule marks schedule as completed", async () => {
    const { createSchedule, completeSchedule } = await import("@/app/(app)/schedules/actions");

    await createSchedule({
      account_id: "acct-1",
      amount: -100,
      frequency: "monthly",
      start_date: "2026-04-01",
    });

    const schedule = db
      .prepare("SELECT id FROM scheduled_transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as { id: string };

    await completeSchedule(schedule.id);

    const row = db
      .prepare("SELECT completed FROM scheduled_transactions WHERE id = ?")
      .get(schedule.id) as { completed: number };

    expect(row.completed).toBe(1);
  });

  it("skipScheduleDate advances to next date without creating transaction", async () => {
    const { createSchedule, skipScheduleDate } = await import("@/app/(app)/schedules/actions");

    await createSchedule({
      account_id: "acct-1",
      amount: -100,
      frequency: "monthly",
      start_date: "2026-04-01",
      day_of_month: 1,
    });

    const schedule = db
      .prepare("SELECT id FROM scheduled_transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as { id: string };

    await skipScheduleDate(schedule.id);

    // No transactions created
    const txnCount = db
      .prepare("SELECT COUNT(*) as count FROM transactions WHERE user_id = ?")
      .get(USER_ID) as { count: number };
    expect(txnCount.count).toBe(0);

    // Schedule advanced
    const updated = db
      .prepare("SELECT next_date FROM scheduled_transactions WHERE id = ?")
      .get(schedule.id) as { next_date: string };
    expect(updated.next_date).toBe("2026-05-01");
  });

  it("one-time schedule completes after posting", async () => {
    const { createSchedule, postScheduleTransaction } = await import("@/app/(app)/schedules/actions");

    await createSchedule({
      account_id: "acct-1",
      amount: -500,
      frequency: "once",
      start_date: "2026-04-15",
      payee: "One-time payment",
    });

    const schedule = db
      .prepare("SELECT id FROM scheduled_transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as { id: string };

    await postScheduleTransaction(schedule.id);

    const row = db
      .prepare("SELECT completed FROM scheduled_transactions WHERE id = ?")
      .get(schedule.id) as { completed: number };

    expect(row.completed).toBe(1);
  });

  it("postScheduleTransaction upserts payee", async () => {
    const { createSchedule, postScheduleTransaction } = await import("@/app/(app)/schedules/actions");

    await createSchedule({
      account_id: "acct-1",
      amount: -100,
      frequency: "monthly",
      start_date: "2026-04-01",
      payee: "Utility Co",
    });

    const schedule = db
      .prepare("SELECT id FROM scheduled_transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as { id: string };

    await postScheduleTransaction(schedule.id);

    const payee = db
      .prepare("SELECT name FROM payees WHERE user_id = ? AND name = ?")
      .get(USER_ID, "Utility Co") as { name: string } | undefined;

    expect(payee).toBeDefined();
  });
});

// ─── Delete + undo round-trip ────────────────────────────────
//
// The delete/restore pair is the only path that can resurrect a schedule, and
// a schedule is a recurring money rule — a restore that drops a column, or
// that quietly destroys the transactions the schedule already posted, is a
// money bug that no other test would catch.

describe("deleteScheduleWithSnapshot / restoreScheduleSnapshot", () => {
  const seedSchedule = async () => {
    const { createSchedule } = await import("@/app/(app)/schedules/actions");
    await createSchedule({
      account_id: "acct-1",
      amount: -1500,
      frequency: "monthly",
      start_date: "2026-04-01",
      day_of_month: 1,
      payee: "Landlord",
      name: "Rent",
    });
    return db
      .prepare("SELECT * FROM scheduled_transactions WHERE user_id = ? LIMIT 1")
      .get(USER_ID) as Record<string, unknown>;
  };

  it("restores every column verbatim", async () => {
    const { deleteScheduleWithSnapshot, restoreScheduleSnapshot } = await import(
      "@/app/(app)/schedules/actions"
    );
    const before = await seedSchedule();

    const snapshot = await deleteScheduleWithSnapshot(before.id as string);
    expect(snapshot).not.toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM scheduled_transactions").get()
    ).toEqual({ n: 0 });

    expect(await restoreScheduleSnapshot(snapshot!)).toBe(true);

    const after = db
      .prepare("SELECT * FROM scheduled_transactions WHERE id = ?")
      .get(before.id) as Record<string, unknown>;

    // Every column round-trips except updated_at, which restore deliberately
    // stamps fresh. Compare the whole row so a column added later that the
    // INSERT forgets fails here rather than silently resetting to its default.
    const { updated_at: _b, ...beforeRest } = before;
    const { updated_at: _a, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
  });

  it("restoring over a live schedule keeps its posted transactions linked", async () => {
    const { postScheduleTransaction, restoreScheduleSnapshot } = await import(
      "@/app/(app)/schedules/actions"
    );
    const { mapRows } = await import("@/lib/db-utils");
    const schedule = await seedSchedule();
    await postScheduleTransaction(schedule.id as string);

    const linked = () =>
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND schedule_id = ?"
          )
          .get(USER_ID, schedule.id) as { n: number }
      ).n;
    expect(linked()).toBe(1);

    // Snapshot the row while it is still LIVE, then restore on top of it. This
    // is the case INSERT OR REPLACE gets wrong: SQLite implements REPLACE as
    // DELETE-then-INSERT, and that DELETE fires `transactions.schedule_id ON
    // DELETE SET NULL` (migration 002), silently orphaning every transaction
    // the schedule ever posted. OR IGNORE leaves the live row alone.
    const live = mapRows<ScheduleSnapshot>([
      db
        .prepare("SELECT * FROM scheduled_transactions WHERE id = ?")
        .get(schedule.id) as Record<string, unknown>,
    ])[0];

    expect(await restoreScheduleSnapshot(live)).toBe(false);
    expect(linked()).toBe(1);
  });

  it("reports false when the restore is a no-op", async () => {
    const { deleteScheduleWithSnapshot, restoreScheduleSnapshot } = await import(
      "@/app/(app)/schedules/actions"
    );
    const schedule = await seedSchedule();
    const snapshot = await deleteScheduleWithSnapshot(schedule.id as string);

    expect(await restoreScheduleSnapshot(snapshot!)).toBe(true);
    // Second restore collides on the primary key. OR IGNORE swallows it, so
    // the boolean is the only signal the caller has that nothing happened.
    expect(await restoreScheduleSnapshot(snapshot!)).toBe(false);
  });

  it("does not re-post an occurrence that already posted", async () => {
    const {
      postScheduleTransaction,
      deleteScheduleWithSnapshot,
      restoreScheduleSnapshot,
      postDueSchedules,
    } = await import("@/app/(app)/schedules/actions");
    // Pin "now" between the occurrence that posts below and the next one, so
    // the only thing postDueSchedules could pick up is a resurrected stale
    // next_date. Without this the test drifts with the wall clock and later
    // occurrences post legitimately.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    const schedule = await seedSchedule();
    await postScheduleTransaction(schedule.id as string);

    const snapshot = await deleteScheduleWithSnapshot(schedule.id as string);
    await restoreScheduleSnapshot(snapshot!);

    // next_date advanced past the posted occurrence before the delete, so the
    // catch-up scan must not post it a second time on the way back.
    await postDueSchedules({ revalidate: false });

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?")
      .get(USER_ID) as { n: number };
    expect(count.n).toBe(1);
  });
});
