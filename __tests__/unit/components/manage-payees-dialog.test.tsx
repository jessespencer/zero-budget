import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { __resetUndoRedo } from "@/lib/use-undo-redo";
import { ManagePayeesDialog } from "@/components/transactions/manage-payees-dialog";

// Call-site tier: does the payee manager acknowledge merge/delete correctly —
// gate destructive actions behind a ConfirmDialog, push an undoable toast on
// merge, surface (not swallow) a server rejection. Whether the DB ends up
// right is transactions/actions merge/delete coverage, not this file.
//
// The main ManagePayeesDialog never closes itself for any of these flows (no
// onOpenChange(false) call on success), so the toast portal sits behind an
// *open* modal Dialog the entire time. Radix/base-ui mark everything outside
// the topmost modal aria-hidden, which getByRole/findByRole normally respect —
// so toast button queries here pass `hidden: true` to opt back in, per the
// documented gotcha in the assets quality ledger. Toast copy itself is queried
// with getByText/findByText, which isn't filtered by aria-hidden.
vi.mock("@/app/(app)/transactions/actions", () => ({
  updatePayee: vi.fn(),
  deletePayee: vi.fn(),
  deletePayees: vi.fn(),
  mergePayeesWithSnapshot: vi.fn(),
  restoreMergePayeesSnapshot: vi.fn(() => Promise.resolve()),
}));

import {
  deletePayee,
  deletePayees,
  mergePayeesWithSnapshot,
  restoreMergePayeesSnapshot,
  type MergePayeesSnapshot,
} from "@/app/(app)/transactions/actions";

const CATEGORY_GROUPS = [
  { id: "g-1", name: "Everyday", is_income: false, is_system: false },
];
const CATEGORIES = [
  { id: "c-1", name: "Groceries", category_group_id: "g-1" },
  { id: "c-2", name: "Shopping", category_group_id: "g-1" },
];

const PAYEES = [
  { id: "p-costco", name: "Costco", default_category_id: "c-1" },
  { id: "p-costco-w", name: "Costco Wholesale", default_category_id: null },
  { id: "p-amazon", name: "Amazon", default_category_id: null },
  { id: "p-target", name: "Target", default_category_id: "c-2" },
];

const MERGE_SNAPSHOT: MergePayeesSnapshot = {
  loserPayees: [
    { id: "p-costco-w", name: "Costco Wholesale", default_category_id: null },
  ],
  rewrittenTransactions: [{ transactionId: "txn-1", originalPayee: "Costco Wholesale" }],
};

beforeEach(() => {
  __resetUndoRedo();
  vi.mocked(mergePayeesWithSnapshot).mockReset().mockResolvedValue(MERGE_SNAPSHOT);
  vi.mocked(restoreMergePayeesSnapshot).mockReset().mockResolvedValue(undefined);
  vi.mocked(deletePayee).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(deletePayees).mockReset().mockResolvedValue(undefined as never);
});

function setup() {
  const onOpenChange = vi.fn();
  const result = renderWithProviders(
    <ManagePayeesDialog
      payees={PAYEES}
      categories={CATEGORIES}
      categoryGroups={CATEGORY_GROUPS}
      open={true}
      onOpenChange={onOpenChange}
    />
  );
  return { onOpenChange, ...result };
}

// Row text is the payee name verbatim, so an exact getByText match on
// "Costco" doesn't also grab "Costco Wholesale".
async function selectPayee(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByText(name));
}

// Finds the topmost open dialog surface (there can be two nested — the main
// manager and a ConfirmDialog on top of it) by matching its own text content,
// since both share role="dialog" and this one's confirm button can share a
// label with the trigger button that opened it.
function findDialogByContent(pattern: RegExp): HTMLElement {
  const dialogs = screen.getAllByRole("dialog", { hidden: true });
  const match = dialogs.find((d) => pattern.test(d.textContent || ""));
  if (!match) throw new Error(`No dialog matched ${pattern}`);
  return match;
}

