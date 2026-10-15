import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import {
  makeAccount,
  makeCategory,
  makeCategoryGroup,
  resetFixtureCounter,
} from "@/__tests__/setup/fixtures";
import { TransferPlanClient } from "@/components/transfer-plan/transfer-plan-client";
import type {
  BudgetMonth,
  CategoryWithBudget,
  CategoryGroupWithCategories,
} from "@/lib/types";

// Server actions mocked: this tier asks "did the call site call it and
// acknowledge the result", not "did the DB end up right".
vi.mock("@/app/(app)/transfer-plan/actions", () => ({
  saveTransferPlanActual: vi.fn(() => Promise.resolve()),
}));
import { saveTransferPlanActual } from "@/app/(app)/transfer-plan/actions";

// The dialog is stubbed so this file stays about the transfer *plan*. It owns
// its own undo entry and toast now, and imports the actions directly rather
// than handing a snapshot up by prop — so the convention test can see that call
// site, and transfer-dialog.test.tsx is where the acknowledgement is asserted.
vi.mock("@/components/transactions/transfer-dialog", () => ({
  TransferDialog: ({
    open,
    onConfirmed,
  }: {
    open: boolean;
    onConfirmed?: (snapshot: unknown) => void;
  }) =>
    open ? (
      <button onClick={() => onConfirmed?.({ id: "snap-1" })}>
        fake confirm
      </button>
    ) : null,
}));

const MONTH = "2026-05-01";
const PRIMARY = "acct-checking";
const SAVINGS = "savings-1";
const CARD = "card-1";

function budgetCat(
  groupId: string,
  overrides: {
    id: string;
    name: string;
    allocation_account_id?: string | null;
    available?: number;
  }
): CategoryWithBudget {
  const cat = makeCategory(groupId, {
    id: overrides.id,
    name: overrides.name,
    allocation_account_id: overrides.allocation_account_id ?? null,
    is_buffer: false,
  });
  return {
    ...cat,
    assigned: 0,
    activity: 0,
    available: overrides.available ?? 0,
    cumulative_assigned: 0,
    target: null,
    autoAssign: {
      assignedLastMonth: 0,
      spentLastMonth: 0,
      averageAssigned: 0,
      averageSpent: 0,
    },
  };
}

function budgetGroup(
  id: string,
  categories: CategoryWithBudget[]
): CategoryGroupWithCategories {
  return {
    ...makeCategoryGroup({ id }),
    categories,
    groupAssigned: 0,
    groupActivity: 0,
    groupAvailable: categories.reduce((s, c) => s + c.available, 0),
  };
}

function makeBudgetMonth(
  groups: CategoryGroupWithCategories[] = []
): BudgetMonth {
  return {
    month: MONTH,
    readyToAssign: 0,
    groups,
    hiddenCategories: [],
    hiddenGroups: [],
    totalIncome: 0,
    totalAssigned: 0,
    overspentLastMonth: 0,
    currentMonthIncome: 0,
    currentMonthAssigned: 0,
    expectedIncome: null,
    openingCcDebt: 0,
    futureAssigned: 0,
  };
}

/**
 * A plan with one savings transfer owed. $800 allocated to the savings
 * account against a $600 actual balance leaves a $200 transfer, which is what
 * renders the "Record" action.
 */
function setup(savedActuals: Record<string, number> = { [SAVINGS]: 600 }) {
  const accounts = [
    makeAccount({
      id: PRIMARY,
      name: "Everyday Checking",
      type: "checking",
      is_budget_account: true,
      is_primary: true,
      current_balance: 10000,
      sort_order: 0,
    }),
    makeAccount({
      id: SAVINGS,
      name: "Emergency Fund",
      type: "savings",
      is_budget_account: true,
      current_balance: 600,
      sort_order: 1,
    }),
    makeAccount({
      id: CARD,
      name: "Visa Card",
      type: "credit_card",
      is_budget_account: false,
      is_debt: true,
      current_balance: -250,
      sort_order: 2,
    }),
  ];
  const group = budgetGroup("g1", [
    budgetCat("g1", {
      id: "c1",
      name: "Emergency",
      allocation_account_id: SAVINGS,
      available: 800,
    }),
  ]);
  return renderWithProviders(
    <TransferPlanClient
      budgetMonth={makeBudgetMonth([group])}
      accounts={accounts}
      savedActuals={savedActuals}
      month={MONTH}
    />
  );
}

