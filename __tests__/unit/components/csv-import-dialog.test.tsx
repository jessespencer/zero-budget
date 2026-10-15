import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { CSVImportDialog } from "@/components/transactions/csv-import-dialog";
import type { ParsedTransaction } from "@/lib/csv-parsers";

// Call-site tier: does the dialog acknowledge what /api/import and the
// duplicate scan and the import loop actually do — not "does the parser
// produce the right rows" (that's csv-parsers.test.ts) and not "does the
// server action write the right rows" (that's transactions actions.test.ts).
//
// Three findings pinned here:
//  - Finding 11: handleFile's fetch/json() round trip has a try/catch. A
//    dropped connection or a non-JSON error body must not throw an unhandled
//    rejection — the dialog has to show an inline error instead.
//  - Finding 9: runDuplicateDetection's findDuplicates call has a try/catch.
//    A failed duplicate scan must not dead-end the import on preview with no
//    way forward — it falls back to no DB-side dupe flags and still shows
//    the transaction list with a live Import button.
//  - Finding 4: the import loop catches a mid-loop rejection, reports the
//    partial count, and always lands on the summary screen rather than
//    bouncing back to preview with Import re-enabled (which would risk a
//    double-import on retry).
vi.mock("@/app/(app)/transactions/actions", () => ({
  findDuplicates: vi.fn(),
}));

import { findDuplicates } from "@/app/(app)/transactions/actions";

const ACCOUNT_ID = "acct-checking";
const accounts = [{ id: ACCOUNT_ID, name: "Checking" }];
const payees: { name: string; default_category_id: string | null }[] = [];
const categories: { id: string; name: string }[] = [];

function txns(overrides: Partial<ParsedTransaction>[] = []): ParsedTransaction[] {
  const base: ParsedTransaction[] = [
    { date: "2026-07-01", payee: "Coffee Shop", amount: -4.5 },
    { date: "2026-07-02", payee: "Paycheck", amount: 1200 },
    { date: "2026-07-03", payee: "Groceries", amount: -62.19 },
  ];
  return overrides.length ? (overrides as ParsedTransaction[]) : base;
}

function mockFetchOk(transactions: ParsedTransaction[], bank = "Test") {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ bank, transactions }),
  }) as unknown as typeof fetch;
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /import csv/i }));
}

async function uploadFile(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText(/choose csv file/i);
  const file = new File(["irrelevant, content is never read"], "x.csv", {
    type: "text/csv",
  });
  await user.upload(input, file);
}

beforeEach(() => {
  vi.mocked(findDuplicates).mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error -- restoring the real fetch after stubbing it per-test
  delete global.fetch;
});

describe("CSVImportDialog — reading the file (Finding 11)", () => {
  it("shows an inline error instead of throwing when fetch itself rejects", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockRejectedValue(new Error("network drop"));

    renderWithProviders(
      <CSVImportDialog
        accounts={accounts}
        payees={payees}
        categories={categories}
        onImport={vi.fn()}
      />
    );
    await openDialog(user);
    await uploadFile(user);

    expect(
      await screen.findByText(/could not read that file/i)
    ).toBeInTheDocument();
  });

  it("shows the same inline error when the response body isn't valid JSON", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("bad");
      },
    }) as unknown as typeof fetch;

    renderWithProviders(
      <CSVImportDialog
        accounts={accounts}
        payees={payees}
        categories={categories}
        onImport={vi.fn()}
      />
    );
    await openDialog(user);
    await uploadFile(user);

    expect(
      await screen.findByText(/could not read that file/i)
    ).toBeInTheDocument();
  });
});

