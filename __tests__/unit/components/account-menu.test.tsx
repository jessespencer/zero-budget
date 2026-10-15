import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { AccountMenu } from "@/components/accounts/account-menu";
import type { Account } from "@/lib/types";

// Call-site tier: this asks "did the menu call the right action, in the right
// order, and acknowledge the result" — not "did the database end up right".
// Every export the component tree touches has to be mocked, including the
// ones only reached by the dialogs AccountMenu always mounts (EditAccountDialog,
// AdjustBalanceDialog, ReconcileDialog) even when closed.
vi.mock("@/app/(app)/accounts/[id]/actions", () => ({
  updateAccount: vi.fn(() => Promise.resolve()),
  closeAccountWithSnapshot: vi.fn(),
  reopenAccountFromSnapshot: vi.fn(() => Promise.resolve()),
  reopenAccount: vi.fn(() => Promise.resolve({ ok: true })),
  deleteAccount: vi.fn(() => Promise.resolve()),
  setPrimaryAccount: vi.fn(() => Promise.resolve({ ok: true })),
  redoReconciliation: vi.fn(),
  reconcileAccountWithSnapshot: vi.fn(),
  setAccountBudgetStatusWithSnapshot: vi.fn(),
  undoSetAccountBudgetStatus: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/app/(app)/transfer-plan/actions", () => ({
  undoBalanceAdjustment: vi.fn(() => Promise.resolve()),
  updateAccountBalanceWithSnapshot: vi.fn(),
}));

import {
  closeAccountWithSnapshot,
  reopenAccount,
  reopenAccountFromSnapshot,
  deleteAccount,
  setPrimaryAccount,
  setAccountBudgetStatusWithSnapshot,
  undoSetAccountBudgetStatus,
  type AccountCloseSnapshot,
  type BudgetStatusSnapshot,
} from "@/app/(app)/accounts/[id]/actions";

const ACCOUNT: Account = {
  id: "acct-checking",
  user_id: "u1",
  name: "Checking",
  type: "cash",
  institution: null,
  current_balance: 1200,
  is_budget_account: true,
  is_debt: false,
  sort_order: 0,
  archived: false,
  plaid_item_id: null,
  is_primary: false,
  created_at: "",
  updated_at: "",
};

const SNAPSHOT: BudgetStatusSnapshot = {
  accountId: ACCOUNT.id,
  previous_on_budget: true,
  txn_category_changes: [],
};

const CLOSE_SNAPSHOT: AccountCloseSnapshot = {
  accountId: ACCOUNT.id,
  previousUpdatedAt: "2026-07-01T00:00:00.000Z",
  balanceAdjustment: {
    transactionId: "txn-adjust",
    accountId: ACCOUNT.id,
    previousBalance: 1200,
  },
};

function setup(props: Partial<Parameters<typeof AccountMenu>[0]> = {}) {
  return renderWithProviders(
    <AccountMenu account={ACCOUNT} triggerVariant="kebab" {...props} />
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /options for checking/i }));
}

beforeEach(() => {
  vi.mocked(closeAccountWithSnapshot).mockReset().mockResolvedValue(CLOSE_SNAPSHOT);
  vi.mocked(reopenAccountFromSnapshot).mockReset().mockResolvedValue(undefined);
  vi.mocked(reopenAccount).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(deleteAccount).mockReset().mockResolvedValue(undefined);
  vi.mocked(setPrimaryAccount).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(setAccountBudgetStatusWithSnapshot).mockReset().mockResolvedValue(SNAPSHOT);
  vi.mocked(undoSetAccountBudgetStatus).mockReset().mockResolvedValue(undefined);
});

