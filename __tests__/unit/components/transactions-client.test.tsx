import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { __resetUndoRedo } from "@/lib/use-undo-redo";
import { TransactionsClient } from "@/components/transactions/transactions-client";
import type { TransactionWithDetails } from "@/lib/types";

// Call-site tier: does the selection toolbar's Approve / Move to account /
// Rename payee actions acknowledge themselves correctly — a toast on success
// with an Undo bound to the RIGHT entry, a rejection surfaced (not swallowed
// silently), and no phantom undo entry left behind on failure. Whether the DB
// ends up right is transaction-actions.test.ts's job.
//
// TransactionsClient's tree statically imports every action module reached
// by its always-mounted children (ScheduleDialog, TransferDialog, QuickAdd,
// CSVImportWrapper, ExportCsvDialog) even though renderHeader defaults to
// false and most of those never render here — the imports still execute at
// module load, so every "use server" module on that path needs a mock or
// jsdom tries to run real db code.
vi.mock("@/app/(app)/transactions/actions", () => ({
  updateTransaction: vi.fn(() => Promise.resolve()),
  bulkUpdateTransactions: vi.fn(() => Promise.resolve()),
  bulkDeleteTransactionsWithSnapshot: vi.fn(() => Promise.resolve([])),
  restoreTransactionSnapshots: vi.fn(() => Promise.resolve()),
  deleteTransactionWithSnapshot: vi.fn(() => Promise.resolve([])),
  duplicateTransactions: vi.fn(() => Promise.resolve([])),
  getSplitsForTransaction: vi.fn(() => Promise.resolve([])),
  saveSplitsWithSnapshot: vi.fn(() => Promise.resolve([])),
  removeSplitsWithSnapshot: vi.fn(() => Promise.resolve([])),
  restoreSplitSnapshot: vi.fn(() => Promise.resolve()),
  bulkMoveTransactionsToAccountWithSnapshot: vi.fn(),
  restoreAccountMoveSnapshot: vi.fn(() => Promise.resolve()),
  bulkRenamePayeeWithSnapshot: vi.fn(),
  restorePayeeSnapshots: vi.fn(() => Promise.resolve()),
  postPendingTransactionsWithSnapshot: vi.fn(),
  unpostPendingTransactions: vi.fn(() => Promise.resolve()),
  createTransaction: vi.fn(() => Promise.resolve({ id: "new" })),
  ensureDefaultAccount: vi.fn(() => Promise.resolve("acct-checking")),
  exportAllTransactionsCsv: vi.fn(() => Promise.resolve("")),
  findDuplicates: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/app/(app)/transfer-plan/actions", () => ({
  undoTransferPair: vi.fn(() => Promise.resolve()),
  redoTransferPair: vi.fn(() => Promise.resolve({})),
  undoTransferPairEdit: vi.fn(() => Promise.resolve()),
  redoTransferPairEdit: vi.fn(() => Promise.resolve()),
  createTransferPairWithSnapshot: vi.fn(),
  updateTransferPairWithSnapshot: vi.fn(),
}));
vi.mock("@/app/(app)/schedules/actions", () => ({
  createSchedule: vi.fn(() => Promise.resolve()),
  updateSchedule: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/app/(app)/assets/actions", () => ({
  createTrackedAsset: vi.fn(() => Promise.resolve({ id: "asset-1" })),
}));
// CSVImportWrapper lives under the `(app)` route-group directory; Vitest's
// SSR transform can't resolve that path's real .tsx module (a Rolldown parse
// error, unrelated to this test — renderHeader defaults to false so it never
// renders here anyway). Stub it out, same as transfer-plan-client.test.tsx
// stubs TransferDialog for a callback it can't otherwise reach.
vi.mock("@/app/(app)/transactions/csv-import-wrapper", () => ({
  CSVImportWrapper: () => null,
}));