describe("CSVImportDialog — duplicate scan on the single-account path (Finding 9)", () => {
  it("still shows the preview with a live Import button when findDuplicates rejects", async () => {
    const user = userEvent.setup();
    mockFetchOk(txns());
    vi.mocked(findDuplicates).mockRejectedValue(new Error("db is gone"));

    renderWithProviders(
      <CSVImportDialog
        accounts={accounts}
        payees={payees}
        categories={categories}
        onImport={vi.fn()}
        defaultAccountId={ACCOUNT_ID}
      />
    );
    await openDialog(user);
    await uploadFile(user);

    // The preview must render first regardless of how the scan behind it
    // turns out — a dead-end here would strand the user with no way to
    // import at all.
    expect(
      await screen.findByRole("button", { name: /^import 3 transactions$/i })
    ).toBeEnabled();

    expect(
      await screen.findByText(/couldn't check for duplicates/i)
    ).toBeInTheDocument();
  });
});

describe("CSVImportDialog — the import loop (Finding 4)", () => {
  it("lands on summary with a partial-count error when onImport rejects", async () => {
    const user = userEvent.setup();
    mockFetchOk(txns());
    const onImport = vi.fn().mockRejectedValue(new Error("connection lost"));

    renderWithProviders(
      <CSVImportDialog
        accounts={accounts}
        payees={payees}
        categories={categories}
        onImport={onImport}
        defaultAccountId={ACCOUNT_ID}
      />
    );
    await openDialog(user);
    await uploadFile(user);

    const importButton = await screen.findByRole("button", {
      name: /^import 3 transactions$/i,
    });
    await user.click(importButton);

    // Must NOT bounce back to a live preview with Import re-enabled — that
    // would let the user double-click and re-import. The single-account import
    // is atomic now, so a rejection saves nothing: the copy says exactly that.
    expect(
      await screen.findByText(/import failed — connection lost\. no rows were saved/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/0 transactions imported/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^import 3 transactions$/i })
    ).not.toBeInTheDocument();
  });

  it("shows the full count and no error on a clean import", async () => {
    const user = userEvent.setup();
    mockFetchOk(txns());
    const onImport = vi
      .fn()
      .mockResolvedValue({ imported: 3, categorized: 1, snapshots: [] });

    renderWithProviders(
      <CSVImportDialog
        accounts={accounts}
        payees={payees}
        categories={categories}
        onImport={onImport}
        defaultAccountId={ACCOUNT_ID}
      />
    );
    await openDialog(user);
    await uploadFile(user);

    const importButton = await screen.findByRole("button", {
      name: /^import 3 transactions$/i,
    });
    await user.click(importButton);

    expect(await screen.findByText(/3 transactions imported/i)).toBeInTheDocument();
    expect(
      screen.getByText(/1 auto-categorized from learned payees/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/import failed after saving/i)).not.toBeInTheDocument();
    expect(onImport).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.arrayContaining([expect.objectContaining({ payee: "Coffee Shop" })])
    );
  });

  it("hands every created snapshot to onComplete on a clean import", async () => {
    const user = userEvent.setup();
    mockFetchOk(txns());
    const snapshots = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
    const onImport = vi
      .fn()
      .mockResolvedValue({ imported: 3, categorized: 0, snapshots });
    const onComplete = vi.fn();

    renderWithProviders(
      <CSVImportDialog
        accounts={accounts}
        payees={payees}
        categories={categories}
        onImport={onImport}
        onComplete={onComplete}
        defaultAccountId={ACCOUNT_ID}
      />
    );
    await openDialog(user);
    await uploadFile(user);
    await user.click(
      await screen.findByRole("button", { name: /^import 3 transactions$/i })
    );

    await screen.findByText(/3 transactions imported/i);
    // The whole import must arrive as one batch so the caller can offer a
    // single Undo for it — not one onComplete per row.
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(snapshots);
  });

  it("does not call onComplete when the import fails", async () => {
    const user = userEvent.setup();
    mockFetchOk(txns());
    const onImport = vi.fn().mockRejectedValue(new Error("connection lost"));
    const onComplete = vi.fn();

    renderWithProviders(
      <CSVImportDialog
        accounts={accounts}
        payees={payees}
        categories={categories}
        onImport={onImport}
        onComplete={onComplete}
        defaultAccountId={ACCOUNT_ID}
      />
    );
    await openDialog(user);
    await uploadFile(user);
    await user.click(
      await screen.findByRole("button", { name: /^import 3 transactions$/i })
    );

    await screen.findByText(/no rows were saved/i);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("CSVImportDialog — a duplicate flag must not silently drop a charge", () => {
  // findDuplicates matches on (date, amount) only — it deliberately ignores the payee,
  // because the CSV carries the raw bank description and the DB carries the normalized
  // name. That makes a genuine repeat charge indistinguishable from a real duplicate.
  // The dialog used to auto-deselect on that signal, so a legitimate second charge
  // vanished unless the user noticed the badge. The error is one-directional — it can
  // only ever lose money, never invent it — so flagged rows stay checked by default and
  // the user opts out rather than in.
  function renderWithFlag(onImport = vi.fn().mockResolvedValue([])) {
    mockFetchOk(txns());
    vi.mocked(findDuplicates).mockResolvedValue([1]); // flag the $1200 paycheck
    renderWithProviders(
      <CSVImportDialog
        accounts={accounts}
        payees={payees}
        categories={categories}
        onImport={onImport}
        defaultAccountId={ACCOUNT_ID}
      />
    );
    return onImport;
  }

  it("surfaces the flag so the user can act on it", async () => {
    const user = userEvent.setup();
    renderWithFlag();
    await openDialog(user);
    await uploadFile(user);

    expect(await screen.findByText(/\(possible duplicate\)/i)).toBeInTheDocument();
  });

  it("leaves the flagged row checked", async () => {
    const user = userEvent.setup();
    renderWithFlag();
    await openDialog(user);
    await uploadFile(user);
    await screen.findByText(/\(possible duplicate\)/i);

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.filter((b) => !b.checked)).toHaveLength(0);
  });

  it("still imports the flagged charge when the user does nothing", async () => {
    const user = userEvent.setup();
    const onImport = renderWithFlag();
    await openDialog(user);
    await uploadFile(user);
    await screen.findByText(/\(possible duplicate\)/i);
    await user.click(
      await screen.findByRole("button", { name: /^import 3 transactions$/i })
    );

    // onImport(accountId, transactions)
    const [acctId, imported] = onImport.mock.calls[0] as [string, ParsedTransaction[]];
    expect(acctId).toBe(ACCOUNT_ID);
    expect(imported).toHaveLength(3);
    expect(imported.some((t) => t.amount === 1200)).toBe(true);
  });

  it("respects an explicit uncheck — opting out still works", async () => {
    const user = userEvent.setup();
    const onImport = renderWithFlag();
    await openDialog(user);
    await uploadFile(user);
    await screen.findByText(/\(possible duplicate\)/i);

    // Flagged rows are hoisted to the top of the preview, so index-based lookup is
    // fragile — reach the checkbox through the badge's own row instead.
    const flaggedRow = (await screen.findByText(/\(possible duplicate\)/i)).closest("tr");
    expect(flaggedRow).not.toBeNull();
    await user.click(within(flaggedRow as HTMLElement).getByRole("checkbox"));
    await user.click(
      await screen.findByRole("button", { name: /^import 2 transactions$/i })
    );

    const [, imported] = onImport.mock.calls[0] as [string, ParsedTransaction[]];
    expect(imported).toHaveLength(2);
    expect(imported.some((t) => t.amount === 1200)).toBe(false);
  });
});