describe("AccountMenu", () => {
  describe("Convert (include/exclude starting balance)", () => {
    it("only renders for the kebab trigger on a non-credit-card account", async () => {
      const user = userEvent.setup();
      setup();
      await openMenu(user);

      expect(
        await screen.findByRole("menuitem", { name: /exclude starting balance/i })
      ).toBeInTheDocument();
    });

    it("does not render on the sidebar pencil trigger", async () => {
      const user = userEvent.setup();
      setup({ triggerVariant: "pencil", showReconcile: false });
      await user.click(screen.getByRole("button", { name: /options for checking/i }));

      expect(
        screen.queryByRole("menuitem", { name: /starting balance/i })
      ).not.toBeInTheDocument();
    });

    it("does not render for credit card accounts even in the kebab menu", async () => {
      const user = userEvent.setup();
      setup({ account: { ...ACCOUNT, type: "credit_card" } });
      await openMenu(user);

      expect(
        screen.queryByRole("menuitem", { name: /starting balance/i })
      ).not.toBeInTheDocument();
    });

    it("converts the account and toasts an undoable confirmation", async () => {
      const user = userEvent.setup();
      setup();
      await openMenu(user);
      await user.click(
        await screen.findByRole("menuitem", { name: /exclude starting balance/i })
      );
      await user.click(
        await screen.findByRole("button", { name: /exclude starting balance/i })
      );

      expect(setAccountBudgetStatusWithSnapshot).toHaveBeenCalledWith(
        ACCOUNT.id,
        false
      );
      expect(await screen.findByRole("status")).toHaveTextContent(
        /checking.*starting balance removed from ready to assign/i
      );
      expect(await screen.findByRole("button", { name: /undo/i })).toBeInTheDocument();
    });

    it("routes the toast's Undo button through undoSetAccountBudgetStatus, not a bare stack pop", async () => {
      const user = userEvent.setup();
      setup();
      await openMenu(user);
      await user.click(
        await screen.findByRole("menuitem", { name: /exclude starting balance/i })
      );
      await user.click(
        await screen.findByRole("button", { name: /exclude starting balance/i })
      );

      const undoButton = await screen.findByRole("button", { name: /undo/i });
      await user.click(undoButton);

      expect(undoSetAccountBudgetStatus).toHaveBeenCalledWith(SNAPSHOT);
    });

    it("does not register the undo entry until the write resolves", async () => {
      const user = userEvent.setup();
      const pending = deferred<BudgetStatusSnapshot | null>();
      vi.mocked(setAccountBudgetStatusWithSnapshot).mockReturnValue(pending.promise);

      setup();
      await openMenu(user);
      await user.click(
        await screen.findByRole("menuitem", { name: /exclude starting balance/i })
      );
      await user.click(
        await screen.findByRole("button", { name: /exclude starting balance/i })
      );

      // Still in flight: a toast (and its undo entry) here would let Cmd+Z
      // "restore" a state the write never actually reached.
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      await act(async () => {
        pending.resolve(SNAPSHOT);
        await pending.promise;
      });
      expect(await screen.findByRole("status")).toBeInTheDocument();
    });

    it("renders an error and no toast when the write rejects", async () => {
      const user = userEvent.setup();
      vi.mocked(setAccountBudgetStatusWithSnapshot).mockRejectedValue(
        new Error("db is gone")
      );

      setup();
      await openMenu(user);
      await user.click(
        await screen.findByRole("menuitem", { name: /exclude starting balance/i })
      );
      await user.click(
        await screen.findByRole("button", { name: /exclude starting balance/i })
      );

      expect(await screen.findByRole("status")).toHaveTextContent(
        /could not change this account's budget status/i
      );
    });
  });

  describe("Set as primary", () => {
    it("renders an error when the write throws", async () => {
      const user = userEvent.setup();
      vi.mocked(setPrimaryAccount).mockRejectedValue(new Error("db is gone"));

      setup();
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: /set as primary/i }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /could not set this account as primary/i
      );
    });

    it("still renders the reason copy when the action returns ok:false", async () => {
      const user = userEvent.setup();
      vi.mocked(setPrimaryAccount).mockResolvedValue({
        ok: false,
        reason: "archived",
      });

      setup();
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: /set as primary/i }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /reopen this account before setting it as primary/i
      );
    });
  });

  describe("Close account", () => {
    // ACCOUNT carries a $1,200 balance, so the confirm is the zeroing variant
    // and its button reads "Adjust balance & close".
    async function openCloseConfirm(user: ReturnType<typeof userEvent.setup>) {
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: /close account/i }));
      await user.click(
        await screen.findByRole("button", { name: /adjust balance & close/i })
      );
    }

    it("names the adjustment amount in the confirm when the balance is not zero", async () => {
      const user = userEvent.setup();
      setup();
      await openMenu(user);
      await user.click(
        await screen.findByRole("menuitem", { name: /close account/i })
      );

      expect(
        await screen.findByText(/an adjustment transaction will be created for \$1,200\.00/i)
      ).toBeInTheDocument();
    });

    it("promises no adjustment and offers the Closed section when the balance is zero", async () => {
      const user = userEvent.setup();
      setup({ account: { ...ACCOUNT, current_balance: 0 } });
      await openMenu(user);
      await user.click(
        await screen.findByRole("menuitem", { name: /close account/i })
      );

      expect(
        await screen.findByText(/you can reopen it from the closed section/i)
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/adjustment transaction will be created/i)
      ).not.toBeInTheDocument();
      // The button label follows the copy — no money moves, so don't say it does.
      expect(
        screen.getByRole("button", { name: /^close account$/i })
      ).toBeInTheDocument();
    });

    it("closes the account and toasts an undoable confirmation", async () => {
      const user = userEvent.setup();
      setup();
      await openCloseConfirm(user);

      expect(closeAccountWithSnapshot).toHaveBeenCalledWith(ACCOUNT.id);
      expect(await screen.findByRole("status")).toHaveTextContent(/checking closed/i);
      expect(
        await screen.findByRole("button", { name: /undo/i })
      ).toBeInTheDocument();
    });

    it("routes the toast's Undo through reopenAccountFromSnapshot with the returned snapshot", async () => {
      const user = userEvent.setup();
      setup();
      await openCloseConfirm(user);

      await user.click(await screen.findByRole("button", { name: /undo/i }));

      expect(reopenAccountFromSnapshot).toHaveBeenCalledWith(CLOSE_SNAPSHOT);
      expect(reopenAccountFromSnapshot).toHaveBeenCalledTimes(1);
    });

    it("does not register the undo entry until the write resolves", async () => {
      const user = userEvent.setup();
      const pending = deferred<AccountCloseSnapshot>();
      vi.mocked(closeAccountWithSnapshot).mockReturnValue(pending.promise);

      setup();
      await openCloseConfirm(user);

      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      await act(async () => {
        pending.resolve(CLOSE_SNAPSHOT);
        await pending.promise;
      });
      expect(await screen.findByRole("status")).toBeInTheDocument();
    });

    it("renders an error and an error toast when the write throws", async () => {
      const user = userEvent.setup();
      vi.mocked(closeAccountWithSnapshot).mockRejectedValue(new Error("db is gone"));

      setup();
      await openCloseConfirm(user);

      // The confirm dismisses synchronously, so the inline span alone can be
      // off-screen by the time it renders — both affordances are required.
      const statuses = await screen.findAllByRole("status");
      const text = statuses.map((n) => n.textContent).join(" ");
      expect(text).toMatch(/could not close this account/i);
      expect(text).toMatch(/couldn't close checking/i);
      expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
    });

    it("still renders the reason copy when the action returns ok:false", async () => {
      const user = userEvent.setup();
      vi.mocked(closeAccountWithSnapshot).mockResolvedValue({
        ok: false,
        reason: "not_found",
      });

      setup();
      await openCloseConfirm(user);

      // Both affordances, same reasoning as the throw path above: the sidebar
      // variant mounts this component inside a 16x16 absolutely-positioned box,
      // so the inline span alone lands on top of the account name.
      const statuses = await screen.findAllByRole("status");
      const text = statuses.map((n) => n.textContent).join(" ");
      expect(text).toMatch(/account not found/i);
      expect(statuses.length).toBeGreaterThan(1);
      expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
    });
  });

  describe("Reopen account", () => {
    const CLOSED: Account = { ...ACCOUNT, archived: true, current_balance: 0 };

    it("offers Reopen instead of Close once the account is archived", async () => {
      const user = userEvent.setup();
      setup({ account: CLOSED });
      await openMenu(user);

      expect(
        await screen.findByRole("menuitem", { name: /reopen account/i })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("menuitem", { name: /close account/i })
      ).not.toBeInTheDocument();
    });

    it("reopens without a confirm and toasts", async () => {
      const user = userEvent.setup();
      setup({ account: CLOSED });
      await openMenu(user);
      await user.click(
        await screen.findByRole("menuitem", { name: /reopen account/i })
      );

      expect(reopenAccount).toHaveBeenCalledWith(ACCOUNT.id);
      expect(await screen.findByRole("status")).toHaveTextContent(
        /checking reopened/i
      );
    });

    it("surfaces a failure rather than leaving the account looking reopened", async () => {
      const user = userEvent.setup();
      vi.mocked(reopenAccount).mockRejectedValue(new Error("db is gone"));

      setup({ account: CLOSED });
      await openMenu(user);
      await user.click(
        await screen.findByRole("menuitem", { name: /reopen account/i })
      );

      const statuses = await screen.findAllByRole("status");
      const text = statuses.map((n) => n.textContent).join(" ");
      expect(text).toMatch(/could not reopen this account/i);
    });
  });

  describe("Delete account", () => {
    async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>) {
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: /delete account/i }));
      await user.click(await screen.findByRole("button", { name: /^delete account$/i }));
    }

    it("renders an error when the write throws", async () => {
      const user = userEvent.setup();
      vi.mocked(deleteAccount).mockRejectedValue(new Error("db is gone"));

      setup();
      await openDeleteConfirm(user);

      expect(await screen.findByRole("status")).toHaveTextContent(
        /could not delete this account/i
      );
    });

    it("still renders the reason copy when the action returns ok:false", async () => {
      const user = userEvent.setup();
      vi.mocked(deleteAccount).mockResolvedValue({ ok: false, reason: "is_primary" });

      setup();
      await openDeleteConfirm(user);

      expect(await screen.findByRole("status")).toHaveTextContent(
        /pick a different account as primary first/i
      );
    });
  });
});
