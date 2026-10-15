import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { ScheduleTable } from "@/components/schedules/schedule-table";
import type { ScheduledTransactionWithDetails } from "@/lib/types";

// Server actions are mocked: this tier asks "did the menu item call it and
// acknowledge the result", not "did the database end up right". The latter is
// schedule-actions.test.ts, which is already thorough — and which cannot see
// any of this, because none of it happens on the server.
vi.mock("@/app/(app)/schedules/actions", () => ({
  postScheduleTransaction: vi.fn(() => Promise.resolve()),
  skipScheduleDate: vi.fn(() => Promise.resolve()),
  completeSchedule: vi.fn(() => Promise.resolve()),
  restartSchedule: vi.fn(() => Promise.resolve()),
  deleteScheduleWithSnapshot: vi.fn(() => Promise.resolve(null)),
  restoreScheduleSnapshot: vi.fn(() => Promise.resolve(true)),
}));
import {
  postScheduleTransaction,
  skipScheduleDate,
  completeSchedule,
  restartSchedule,
} from "@/app/(app)/schedules/actions";

const SCHEDULE_ID = "sched-rent";

// Due, not completed, recurring — the one shape where every menu item renders.
function makeSchedule(
  overrides: Partial<ScheduledTransactionWithDetails> = {}
): ScheduledTransactionWithDetails {
  return {
    id: SCHEDULE_ID,
    user_id: "user-1",
    name: "Rent",
    account_id: "acct-checking",
    payee: "Landlord",
    category_id: "cat-housing",
    amount: -1800,
    memo: null,
    frequency: "monthly",
    interval: 1,
    start_date: "2026-01-01",
    end_date: null,
    day_of_month: 1,
    day_of_week: null,
    skip_weekend: null,
    next_date: "2026-07-01",
    posts_transaction: true,
    completed: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    account_name: "Checking",
    category_name: "Housing",
    has_paid_transaction: false,
    ...overrides,
  };
}

function setup(schedule: ScheduledTransactionWithDetails = makeSchedule()) {
  return renderWithProviders(
    <ScheduleTable
      schedules={[schedule]}
      accounts={[
        { id: "acct-checking", name: "Checking", type: "checking", is_budget_account: true },
      ]}
      categories={[{ id: "cat-housing", name: "Housing", category_group_id: "grp-bills" }]}
      categoryGroups={[{ id: "grp-bills", name: "Bills", is_income: false }]}
    />
  );
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  // The trigger is icon-only and opacity-0 until row hover, but it is in the
  // accessibility tree throughout — hover is presentation, not gating.
  const triggers = screen.getAllByRole("button");
  await user.click(triggers[triggers.length - 1]);
}

async function clickMenuItem(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp
) {
  await openRowMenu(user);
  await user.click(await screen.findByRole("menuitem", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postScheduleTransaction).mockResolvedValue(undefined);
  vi.mocked(skipScheduleDate).mockResolvedValue(undefined);
  vi.mocked(completeSchedule).mockResolvedValue(undefined);
  vi.mocked(restartSchedule).mockResolvedValue(undefined);
});

describe("ScheduleTable row menu", () => {
  it("posts the scheduled occurrence, not today's", async () => {
    const user = userEvent.setup();
    setup();

    await clickMenuItem(user, /^post transaction$/i);

    expect(postScheduleTransaction).toHaveBeenCalledWith(SCHEDULE_ID);
  });

  it("posts today's date when the user picks 'Post transaction today'", async () => {
    const user = userEvent.setup();
    setup();

    await clickMenuItem(user, /post transaction today/i);

    expect(postScheduleTransaction).toHaveBeenCalledWith(SCHEDULE_ID, true);
  });

  // Finding 2. Posting writes a transaction and moves an account balance, both
  // of which live on other pages. The row's status badge flipping to Paid is
  // not an acknowledgement that money moved — CLAUDE.md's decision table names
  // "post a schedule" as a toast case by name.
  describe("acknowledging a successful post", () => {
    it("toasts when a schedule posts, because the transaction is off-screen", async () => {
      const user = userEvent.setup();
      setup();

      await clickMenuItem(user, /^post transaction$/i);

      expect(await screen.findByRole("status")).toHaveTextContent(/rent/i);
    });

    it("does not toast success while the post is still in flight", async () => {
      const user = userEvent.setup();
      const pending = deferred();
      vi.mocked(postScheduleTransaction).mockReturnValue(pending.promise);

      setup();
      await clickMenuItem(user, /^post transaction$/i);

      // A toast here would announce a write that may still reject.
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      await act(async () => {
        pending.resolve();
        await pending.promise;
      });
      expect(await screen.findByRole("status")).toBeInTheDocument();
    });
  });

  // Finding 1. handleAction had a bare await and no catch, so all four of these
  // failed exactly like they succeeded: the row un-dims, the menu closes, and
  // the user believes the bill posted.
  describe("when a row action fails", () => {
    const cases = [
      {
        label: "Post transaction",
        item: /^post transaction$/i,
        action: () => postScheduleTransaction,
        message: /could not post the transaction/i,
      },
      {
        label: "Skip next date",
        item: /skip next date/i,
        action: () => skipScheduleDate,
        message: /could not skip the next date/i,
      },
      {
        label: "Complete",
        item: /^complete$/i,
        action: () => completeSchedule,
        message: /could not complete the schedule/i,
      },
    ];

    for (const c of cases) {
      it(`tells the user when "${c.label}" is rejected by the server`, async () => {
        const user = userEvent.setup();
        vi.mocked(c.action()).mockRejectedValue(new Error("db is gone"));

        setup();
        await clickMenuItem(user, c.item);

        expect(await screen.findByRole("status")).toHaveTextContent(c.message);
      });
    }

    it('tells the user when "Restart" is rejected by the server', async () => {
      const user = userEvent.setup();
      vi.mocked(restartSchedule).mockRejectedValue(new Error("db is gone"));

      // Restart only renders on a completed schedule.
      setup(makeSchedule({ completed: true }));
      await clickMenuItem(user, /^restart$/i);

      expect(await screen.findByRole("status")).toHaveTextContent(
        /could not restart the schedule/i
      );
    });

    it("does not toast success when the post was rejected", async () => {
      const user = userEvent.setup();
      vi.mocked(postScheduleTransaction).mockRejectedValue(new Error("db is gone"));

      setup();
      await clickMenuItem(user, /^post transaction$/i);

      const toast = await screen.findByRole("status");
      expect(toast).not.toHaveTextContent(/^posted/i);
    });
  });
});