import {
  postPendingTransactionsWithSnapshot,
  unpostPendingTransactions,
  bulkMoveTransactionsToAccountWithSnapshot,
  restoreAccountMoveSnapshot,
  bulkRenamePayeeWithSnapshot,
  restorePayeeSnapshots,
  type PendingPostSnapshotRow,
  type AccountMoveSnapshot,
  type PayeeSnapshotRow,
} from "@/app/(app)/transactions/actions";

const ACCOUNTS = [
  { id: "acct-checking", name: "Checking", type: "checking", is_budget_account: true },
  { id: "acct-savings", name: "Savings", type: "savings", is_budget_account: true },
];
const CATEGORY_GROUPS = [
  { id: "g-1", name: "Everyday", is_income: false, is_system: false },
];
const CATEGORIES = [{ id: "c-1", name: "Groceries", category_group_id: "g-1" }];

function makeTxn(overrides: Partial<TransactionWithDetails>): TransactionWithDetails {
  return {
    id: "txn",
    user_id: "user-1",
    account_id: "acct-checking",
    date: "2026-07-01",
    payee: "Payee",
    memo: null,
    amount: -20,
    category_id: "c-1",
    transfer_account_id: null,
    cleared: false,
    approved: true,
    is_split_parent: false,
    is_envelope_movement: false,
    source: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    account_name: "Checking",
    category_name: "Groceries",
    category_group_name: "Everyday",
    ...overrides,
  };
}

// Two pending (unapproved) rows, rendered in their own "Pending transactions"
// section ahead of the approved rows below — see transaction-table.tsx.
const PENDING_1 = makeTxn({ id: "p1", payee: "Amazon", amount: -15, approved: false });
const PENDING_2 = makeTxn({ id: "p2", payee: "Target", amount: -25, approved: false });
// Two ordinary approved, non-transfer rows with DIFFERENT payees, so the
// rename dialog's shared-payee seed is empty and typing a new name enables
// the Rename button (it's disabled when unchanged from the shared value).
const APPROVED_1 = makeTxn({ id: "a1", payee: "Kroger", amount: -40, approved: true });
const APPROVED_2 = makeTxn({ id: "a2", payee: "Costco", amount: -60, approved: true });

const TRANSACTIONS = [PENDING_1, PENDING_2, APPROVED_1, APPROVED_2];

function setup(transactions: TransactionWithDetails[] = TRANSACTIONS) {
  return renderWithProviders(
    <TransactionsClient
      transactions={transactions}
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      categoryGroups={CATEGORY_GROUPS}
      payees={[]}
      earliestTransactionYear={2024}
      hiddenCount={0}
    />
  );
}

// Row-select checkboxes all share the aria-label "Select transaction" (the
// header "select all" checkbox is named "Select all transactions", which
// doesn't match this exact string) — DOM order mirrors the `transactions`
// array with pending rows rendered before approved rows, so indices 0/1 are
// the pending pair and 2/3 are the approved pair for the fixture above.
function rowCheckboxes() {
  return screen.getAllByRole("checkbox", { name: "Select transaction" });
}

async function selectRows(user: ReturnType<typeof userEvent.setup>, indices: number[]) {
  for (const i of indices) {
    await user.click(rowCheckboxes()[i]);
  }
}

// The persistent Undo/Redo pair in TransactionToolbar also renders a button
// literally named "Undo" (armed the moment an entry lands on the stack), so
// an unscoped `getByRole("button", { name: /undo/i })` matches two elements
// once any mutation has pushed an entry. Scope to the toast region (role
// "status") to reach the ephemeral one the toast copy promises.
function toastUndoButton() {
  return within(screen.getByRole("status")).getByRole("button", { name: /undo/i });
}
function queryToastUndoButton() {
  const status = screen.queryByRole("status");
  return status ? within(status).queryByRole("button", { name: /undo/i }) : null;
}

