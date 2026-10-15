import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { renderHook, cleanup as cleanupHooks } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { makeAccount, resetFixtureCounter } from "@/__tests__/setup/fixtures";
import { AdjustBalanceDialog } from "@/components/accounts/adjust-balance-dialog";
import { AccountMenu } from "@/components/accounts/account-menu";
import { useUndoRedo } from "@/lib/use-undo-redo";

// Server actions are mocked: this tier asks "did the dialog/menu call the
// action correctly and acknowledge the result", not "did the database end up
// right" — that's __tests__/unit/actions/.
vi.mock("@/app/(app)/transfer-plan/actions", () => ({
  updateAccountBalanceWithSnapshot: vi.fn(),
  undoBalanceAdjustment: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/app/(app)/accounts/[id]/actions", () => ({
  closeAccount: vi.fn(),
  deleteAccount: vi.fn(),
  setPrimaryAccount: vi.fn(),
  redoReconciliation: vi.fn(),
  setAccountBudgetStatusWithSnapshot: vi.fn(),
  undoSetAccountBudgetStatus: vi.fn(),
  reconcileAccountWithSnapshot: vi.fn(),
}));

import {
  updateAccountBalanceWithSnapshot,
  undoBalanceAdjustment,
} from "@/app/(app)/transfer-plan/actions";

const ACCOUNT_ID = "acct-checking";
const ACCOUNT_NAME = "Everyday Checking";

// Stateful on purpose. Base UI marks everything outside an open dialog
// `aria-hidden`/inert, and the toast viewport is a sibling of the portal — so a
// stubbed `onOpenChange` leaves the dialog open and hides the toast from role
// queries. The real parent closes on success, which un-hides it; reproducing
// that here keeps the assertion honest instead of reaching for `{ hidden: true }`.
function setup(props: Partial<Parameters<typeof AdjustBalanceDialog>[0]> = {}) {
  const { onOpenChange, ...rest } = props;
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <AdjustBalanceDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
        accountId={ACCOUNT_ID}
        accountName={ACCOUNT_NAME}
        currentBalance={1000}
        isDebt={false}
        {...rest}
      />
    );
  }
  return renderWithProviders(<Harness />);
}

