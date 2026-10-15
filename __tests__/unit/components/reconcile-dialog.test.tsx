import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { renderHook, cleanup as cleanupHooks } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import {
  makeAccount,
  makeCategory,
  makeCategoryGroup,
  resetFixtureCounter,
} from "@/__tests__/setup/fixtures";
import { ReconcileDialog } from "@/components/accounts/reconcile-dialog";
import { AccountMenu } from "@/components/accounts/account-menu";
import { useUndoRedo } from "@/lib/use-undo-redo";

// Server actions are mocked: this tier asks "did the dialog/menu call the
// action correctly and acknowledge the result", not "did the database end up
// right" — that's __tests__/unit/actions/.
vi.mock("@/app/(app)/accounts/[id]/actions", () => ({
  closeAccount: vi.fn(),
  deleteAccount: vi.fn(),
  setPrimaryAccount: vi.fn(),
  redoReconciliation: vi.fn(),
  setAccountBudgetStatusWithSnapshot: vi.fn(),
  undoSetAccountBudgetStatus: vi.fn(),
  reconcileAccountWithSnapshot: vi.fn(),
}));
vi.mock("@/app/(app)/transfer-plan/actions", () => ({
  updateAccountBalanceWithSnapshot: vi.fn(),
  undoBalanceAdjustment: vi.fn(() => Promise.resolve()),
}));

import {
  reconcileAccountWithSnapshot,
  redoReconciliation,
} from "@/app/(app)/accounts/[id]/actions";
import { undoBalanceAdjustment } from "@/app/(app)/transfer-plan/actions";

const ACCOUNT_ID = "acct-wallet";
const ACCOUNT_NAME = "Cash Wallet";
const GROUP_ID = "grp-household";
const CATEGORY_ID = "cat-groceries";
const CATEGORY_NAME = "Groceries";

const categoryGroups = [
  makeCategoryGroup({
    id: GROUP_ID,
    name: "Household",
    is_income: false,
    is_system: false,
  }),
];
const categories = [
  makeCategory(GROUP_ID, {
    id: CATEGORY_ID,
    name: CATEGORY_NAME,
    category_group_id: GROUP_ID,
  }),
];

// Stateful on purpose. Base UI marks everything outside an open dialog
// `aria-hidden`/inert, and the toast viewport is a sibling of the portal — so a
// stubbed `onOpenChange` leaves the dialog open and hides the toast from role
// queries. The real parent closes on success, which un-hides it; reproducing
// that here keeps the assertion honest instead of reaching for `{ hidden: true }`.
function setup(props: Partial<Parameters<typeof ReconcileDialog>[0]> = {}) {
  const { onOpenChange, ...rest } = props;
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <ReconcileDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
        accountId={ACCOUNT_ID}
        accountName={ACCOUNT_NAME}
        currentBalance={500}
        categories={categories}
        categoryGroups={categoryGroups}
        {...rest}
      />
    );
  }
  return renderWithProviders(<Harness />);
}

/** Type an amount and pick the one available category, the way a user does. */
async function fillOut(
  user: ReturnType<typeof userEvent.setup>,
  amount: string
) {
  const input = screen.getByLabelText(/actual amount/i);
  await user.clear(input);
  await user.type(input, amount);
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: CATEGORY_NAME }));
}

beforeEach(() => {
  resetFixtureCounter();
  vi.mocked(reconcileAccountWithSnapshot).mockReset();
  vi.mocked(redoReconciliation).mockReset();
  vi.mocked(undoBalanceAdjustment).mockReset().mockResolvedValue(undefined);
});

// The undo/redo stack is a module singleton shared by every consumer, so
// drain it between tests rather than letting one test's entries leak into
// the next (same pattern as __tests__/unit/lib/use-undo-redo.test.ts).
afterEach(async () => {
  const { result } = renderHook(() => useUndoRedo());
  while (result.current.canUndo) {
    await act(async () => result.current.undo());
  }
  cleanupHooks();
});