beforeEach(() => {
  __resetUndoRedo();
  vi.mocked(postPendingTransactionsWithSnapshot).mockReset();
  vi.mocked(unpostPendingTransactions).mockReset().mockResolvedValue(undefined);
  vi.mocked(bulkMoveTransactionsToAccountWithSnapshot).mockReset();
  vi.mocked(restoreAccountMoveSnapshot).mockReset().mockResolvedValue(undefined);
  vi.mocked(bulkRenamePayeeWithSnapshot).mockReset();
  vi.mocked(restorePayeeSnapshots).mockReset().mockResolvedValue(undefined);
});

describe("TransactionsClient — approve pending transactions", () => {
  const SNAPSHOT: PendingPostSnapshotRow[] = [
    { id: "p1" } as PendingPostSnapshotRow,
    { id: "p2" } as PendingPostSnapshotRow,
  ];

  it("posts the selected pending rows and toasts an undoable confirmation", async () => {
    vi.mocked(postPendingTransactionsWithSnapshot).mockResolvedValue(SNAPSHOT);
    const user = userEvent.setup();
    setup();

    await selectRows(user, [0, 1]);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(postPendingTransactionsWithSnapshot).toHaveBeenCalledWith(
      expect.arrayContaining(["p1", "p2"])
    );
    expect(
      await screen.findByText(/approved 2 transactions/i)
    ).toBeInTheDocument();
    expect(toastUndoButton()).toBeInTheDocument();
  });

  it("routes the toast's Undo through unpostPendingTransactions with the snapshot, not a bare pop", async () => {
    vi.mocked(postPendingTransactionsWithSnapshot).mockResolvedValue(SNAPSHOT);
    const user = userEvent.setup();
    setup();

    await selectRows(user, [0, 1]);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    await screen.findByText(/approved 2 transactions/i);

    await user.click(toastUndoButton());
    expect(unpostPendingTransactions).toHaveBeenCalledWith(SNAPSHOT);
  });

  it("surfaces an error toast and leaves no undo entry when the post rejects", async () => {
    vi.mocked(postPendingTransactionsWithSnapshot).mockRejectedValue(
      new Error("server exploded")
    );
    const onUnhandled = vi.fn();
    window.addEventListener("unhandledrejection", onUnhandled);
    const user = userEvent.setup();
    setup();

    await selectRows(user, [0, 1]);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(await screen.findByText(/could not approve/i)).toBeInTheDocument();
    // No success toast leaked through, and no Undo affordance was ever offered.
    expect(screen.queryByText(/approved \d+ transaction/i)).not.toBeInTheDocument();
    expect(queryToastUndoButton()).not.toBeInTheDocument();
    expect(onUnhandled).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", onUnhandled);
  });
});

describe("TransactionsClient — bulk rename payee", () => {
  const SNAPSHOT: PayeeSnapshotRow[] = [
    { id: "a1" } as PayeeSnapshotRow,
    { id: "a2" } as PayeeSnapshotRow,
  ];

  async function renameSelectedTo(
    user: ReturnType<typeof userEvent.setup>,
    name: string
  ) {
    await selectRows(user, [2, 3]);
    await user.click(screen.getByRole("button", { name: /rename payee/i }));
    const input = await screen.findByPlaceholderText(/new payee name/i);
    await user.type(input, name);
    await user.click(screen.getByRole("button", { name: /^rename$/i }));
  }

  it("renames the selected rows' payee and toasts an undoable confirmation", async () => {
    vi.mocked(bulkRenamePayeeWithSnapshot).mockResolvedValue(SNAPSHOT);
    const user = userEvent.setup();
    setup();

    await renameSelectedTo(user, "Trader Joe's");

    expect(bulkRenamePayeeWithSnapshot).toHaveBeenCalledWith(
      expect.arrayContaining(["a1", "a2"]),
      "Trader Joe's"
    );
    expect(
      await screen.findByText(/renamed payee on 2 transactions/i)
    ).toBeInTheDocument();
    expect(toastUndoButton()).toBeInTheDocument();
  });

  it("routes the toast's Undo through restorePayeeSnapshots with the snapshot", async () => {
    vi.mocked(bulkRenamePayeeWithSnapshot).mockResolvedValue(SNAPSHOT);
    const user = userEvent.setup();
    setup();

    await renameSelectedTo(user, "Trader Joe's");
    await screen.findByText(/renamed payee on 2 transactions/i);

    await user.click(toastUndoButton());
    expect(restorePayeeSnapshots).toHaveBeenCalledWith(SNAPSHOT);
  });
});

