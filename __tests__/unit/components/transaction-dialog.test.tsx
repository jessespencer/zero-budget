import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { __resetUndoRedo, useUndoRedo } from "@/lib/use-undo-redo";
import type { TransactionWithDetails } from "@/lib/types";
import type { TransactionSnapshot } from "@/app/(app)/transactions/actions";

// Call-site tier: does the dialog's delete acknowledge itself correctly — push
// a real undo entry, fire a toast, and undo the RIGHT action. The DB round-trip
// is transaction-actions.test.ts's job.
vi.mock("@/app/(app)/transactions/actions", () => ({
  createTransaction: vi.fn(() => Promise.resolve({ id: "new" })),
  updateTransaction: vi.fn(() => Promise.resolve()),
  ensureDefaultAccount: vi.fn(() => Promise.resolve("acct-1")),
  deleteTransactionWithSnapshot: vi.fn(),
  restoreTransactionSnapshots: vi.fn(() => Promise.resolve()),
}));
import {
  deleteTransactionWithSnapshot,
  restoreTransactionSnapshots,
} from "@/app/(app)/transactions/actions";

const SNAPSHOT = [{ id: "txn-1" }] as unknown as TransactionSnapshot[];

const ACCOUNTS = [
  { id: "acct-1", name: "Checking", type: "checking", is_budget_account: true },
];
const CATEGORY_GROUPS = [
  { id: "g-1", name: "Everyday", is_income: false, is_system: false },
];
const CATEGORIES = [{ id: "c-1", name: "Groceries", category_group_id: "g-1" }];

const TXN: TransactionWithDetails = {
  id: "txn-1",
  date: "2026-05-10",
  payee: "Costco",
  memo: null,
  amount: -50,
  account_id: "acct-1",
  category_id: "c-1",
} as TransactionWithDetails;

// Reads the singleton undo/redo state via the same hook the app uses.
let undoState: ReturnType<typeof useUndoRedo>;
function UndoProbe() {
  undoState = useUndoRedo();
  return null;
}

// Controlled open state, like the real callers: handleDelete calls
// onOpenChange(false) on success, which closes the dialog. That matters for the
// assertions — an open shadcn Dialog marks sibling DOM aria-hidden, so the
// toast (a sibling portal) is only reachable by getByRole once the dialog has
// closed, exactly as a user would see it.
function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <UndoProbe />
      <TransactionDialog
        open={open}
        onOpenChange={setOpen}
        accounts={ACCOUNTS}
        categories={CATEGORIES}
        categoryGroups={CATEGORY_GROUPS}
        payees={[]}
        transaction={TXN}
      />
    </>
  );
}

function setup() {
  return renderWithProviders(<Harness />);
}

// Click Delete and let the delete's detached async continuation flush inside
// act(), so the toast + undo push land in the DOM/stack deterministically.
async function deleteAndFlush(user: ReturnType<typeof userEvent.setup>) {
  const pending = deferred<TransactionSnapshot[]>();
  vi.mocked(deleteTransactionWithSnapshot).mockReturnValue(pending.promise);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await act(async () => {
    pending.resolve(SNAPSHOT);
    await pending.promise;
  });
}

beforeEach(() => {
  __resetUndoRedo();
  vi.mocked(deleteTransactionWithSnapshot).mockReset();
  vi.mocked(restoreTransactionSnapshots).mockClear();
  vi.mocked(restoreTransactionSnapshots).mockResolvedValue(undefined as never);
});

describe("TransactionDialog delete", () => {
  it("deletes with a toast Undo action AND pushes one undo entry", async () => {
    const user = userEvent.setup();
    setup();

    await deleteAndFlush(user);

    expect(deleteTransactionWithSnapshot).toHaveBeenCalledWith("txn-1");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/deleted/i);
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
    // A real entry on the undo stack — not just a toast.
    expect(undoState.canUndo).toBe(true);
  });

  // The lazy-fix catcher: a bare undo() would pop whatever is on top. After the
  // user does something else, the toast's Undo must still undo the DELETE, and
  // leave the later entry alone. A undo()-based fix passes the test above and
  // fails this one — that is the whole reason it exists.
  it("undoes the delete specifically, not the top of the stack", async () => {
    const user = userEvent.setup();
    setup();

    await deleteAndFlush(user);
    expect(undoState.canUndo).toBe(true);

    // Simulate a later, unrelated action landing on top of the stack.
    act(() => {
      undoState.push({
        label: "Later action",
        forward: async () => {},
        backward: async () => {},
      });
    });

    await user.click(screen.getByRole("button", { name: /undo/i }));

    // The delete's restore ran...
    await waitFor(() =>
      expect(restoreTransactionSnapshots).toHaveBeenCalledWith(SNAPSHOT)
    );
    // ...and the later action is still on the undo stack.
    expect(undoState.canUndo).toBe(true);
  });

  it("arms redo after the toast Undo (backward went through the stack)", async () => {
    const user = userEvent.setup();
    setup();

    await deleteAndFlush(user);
    await user.click(screen.getByRole("button", { name: /undo/i }));

    await waitFor(() => expect(undoState.canRedo).toBe(true));
  });
});