describe("ReconcileDialog", () => {
  it("submits the typed amount and chosen category, and acknowledges it", async () => {
    const user = userEvent.setup();
    const snapshot = {
      transactionId: "txn-1",
      accountId: ACCOUNT_ID,
      previousBalance: 500,
      actualBalance: 550,
      categoryId: CATEGORY_ID,
    };
    vi.mocked(reconcileAccountWithSnapshot).mockResolvedValue(snapshot);

    setup();
    await fillOut(user, "550");
    await user.click(screen.getByRole("button", { name: /^reconcile$/i }));

    expect(reconcileAccountWithSnapshot).toHaveBeenCalledWith(
      ACCOUNT_ID,
      550,
      CATEGORY_ID
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      new RegExp(`${ACCOUNT_NAME} reconciled`, "i")
    );
  });

  // The server returns null when the actual already matches the tracked
  // balance within a cent — nothing was written, so claiming "reconciled" and
  // offering an Undo would both be lies. The dialog just closes.
  it("stays silent when the server reports there was nothing to reconcile", async () => {
    const user = userEvent.setup();
    vi.mocked(reconcileAccountWithSnapshot).mockResolvedValue(null);
    const onOpenChange = vi.fn();

    setup({ onOpenChange });
    await fillOut(user, "550");
    await user.click(screen.getByRole("button", { name: /^reconcile$/i }));

    expect(reconcileAccountWithSnapshot).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^undo$/i })
    ).not.toBeInTheDocument();
  });

  it("keeps the submit button disabled until a category is chosen", async () => {
    const user = userEvent.setup();
    setup();

    const input = screen.getByLabelText(/actual amount/i);
    await user.clear(input);
    await user.type(input, "550");

    expect(screen.getByRole("button", { name: /^reconcile$/i })).toBeDisabled();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: CATEGORY_NAME }));

    expect(screen.getByRole("button", { name: /^reconcile$/i })).toBeEnabled();
  });

  it("does not acknowledge the write while it is still in flight", async () => {
    const user = userEvent.setup();
    const pending = deferred<{
      transactionId: string;
      accountId: string;
      previousBalance: number;
      actualBalance: number;
      categoryId: string;
    }>();
    vi.mocked(reconcileAccountWithSnapshot).mockReturnValue(pending.promise);

    setup();
    await fillOut(user, "550");
    await user.click(screen.getByRole("button", { name: /^reconcile$/i }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve({
        transactionId: "txn-2",
        accountId: ACCOUNT_ID,
        previousBalance: 500,
        actualBalance: 550,
        categoryId: CATEGORY_ID,
      });
      await pending.promise;
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/reconciled/i);
  });

  it("shows an inline error and no success toast when the server rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(reconcileAccountWithSnapshot).mockRejectedValue(
      new Error("db is gone")
    );

    setup();
    await fillOut(user, "550");
    await user.click(screen.getByRole("button", { name: /^reconcile$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/db is gone/i);
    // A failed write must not leave an undoable entry behind.
    expect(
      screen.queryByRole("button", { name: /^undo$/i })
    ).not.toBeInTheDocument();
  });

  it("locks the amount field and disables submit in privacy mode", () => {
    renderWithProviders(
      <ReconcileDialog
        open
        onOpenChange={() => {}}
        accountId={ACCOUNT_ID}
        accountName={ACCOUNT_NAME}
        currentBalance={500}
        categories={categories}
        categoryGroups={categoryGroups}
      />,
      { amountsHidden: true }
    );

    expect(screen.getByLabelText(/actual amount/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /^reconcile$/i })).toBeDisabled();
    expect(reconcileAccountWithSnapshot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The undo push and toast live in the dialog, co-located with the action call.
// These drive that wiring through AccountMenu — the menu is how a user actually
// reaches the dialog — against the real useUndoRedo singleton rather than a
// mock, so a toast wired to undo() (top-of-stack) or backward() (never arms
// redo) shows up as a real failure below rather than passing by coincidence.
// ---------------------------------------------------------------------------

function cashAccount(overrides: Partial<ReturnType<typeof makeAccount>> = {}) {
  return makeAccount({
    id: ACCOUNT_ID,
    name: ACCOUNT_NAME,
    type: "cash",
    current_balance: 500,
    ...overrides,
  });
}

async function openReconcileDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /options for/i }));
  await user.click(await screen.findByRole("menuitem", { name: /^reconcile$/i }));
}