/**
 * The committed (non-editing) balance control is a bare <button> whose only
 * accessible name is the formatted amount, so it can't be queried by label —
 * scope to the account's row and take the last button in it. (The editing
 * <input> does carry an aria-label; only this collapsed state doesn't.)
 */
function balanceField(accountName = "Everyday Checking"): HTMLElement {
  const row = screen.getByText(accountName).closest("li");
  if (!row) throw new Error(`no row for ${accountName}`);
  const buttons = within(row).getAllByRole("button");
  return buttons[buttons.length - 1];
}

/** Commit a new actual balance the way a user does: click, type, Enter. */
async function typeBalance(
  user: ReturnType<typeof userEvent.setup>,
  value: string
) {
  await user.click(balanceField());
  const input = await screen.findByLabelText(
    /actual balance for everyday checking/i
  );
  await user.clear(input);
  await user.type(input, `${value}{Enter}`);
}

beforeEach(() => {
  resetFixtureCounter();
  vi.clearAllMocks();
  vi.mocked(saveTransferPlanActual).mockResolvedValue(undefined);
});

describe("TransferPlanClient — actual balance", () => {
  it("saves a committed balance to the server", async () => {
    const user = userEvent.setup();
    setup();

    await typeBalance(user, "1500");

    expect(saveTransferPlanActual).toHaveBeenCalledWith(MONTH, PRIMARY, 1500);
  });

  // Finding 1. The save was a floating promise — not awaited, no catch, no
  // error surface anywhere in the file.
  it("tells the user when the balance fails to save", async () => {
    const user = userEvent.setup();
    vi.mocked(saveTransferPlanActual).mockRejectedValue(new Error("db is gone"));

    setup();
    await typeBalance(user, "1500");

    expect(await screen.findByRole("status")).toHaveTextContent(
      /could not save the actual balance/i
    );
  });

  // Finding 2. The optimistic map was never rolled back, so the whole plan
  // kept computing from a number the database rejected — which is how a user
  // moves real money against a phantom balance.
  it("reverts the displayed balance when the save fails", async () => {
    const user = userEvent.setup();
    vi.mocked(saveTransferPlanActual).mockRejectedValue(new Error("db is gone"));

    setup({ [SAVINGS]: 600, [PRIMARY]: 1000 });
    await typeBalance(user, "9999");

    await screen.findByRole("status");

    expect(balanceField()).toHaveTextContent(/1,000/);
    expect(balanceField()).not.toHaveTextContent(/9,999/);
  });

  // Two edits to the same account with the first still in flight. The slow
  // first save rejects *after* the second has already succeeded, so rolling
  // back to the value captured in the first call's closure would stomp a
  // number the database has correctly stored, and the whole plan would
  // recompute off it with no server-driven correction coming
  // (saveTransferPlanActual does not revalidate).
  it("does not stomp a newer saved balance when an older save rejects", async () => {
    const user = userEvent.setup();
    const slow = deferred();
    vi.mocked(saveTransferPlanActual).mockReturnValueOnce(slow.promise);

    setup({ [SAVINGS]: 600, [PRIMARY]: 1000 });

    // Edit 1 — starts, stays in flight.
    await typeBalance(user, "1500");
    // Edit 2 — corrects the typo, resolves immediately.
    await typeBalance(user, "1600");

    // Now edit 1 fails, long after edit 2 landed.
    await act(async () => {
      slow.reject(new Error("db was gone"));
      await slow.promise.catch(() => {});
    });

    expect(balanceField()).toHaveTextContent(/1,600/);
    expect(balanceField()).not.toHaveTextContent(/1,000/);
  });

  // Both saves fail. The rollback must land on the last value the server
  // actually confirmed, not on whatever the previous optimistic render showed
  // -- restoring edit 1's unpersisted value would be its own phantom.
  it("rolls back to the last server-confirmed value when every save fails", async () => {
    const user = userEvent.setup();
    vi.mocked(saveTransferPlanActual).mockRejectedValue(new Error("db is gone"));

    setup({ [SAVINGS]: 600, [PRIMARY]: 1000 });

    await typeBalance(user, "1500");
    await screen.findByRole("status");
    await typeBalance(user, "1600");

    expect(balanceField()).toHaveTextContent(/1,000/);
  });

  it("keeps the optimistic value while the save is still in flight", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    vi.mocked(saveTransferPlanActual).mockReturnValue(pending.promise);

    setup({ [SAVINGS]: 600, [PRIMARY]: 1000 });
    await typeBalance(user, "1500");

    expect(balanceField()).toHaveTextContent(/1,500/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });

    expect(balanceField()).toHaveTextContent(/1,500/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