describe("ManagePayeesDialog — merge", () => {
  async function runMergeToConfirm(user: ReturnType<typeof userEvent.setup>) {
    await selectPayee(user, "Costco");
    await selectPayee(user, "Costco Wholesale");
    await user.click(screen.getByRole("button", { name: /merge into/i }));

    const combobox = screen.getByRole("combobox");
    await user.click(combobox);
    await user.click(screen.getByRole("option", { name: "Costco" }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(await screen.findByText(/merge payees\?/i)).toBeInTheDocument();
  }

  it("merges through mergePayeesWithSnapshot and toasts an undoable confirmation", async () => {
    const user = userEvent.setup();
    setup();
    await runMergeToConfirm(user);

    await user.click(screen.getByRole("button", { name: /^merge$/i }));

    expect(mergePayeesWithSnapshot).toHaveBeenCalledWith(["p-costco-w"], "p-costco");
    expect(await screen.findByText(/merged 1 payee/i)).toBeInTheDocument();

    const undoButton = await screen.findByRole("button", {
      name: /undo/i,
      hidden: true,
    });
    await user.click(undoButton);
    expect(restoreMergePayeesSnapshot).toHaveBeenCalledWith(MERGE_SNAPSHOT);
  });

  it("shows an inline error and no success toast when the merge rejects", async () => {
    const user = userEvent.setup();
    // Reject with a non-Error so the component's generic fallback copy is what
    // renders — the assertion below is pinned to that exact fallback string.
    vi.mocked(mergePayeesWithSnapshot).mockRejectedValueOnce("boom");
    setup();
    await runMergeToConfirm(user);

    await user.click(screen.getByRole("button", { name: /^merge$/i }));

    expect(await screen.findByText(/couldn't merge/i)).toBeInTheDocument();
    // The confirm panel stays up — Merge is still there for a retry.
    expect(screen.getByRole("button", { name: /^merge$/i })).toBeInTheDocument();
    expect(screen.queryByText(/merged \d+ payee/i)).not.toBeInTheDocument();
  });
});

describe("ManagePayeesDialog — bulk delete", () => {
  it("gates Delete N behind a ConfirmDialog before calling deletePayees", async () => {
    const user = userEvent.setup();
    setup();
    await selectPayee(user, "Costco");
    await selectPayee(user, "Amazon");

    await user.click(screen.getByRole("button", { name: /^delete 2$/i }));
    expect(deletePayees).not.toHaveBeenCalled();

    const confirmDialog = findDialogByContent(/delete 2 payees\?/i);
    await user.click(
      within(confirmDialog).getByRole("button", { name: /^delete 2$/i })
    );

    expect(deletePayees).toHaveBeenCalledWith(
      expect.arrayContaining(["p-costco", "p-amazon"])
    );
    // Plain confirmation toast — no Undo (the delete is irreversible).
    expect(await screen.findByText(/deleted 2 payees/i)).toBeInTheDocument();
  });

  it("calls nothing when the ConfirmDialog is cancelled", async () => {
    const user = userEvent.setup();
    setup();
    await selectPayee(user, "Costco");
    await selectPayee(user, "Amazon");

    await user.click(screen.getByRole("button", { name: /^delete 2$/i }));
    const confirmDialog = findDialogByContent(/delete 2 payees\?/i);
    await user.click(within(confirmDialog).getByRole("button", { name: /^cancel$/i }));

    expect(deletePayees).not.toHaveBeenCalled();
    expect(screen.queryByText(/delete 2 payees\?/i)).not.toBeInTheDocument();
  });

  it("surfaces an inline error and swallows the rejection when the bulk delete throws", async () => {
    const user = userEvent.setup();
    vi.mocked(deletePayees).mockRejectedValueOnce("nope");
    const onUnhandled = vi.fn();
    window.addEventListener("unhandledrejection", onUnhandled);
    setup();
    await selectPayee(user, "Costco");
    await selectPayee(user, "Amazon");

    await user.click(screen.getByRole("button", { name: /^delete 2$/i }));
    const confirmDialog = findDialogByContent(/delete 2 payees\?/i);
    await user.click(
      within(confirmDialog).getByRole("button", { name: /^delete 2$/i })
    );

    expect(await screen.findByText(/couldn't delete/i)).toBeInTheDocument();
    expect(onUnhandled).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", onUnhandled);
  });
});

describe("ManagePayeesDialog — single payee delete", () => {
  it("gates Delete behind a ConfirmDialog before calling deletePayee", async () => {
    const user = userEvent.setup();
    setup();
    await selectPayee(user, "Target");

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(deletePayee).not.toHaveBeenCalled();

    const confirmDialog = findDialogByContent(/delete "target"\?/i);
    await user.click(
      within(confirmDialog).getByRole("button", { name: /^delete payee$/i })
    );

    expect(deletePayee).toHaveBeenCalledWith("p-target");
    // Plain confirmation toast — no Undo (the delete is irreversible).
    expect(await screen.findByText(/payee deleted/i)).toBeInTheDocument();
    // Collapses back to the empty-selection placeholder.
    expect(await screen.findByText(/select a payee to edit/i)).toBeInTheDocument();
  });
});
