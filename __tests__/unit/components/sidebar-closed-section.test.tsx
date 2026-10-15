import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { Sidebar } from "@/components/shared/sidebar";
import type { Account } from "@/lib/types";

// The Closed section is the whole point of the close flow: without it, closing
// is still a one-way door and the confirm copy is still lying. These assert the
// section exists, that it's an archive rather than another account group, and
// that Reopen acknowledges itself.
vi.mock("@/app/(app)/accounts/[id]/actions", () => ({
  reopenAccount: vi.fn(() => Promise.resolve({ ok: true })),
  // AccountMenu renders for every live row and pulls in the rest of these.
  updateAccount: vi.fn(),
  closeAccountWithSnapshot: vi.fn(),
  reopenAccountFromSnapshot: vi.fn(),
  deleteAccount: vi.fn(),
  setPrimaryAccount: vi.fn(),
  redoReconciliation: vi.fn(),
  reconcileAccountWithSnapshot: vi.fn(),
  setAccountBudgetStatusWithSnapshot: vi.fn(),
  undoSetAccountBudgetStatus: vi.fn(),
  createAccount: vi.fn(),
}));
vi.mock("@/app/(app)/transfer-plan/actions", () => ({
  undoBalanceAdjustment: vi.fn(),
  updateAccountBalanceWithSnapshot: vi.fn(),
}));

import { reopenAccount } from "@/app/(app)/accounts/[id]/actions";

vi.mock("next/navigation", () => ({
  usePathname: () => "/budget",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const account = (over: Partial<Account>): Account => ({
  id: "acct-1",
  user_id: "u1",
  name: "Checking",
  type: "checking",
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
  ...over,
});

const LIVE = account({ id: "acct-live", name: "Everyday" });
const CLOSED = account({
  id: "acct-closed",
  name: "Capital One",
  type: "credit_card",
  archived: true,
  current_balance: 0,
});

function setup(closedAccounts: Account[]) {
  return renderWithProviders(
    <Sidebar
      accounts={[LIVE]}
      closedAccounts={closedAccounts}
      uncategorizedByAccount={{}}
      payees={[]}
      categories={[]}
      categoryGroups={[]}
      collapsed={false}
      onToggleCollapse={() => {}}
    />
  );
}

beforeEach(() => {
  vi.mocked(reopenAccount).mockReset().mockResolvedValue({ ok: true });
});

describe("Sidebar — Closed section", () => {
  it("renders no Closed section when nothing is archived", () => {
    setup([]);

    expect(screen.queryByRole("heading", { name: /closed/i })).not.toBeInTheDocument();
  });

  it("starts collapsed, so the archive doesn't crowd the daily view", () => {
    setup([CLOSED]);

    expect(screen.getByRole("heading", { name: /closed/i })).toBeInTheDocument();
    // Header present, row not — the section is shut until asked for.
    expect(screen.queryByText("Capital One")).not.toBeInTheDocument();
  });

  it("shows a count rather than a masked total", async () => {
    const user = userEvent.setup();
    setup([CLOSED, account({ id: "acct-c2", name: "Old savings", archived: true })]);

    // Every closed account is zeroed on the way out, so a "$0.00" total would
    // be noise. The count is the useful figure.
    const header = screen.getByRole("heading", { name: /closed/i }).closest("button");
    expect(header).toHaveTextContent("2");
    expect(header).not.toHaveTextContent("$");

    await user.click(header!);
    expect(await screen.findByText("Capital One")).toBeInTheDocument();
  });

  it("reopens from the row's Reopen button and toasts", async () => {
    const user = userEvent.setup();
    setup([CLOSED]);

    await user.click(screen.getByRole("heading", { name: /closed/i }).closest("button")!);
    await user.click(
      await screen.findByRole("button", { name: /reopen capital one/i })
    );

    expect(reopenAccount).toHaveBeenCalledWith(CLOSED.id);
    // The account reappears in a different section that may be scrolled out of
    // view — without the toast nothing says the click worked.
    expect(await screen.findByRole("status")).toHaveTextContent(
      /capital one reopened/i
    );
  });

  it("surfaces a failed reopen instead of silently doing nothing", async () => {
    const user = userEvent.setup();
    vi.mocked(reopenAccount).mockRejectedValue(new Error("db is gone"));
    setup([CLOSED]);

    await user.click(screen.getByRole("heading", { name: /closed/i }).closest("button")!);
    await user.click(
      await screen.findByRole("button", { name: /reopen capital one/i })
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't reopen capital one/i
    );
  });

  it("offers Reopen and not the account menu on an archived row", async () => {
    const user = userEvent.setup();
    setup([CLOSED]);

    await user.click(screen.getByRole("heading", { name: /closed/i }).closest("button")!);

    // Adjust balance / Reconcile / Set as primary are all meaningless here.
    expect(
      await screen.findByRole("button", { name: /reopen capital one/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /options for capital one/i })
    ).not.toBeInTheDocument();
    // The live row keeps its menu.
    expect(
      screen.getByRole("button", { name: /options for everyday/i })
    ).toBeInTheDocument();
  });
});