describe("TransactionsClient — bulk move to account", () => {
  const SNAPSHOT: AccountMoveSnapshot = { rows: [] } as unknown as AccountMoveSnapshot;

  // "Move to account" sits behind More > Move to account, a nested Base UI
  // submenu that opens on hover (its click handler ignores mouse events by
  // design — `ignoreMouse: openOnHover` in MenuSubmenuTrigger). userEvent's
  // pointer-events hit-testing also doesn't resolve a plain `.click()` on the
  // item reliably once it's open in happy-dom, so the final activation goes
  // through fireEvent — the open (hover) half of the interaction is still
  // driven for real through userEvent.
  async function moveSelectedTo(
    user: ReturnType<typeof userEvent.setup>,
    accountName: string
  ) {
    await selectRows(user, [2, 3]);
    await user.click(screen.getByRole("button", { name: /^more$/i }));
    const subTrigger = await screen.findByText(/move to account/i);
    await user.hover(subTrigger);
    const item = await screen.findByRole("menuitem", { name: accountName });
    fireEvent.click(item);
  }

  it("moves the selected rows to the target account and toasts an undoable confirmation", async () => {
    vi.mocked(bulkMoveTransactionsToAccountWithSnapshot).mockResolvedValue(SNAPSHOT);
    const user = userEvent.setup();
    setup();

    await moveSelectedTo(user, "Savings");

    expect(bulkMoveTransactionsToAccountWithSnapshot).toHaveBeenCalledWith(
      expect.arrayContaining(["a1", "a2"]),
      "acct-savings"
    );
    expect(
      await screen.findByText(/moved 2 transactions to savings/i)
    ).toBeInTheDocument();
    expect(toastUndoButton()).toBeInTheDocument();
  });

  it("routes the toast's Undo through restoreAccountMoveSnapshot with the snapshot", async () => {
    vi.mocked(bulkMoveTransactionsToAccountWithSnapshot).mockResolvedValue(SNAPSHOT);
    const user = userEvent.setup();
    setup();

    await moveSelectedTo(user, "Savings");
    await screen.findByText(/moved 2 transactions to savings/i);

    await user.click(toastUndoButton());
    expect(restoreAccountMoveSnapshot).toHaveBeenCalledWith(SNAPSHOT);
  });
});

describe("TransactionsClient — selection follows the view", () => {
  it("drops a selected row from the selection when it leaves the filtered view", async () => {
    const user = userEvent.setup();
    const { rerender } = setup();

    // Select one approved row: the header checkbox goes indeterminate.
    await selectRows(user, [2]);
    const header = () =>
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Select all transactions" });
    expect(header().indeterminate).toBe(true);

    // Categorizing it under an "uncategorized" filter makes the server drop it
    // from the next payload.
    rerender(
      <TransactionsClient
        transactions={[PENDING_1, PENDING_2, APPROVED_2]}
        accounts={ACCOUNTS}
        categories={CATEGORIES}
        categoryGroups={CATEGORY_GROUPS}
        payees={[]}
        earliestTransactionYear={2024}
        hiddenCount={0}
      />
    );

    expect(header().indeterminate).toBe(false);
    expect(header()).not.toBeChecked();
    for (const box of rowCheckboxes()) {
      expect(box).not.toBeChecked();
    }
  });
});
