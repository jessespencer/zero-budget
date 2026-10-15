import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { ScheduleDialog } from "@/components/schedules/schedule-dialog";

vi.mock("@/app/(app)/schedules/actions", () => ({
  createSchedule: vi.fn(() => Promise.resolve()),
  updateSchedule: vi.fn(() => Promise.resolve()),
}));
import { createSchedule } from "@/app/(app)/schedules/actions";

function setup(
  accounts: { id: string; name: string; type: string; is_budget_account: boolean }[] = [
    { id: "acct-checking", name: "Checking", type: "checking", is_budget_account: true },
  ]
) {
  return renderWithProviders(
    <ScheduleDialog
      open
      onOpenChange={() => {}}
      accounts={accounts}
      categories={[{ id: "cat-housing", name: "Housing", category_group_id: "grp-bills" }]}
      categoryGroups={[{ id: "grp-bills", name: "Bills", is_income: false }]}
    />
  );
}

const submit = () => screen.getByRole("button", { name: /^add schedule$/i });

beforeEach(() => {
  vi.clearAllMocks();
});

// The amount field guards two different empties. `parseMoneyInput` returns 0
// for "0" and null for ".", and `!numAmount` catches both — so the guard is
// reachable and load-bearing. What it did *not* cover was a genuinely empty
// field, because `required` let the browser block submission first, and the
// user got a native bubble instead of the error every other field renders.
describe("ScheduleDialog amount validation", () => {
  it("rejects an empty amount with the app's own error, not a native bubble", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(/enter a valid amount/i);
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("rejects a zero amount the same way", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/amount/i), "0");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(/enter a valid amount/i);
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("rejects an unparseable amount the same way", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/amount/i), ".");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(/enter a valid amount/i);
    expect(createSchedule).not.toHaveBeenCalled();
  });

  // Proves the amount guard runs before the account guard, so removing
  // `required` didn't just swap one silent failure for another. Rendered with
  // no accounts on purpose: the combobox auto-selects when exactly one exists,
  // so a single-account fixture would sail straight past this guard — which is
  // also why the empty database is where it showed up.
  it("asks for an account once the amount is valid", async () => {
    const user = userEvent.setup();
    setup([]);

    await user.type(screen.getByLabelText(/amount/i), "50");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(/select an account/i);
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("saves once the amount and account are both valid", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/amount/i), "50");
    await user.click(submit());

    expect(createSchedule).toHaveBeenCalledTimes(1);
  });
});
