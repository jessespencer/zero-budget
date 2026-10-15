import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { TransferDialog } from "@/components/transactions/transfer-dialog";
import { __resetUndoRedo } from "@/lib/use-undo-redo";

// Call-site tier — the server actions are mocked. This asks whether recording
// or editing a transfer acknowledges itself and stays undoable. Whether the two
// legs land correctly in the database is transfer-plan-actions.test.ts.
//
// This lives here rather than in each caller's test because the dialog owns the
// toast and the undo entry for all three of its call sites — transactions,
// QuickAdd (which the sidebar renders on every page), and the transfer plan.
vi.mock("@/app/(app)/transfer-plan/actions", () => ({
  createTransferPairWithSnapshot: vi.fn(),
  updateTransferPairWithSnapshot: vi.fn(),
  undoTransferPair: vi.fn(() => Promise.resolve()),
  redoTransferPair: vi.fn(() => Promise.resolve({ id: "snap-redone" })),
  undoTransferPairEdit: vi.fn(() => Promise.resolve()),
  redoTransferPairEdit: vi.fn(() => Promise.resolve()),
}));
import {
  createTransferPairWithSnapshot,
  updateTransferPairWithSnapshot,
  undoTransferPair,
  undoTransferPairEdit,
} from "@/app/(app)/transfer-plan/actions";

const ACCOUNTS = [
  { id: "acct-checking", name: "Checking" },
  { id: "acct-savings", name: "Savings" },
];

const EDIT_TARGET = {
  txnId: "txn-1",
  fromAccountId: "acct-checking",
  toAccountId: "acct-savings",
  amount: 250,
  date: "2026-07-01",
};

/**
 * Open state is real, not a no-op prop. Base UI marks everything outside an
 * open dialog `aria-hidden`/inert, and the Toaster portals to `document.body`
 * — so a dialog that never closes hides its own toast from the accessibility
 * tree and `getByRole("status")` finds nothing. Every real caller closes on
 * success, which is what makes the toast reachable.
 */
function Harness(props: Partial<Parameters<typeof TransferDialog>[0]>) {
  const [open, setOpen] = useState(true);
  return (
    <TransferDialog
      open={open}
      onOpenChange={setOpen}
      accounts={ACCOUNTS}
      defaultFromAccountId="acct-checking"
      defaultToAccountId="acct-savings"
      defaultAmount={250}
      {...props}
    />
  );
}

function setup(props: Partial<Parameters<typeof TransferDialog>[0]> = {}) {
  return renderWithProviders(<Harness {...props} />);
}

async function submit(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  __resetUndoRedo();
  vi.mocked(createTransferPairWithSnapshot).mockReset().mockResolvedValue({
    id: "snap-1",
  } as never);
  vi.mocked(updateTransferPairWithSnapshot).mockReset().mockResolvedValue({
    id: "edit-snap-1",
  } as never);
  vi.mocked(undoTransferPair).mockReset().mockResolvedValue(undefined);
  vi.mocked(undoTransferPairEdit).mockReset().mockResolvedValue(undefined);
});

describe("TransferDialog", () => {
  it("toasts when a transfer is recorded", async () => {
    const user = userEvent.setup();
    setup();

    await submit(user, /record transfer/i);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /transfer recorded/i
    );
  });

  it("names the movement per the `noun` prop, so the plan says Payment", async () => {
    const user = userEvent.setup();
    setup({ noun: "Payment" });

    await submit(user, /record transfer/i);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /payment recorded/i
    );
  });

  it("does not name an amount in the toast, which would leak in privacy mode", async () => {
    const user = userEvent.setup();
    setup();

    await submit(user, /record transfer/i);

    expect((await screen.findByRole("status")).textContent).not.toMatch(/\d/);
  });

  it("offers Undo on that toast and it reverts the transfer", async () => {
    const user = userEvent.setup();
    setup();

    await submit(user, /record transfer/i);
    const toast = await screen.findByRole("status");
    await user.click(within(toast).getByRole("button", { name: /^undo$/i }));

    expect(undoTransferPair).toHaveBeenCalledWith(
      expect.objectContaining({ id: "snap-1" })
    );
  });

  it("toasts and stays undoable when an existing transfer is edited", async () => {
    const user = userEvent.setup();
    setup({ editTarget: EDIT_TARGET });

    await submit(user, /save changes/i);
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(/transfer updated/i);

    await user.click(within(toast).getByRole("button", { name: /^undo$/i }));
    expect(undoTransferPairEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "edit-snap-1" })
    );
  });

  it("sends the typed note with a new transfer", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/^note$/i), "Vacation fund");
    await submit(user, /record transfer/i);

    expect(createTransferPairWithSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ memo: "Vacation fund" })
    );
  });

  it("hides the note field when editing, since an edit leaves the memo alone", () => {
    setup({ editTarget: EDIT_TARGET });

    expect(screen.queryByLabelText(/^note$/i)).not.toBeInTheDocument();
  });

  it("shows the failure inline and registers nothing when the write rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(createTransferPairWithSnapshot).mockRejectedValue(
      new Error("Accounts must be different")
    );
    setup();

    await submit(user, /record transfer/i);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /accounts must be different/i
    );
    // No toast, and nothing to undo — the write never happened.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
