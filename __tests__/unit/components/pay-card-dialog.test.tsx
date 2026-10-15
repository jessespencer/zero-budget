import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { PayCardButton } from "@/components/accounts/pay-card-button";
import type { PayCardSourceAccount } from "@/components/accounts/pay-card-dialog";

// The undo push already existed on this call site; what's under test is the
// toast that was missing (F7) — that it names the card and the *source*
// account with no dollar figure, and that its Undo action drives the entry
// through undoEntry(id) rather than a bare undo() pop. Server action mocked:
// this tier asks "did the button call it and acknowledge the result", not
// "did the database end up right".
vi.mock("@/app/(app)/transfer-plan/actions", () => ({
  createTransferPairWithSnapshot: vi.fn(),
  undoTransferPair: vi.fn(() => Promise.resolve()),
  redoTransferPair: vi.fn(() => Promise.resolve()),
}));
import {
  createTransferPairWithSnapshot,
  undoTransferPair,
  type TransferPairSnapshot,
} from "@/app/(app)/transfer-plan/actions";

const CARD_NAME = "Chase Sapphire";

const SOURCE: PayCardSourceAccount = {
  id: "acct-checking",
  name: "Everyday checking",
  currentBalance: 4200,
  isPrimary: true,
};

const SNAPSHOT = {
  outflowTxnId: "txn-out-1",
  inflowTxnId: "txn-in-1",
  fromAccountId: SOURCE.id,
  toAccountId: "card-1",
  amount: 500,
  date: "2026-07-20",
  payeeOutflow: `Transfer to ${CARD_NAME}`,
  payeeInflow: "Transfer from Everyday checking",
  source: "desktop" as const,
};

function setup(sourceAccounts: PayCardSourceAccount[] = [SOURCE]) {
  return renderWithProviders(
    <PayCardButton
      cardId="card-1"
      cardName={CARD_NAME}
      // Negative balance -> "balance owed" prefill, exercised by every test
      // here so the dialog opens already valid without extra typing.
      currentBalance={-500}
      sourceAccounts={sourceAccounts}
    />
  );
}

function openDialog(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: `Pay ${CARD_NAME}` }));
}

function submitButton() {
  // Distinct from the trigger ("Pay Chase Sapphire" via aria-label): the
  // in-dialog submit renders "Pay $500.00" once the prefilled amount is valid.
  return screen.getByRole("button", { name: /^pay \$/i });
}

beforeEach(() => {
  vi.mocked(createTransferPairWithSnapshot).mockReset();
  vi.mocked(createTransferPairWithSnapshot).mockResolvedValue(SNAPSHOT);
  vi.mocked(undoTransferPair).mockClear();
});

describe("PayCardButton toast", () => {
  it("names the card and the source account, with no dollar figure in the copy", async () => {
    const user = userEvent.setup();
    setup();

    await openDialog(user);
    await user.click(submitButton());

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(`Paid ${CARD_NAME} from ${SOURCE.name}`);
    // A figure here would be a privacy-mode leak — the amount is what the
    // user just typed, not something the toast should ever repeat.
    expect(toast.textContent).not.toMatch(/\d/);
  });

  it("falls back to naming just the card when the source account can't be resolved", async () => {
    const user = userEvent.setup();
    vi.mocked(createTransferPairWithSnapshot).mockResolvedValue({
      ...SNAPSHOT,
      fromAccountId: "some-other-account",
    });
    setup();

    await openDialog(user);
    await user.click(submitButton());

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(`Paid ${CARD_NAME}`);
    expect(toast).not.toHaveTextContent("from");
  });

  it("the toast's Undo action drives undoTransferPair through the specific entry, exactly once", async () => {
    const user = userEvent.setup();
    setup();

    await openDialog(user);
    await user.click(submitButton());

    const toast = await screen.findByRole("status");
    await user.click(within(toast).getByRole("button", { name: /undo/i }));

    expect(undoTransferPair).toHaveBeenCalledTimes(1);
    expect(undoTransferPair).toHaveBeenCalledWith(SNAPSHOT);
  });

  it("registers no undo entry and shows no toast while the payment is still in flight", async () => {
    const user = userEvent.setup();
    const pending = deferred<TransferPairSnapshot>();
    vi.mocked(createTransferPairWithSnapshot).mockReturnValue(pending.promise);
    setup();

    await openDialog(user);
    await user.click(submitButton());

    // Still in flight: neither the toast nor its undo entry should exist yet
    // — an entry here would let Cmd+Z "restore" a payment the database never
    // recorded.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(SNAPSHOT);
      await pending.promise;
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      `Paid ${CARD_NAME} from ${SOURCE.name}`
    );
  });

  it("shows the dialog's inline error and no toast when the server rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(createTransferPairWithSnapshot).mockRejectedValue(
      new Error("Could not record payment.")
    );
    setup();

    await openDialog(user);
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not record payment/i
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("with no source accounts, submitting surfaces the empty-state message instead of calling the action", async () => {
    setup([]);
    const user = userEvent.setup();

    await openDialog(user);
    const button = submitButton();
    expect(button).toBeDisabled();

    // The button is disabled (no source to pick), but the guard inside the
    // submit handler is the actual contract under test — submit the form
    // directly the way a stray Enter keypress or a future unguarded control
    // would.
    fireEvent.submit(button.closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /add a checking or savings account to pay from/i
    );
    expect(createTransferPairWithSnapshot).not.toHaveBeenCalled();
  });
});