describe("AccountMenu — Reconcile undo + toast wiring", () => {
  it("fires a toast with an Undo action on a successful reconcile", async () => {
    const user = userEvent.setup();
    const snapshot = {
      transactionId: "txn-3",
      accountId: ACCOUNT_ID,
      previousBalance: 500,
      actualBalance: 550,
      categoryId: CATEGORY_ID,
    };
    vi.mocked(reconcileAccountWithSnapshot).mockResolvedValue(snapshot);

    renderWithProviders(
      <AccountMenu
        account={cashAccount()}
        categories={categories}
        categoryGroups={categoryGroups}
      />
    );
    await openReconcileDialog(user);
    await fillOut(user, "550");
    await user.click(screen.getByRole("button", { name: /^reconcile$/i }));

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(/reconciled/i);
    expect(within(toast).getByRole("button", { name: /^undo$/i })).toBeInTheDocument();
  });

  it("clicking Undo on that toast calls undoBalanceAdjustment exactly once", async () => {
    const user = userEvent.setup();
    const snapshot = {
      transactionId: "txn-4",
      accountId: ACCOUNT_ID,
      previousBalance: 500,
      actualBalance: 550,
      categoryId: CATEGORY_ID,
    };
    vi.mocked(reconcileAccountWithSnapshot).mockResolvedValue(snapshot);

    renderWithProviders(
      <AccountMenu
        account={cashAccount()}
        categories={categories}
        categoryGroups={categoryGroups}
      />
    );
    await openReconcileDialog(user);
    await fillOut(user, "550");
    await user.click(screen.getByRole("button", { name: /^reconcile$/i }));

    const toast = await screen.findByRole("status");
    await user.click(within(toast).getByRole("button", { name: /^undo$/i }));

    expect(undoBalanceAdjustment).toHaveBeenCalledTimes(1);
    expect(undoBalanceAdjustment).toHaveBeenCalledWith(snapshot);
  });

  it("arms redo after Undo — the entry went through undoEntry(), not a bare backward()", async () => {
    const user = userEvent.setup();
    const snapshot = {
      transactionId: "txn-5",
      accountId: ACCOUNT_ID,
      previousBalance: 500,
      actualBalance: 550,
      categoryId: CATEGORY_ID,
    };
    vi.mocked(reconcileAccountWithSnapshot).mockResolvedValue(snapshot);
    vi.mocked(redoReconciliation).mockResolvedValue({
      ...snapshot,
      transactionId: "txn-6",
    });

    renderWithProviders(
      <AccountMenu
        account={cashAccount()}
        categories={categories}
        categoryGroups={categoryGroups}
      />
    );
    await openReconcileDialog(user);
    await fillOut(user, "550");
    await user.click(screen.getByRole("button", { name: /^reconcile$/i }));

    const toast = await screen.findByRole("status");
    await user.click(within(toast).getByRole("button", { name: /^undo$/i }));

    // Calling backward() directly (the bug this replaced) leaves the entry
    // on the undo stack and redo empty forever — canRedo is the observable
    // proof the entry actually moved sides.
    const { result } = renderHook(() => useUndoRedo());
    expect(result.current.canRedo).toBe(true);

    await act(async () => result.current.redo());
    expect(redoReconciliation).toHaveBeenCalledWith(snapshot);
  });
});