beforeEach(() => {
  vi.mocked(updateAccountBalanceWithSnapshot).mockReset();
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

describe("AdjustBalanceDialog", () => {
  it("writes the balance the user typed and acknowledges it with a toast", async () => {
    const user = userEvent.setup();
    const snapshot = {
      transactionId: "txn-1",
      accountId: ACCOUNT_ID,
      previousBalance: 1000,
    };
    vi.mocked(updateAccountBalanceWithSnapshot).mockResolvedValue(snapshot);

    setup({ currentBalance: 1000, isDebt: false });

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "1234.56");
    await user.click(screen.getByRole("button", { name: /^adjust balance$/i }));

    expect(updateAccountBalanceWithSnapshot).toHaveBeenCalledWith(
      ACCOUNT_ID,
      1234.56
    );
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(/balance adjusted for/i);
  });

  // The dialog used to negate (or otherwise transform) the debt figure before
  // handing it on — the server owns the sign rule, the call site must pass
  // exactly what the user typed.
  it("passes the positive as-typed amount for a credit card, not a negated one", async () => {
    const user = userEvent.setup();
    const snapshot = {
      transactionId: "txn-2",
      accountId: ACCOUNT_ID,
      previousBalance: -500,
    };
    vi.mocked(updateAccountBalanceWithSnapshot).mockResolvedValue(snapshot);

    setup({ currentBalance: -500, isDebt: true });

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "600");
    await user.click(screen.getByRole("button", { name: /^adjust balance$/i }));

    expect(updateAccountBalanceWithSnapshot).toHaveBeenCalledWith(
      ACCOUNT_ID,
      600
    );
  });

  it("does not acknowledge the write while it is still in flight", async () => {
    const user = userEvent.setup();
    const pending = deferred<{
      transactionId: string;
      accountId: string;
      previousBalance: number;
    }>();
    vi.mocked(updateAccountBalanceWithSnapshot).mockReturnValue(pending.promise);

    setup({ currentBalance: 1000, isDebt: false });

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "1500");
    await user.click(screen.getByRole("button", { name: /^adjust balance$/i }));

    // Nothing on screen claims success yet — the toast is the only status
    // node the dialog renders on the happy path.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve({
        transactionId: "txn-3",
        accountId: ACCOUNT_ID,
        previousBalance: 1000,
      });
      await pending.promise;
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /balance adjusted for/i
    );
  });

  it("shows an inline error and no success toast when the server rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(updateAccountBalanceWithSnapshot).mockRejectedValue(
      new Error("db is gone")
    );

    setup({ currentBalance: 1000, isDebt: false });

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "1500");
    await user.click(screen.getByRole("button", { name: /^adjust balance$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/db is gone/i);
    // A failed write must not leave an undoable entry behind.
    expect(screen.queryByRole("button", { name: /^undo$/i })).not.toBeInTheDocument();
  });

  it("writes nothing when amounts are hidden, even if confirm is triggered", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AdjustBalanceDialog
        open
        onOpenChange={() => {}}
        accountId={ACCOUNT_ID}
        accountName={ACCOUNT_NAME}
        currentBalance={1000}
        isDebt={false}
      />,
      { amountsHidden: true }
    );

    // The input is disabled and masked in privacy mode.
    const input = screen.getByPlaceholderText("$••••••");
    expect(input).toBeDisabled();

    // The confirm button is disabled by the same `hidden` flag the
    // `if (hidden) return` guard checks, so a real click can't reach the
    // handler at all — the disabled attribute and the guard are two
    // independent layers, and this proves the outer one holds.
    const confirmButton = screen.getByRole("button", { name: /done|adjust balance/i });
    expect(confirmButton).toBeDisabled();
    await user.click(confirmButton);

    expect(updateAccountBalanceWithSnapshot).not.toHaveBeenCalled();
  });

  it("closes without touching the server when the typed balance matches the current one", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    setup({ currentBalance: 1000, isDebt: false, onOpenChange });

    // Field is prefilled with "1000.00" — click Done without changing it.
    await user.click(screen.getByRole("button", { name: /^done$/i }));

    expect(updateAccountBalanceWithSnapshot).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// The undo + toast wiring lives in the dialog, co-located with the action call
// (the shape transaction-dialog.tsx uses). These drive it through AccountMenu
// anyway — the menu is how a user actually reaches the dialog, so this proves
// the whole chain, not just the leaf. Mocked server actions only.
// ---------------------------------------------------------------------------

function checkingAccount(overrides: Partial<ReturnType<typeof makeAccount>> = {}) {
  return makeAccount({
    id: ACCOUNT_ID,
    name: ACCOUNT_NAME,
    type: "checking",
    current_balance: 1000,
    is_debt: false,
    ...overrides,
  });
}

async function openAdjustDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /options for/i }));
  await user.click(await screen.findByRole("menuitem", { name: /adjust balance/i }));
}

describe("AccountMenu — Adjust balance undo + toast wiring", () => {
  beforeEach(() => {
    resetFixtureCounter();
  });

  it("pushes an undo entry and toasts with an Undo action on save", async () => {
    const user = userEvent.setup();
    const snapshot = {
      transactionId: "txn-4",
      accountId: ACCOUNT_ID,
      previousBalance: 1000,
    };
    vi.mocked(updateAccountBalanceWithSnapshot).mockResolvedValue(snapshot);

    renderWithProviders(<AccountMenu account={checkingAccount()} />);
    await openAdjustDialog(user);

    const input = await screen.findByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "1200");
    await user.click(screen.getByRole("button", { name: /^adjust balance$/i }));

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(/balance adjusted/i);
    expect(within(toast).getByRole("button", { name: /^undo$/i })).toBeInTheDocument();
  });

  it("running Undo on that toast calls undoBalanceAdjustment with the snapshot", async () => {
    const user = userEvent.setup();
    const snapshot = {
      transactionId: "txn-5",
      accountId: ACCOUNT_ID,
      previousBalance: 1000,
    };
    vi.mocked(updateAccountBalanceWithSnapshot).mockResolvedValue(snapshot);

    renderWithProviders(<AccountMenu account={checkingAccount()} />);
    await openAdjustDialog(user);

    const input = await screen.findByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "1200");
    await user.click(screen.getByRole("button", { name: /^adjust balance$/i }));

    const toast = await screen.findByRole("status");
    await user.click(within(toast).getByRole("button", { name: /^undo$/i }));

    expect(undoBalanceAdjustment).toHaveBeenCalledWith(snapshot);
  });
});
