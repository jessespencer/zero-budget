import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { BudgetOverviewPanel } from "@/components/budget/budget-overview-panel";
import type { BudgetMonth } from "@/lib/types";
import type { MutationEntry } from "@/lib/use-undo-redo";

// Call-site tier — server actions mocked. Asserts the copy/fund flows toast,
// offer Undo, and surface failure; the DB round-trip is budget-actions.test.ts.
vi.mock("@/app/(app)/budget/actions", () => ({
  copyLastMonthBudgetWithSnapshot: vi.fn(),
  getCopyLastMonthPreview: vi.fn(),
  fundUnderfundedWithSnapshot: vi.fn(),
  restoreAssignedSnapshot: vi.fn(() => Promise.resolve()),
  getFundUnderfundedPreview: vi.fn(),
  updateExpectedIncome: vi.fn(() => Promise.resolve()),
}));
import {
  copyLastMonthBudgetWithSnapshot,
  getCopyLastMonthPreview,
  fundUnderfundedWithSnapshot,
  restoreAssignedSnapshot,
  getFundUnderfundedPreview,
} from "@/app/(app)/budget/actions";

const MONTH = "2026-07-01";

function makeBudget(): BudgetMonth {
  return {
    month: MONTH,
    readyToAssign: 0,
    groups: [],
    hiddenCategories: [],
    hiddenGroups: [],
    totalIncome: 0,
    totalAssigned: 0,
    overspentLastMonth: 0,
    currentMonthIncome: 0,
    currentMonthAssigned: 0,
    expectedIncome: null,
    openingCcDebt: 0,
    futureAssigned: 0,
  };
}

function setup() {
  const onMutate = vi.fn((_entry: MutationEntry) => "mutation-7");
  const undoEntry = vi.fn();
  const result = renderWithProviders(
    <BudgetOverviewPanel budget={makeBudget()} onMutate={onMutate} undoEntry={undoEntry} />
  );
  return { onMutate, undoEntry, ...result };
}

beforeEach(() => {
  vi.mocked(copyLastMonthBudgetWithSnapshot).mockReset();
  // Default: nothing this month would be overwritten, so the copy runs
  // straight through without the dialog.
  vi.mocked(getCopyLastMonthPreview)
    .mockReset()
    .mockResolvedValue({ overwriteCount: 0, overwriteAssigned: 0, fillCount: 2 });
  vi.mocked(fundUnderfundedWithSnapshot).mockReset();
  vi.mocked(restoreAssignedSnapshot).mockReset().mockResolvedValue(undefined);
  vi.mocked(getFundUnderfundedPreview).mockReset().mockResolvedValue([]);
});

describe("BudgetOverviewPanel copy last month (F8/F9)", () => {
  it("toasts with a working Undo when categories were copied", async () => {
    const user = userEvent.setup();
    vi.mocked(copyLastMonthBudgetWithSnapshot).mockResolvedValue([
      { category_id: "a", assigned: 0 },
      { category_id: "b", assigned: 0 },
    ]);
    const { onMutate, undoEntry } = setup();

    await user.click(screen.getByRole("button", { name: /copy last month/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/copied last month's budget into 2 categories/i);
    expect(copyLastMonthBudgetWithSnapshot).toHaveBeenCalledWith(MONTH, "replace");
    expect(onMutate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(undoEntry).toHaveBeenCalledWith("mutation-7");
  });

  it("distinguishes the empty no-op from a failure", async () => {
    const user = userEvent.setup();
    vi.mocked(copyLastMonthBudgetWithSnapshot).mockResolvedValue(null);
    const { onMutate } = setup();

    await user.click(screen.getByRole("button", { name: /copy last month/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /nothing to copy — last month has no assignments/i
    );
    // A no-op is not an undoable mutation.
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("warns and changes nothing when the copy fails", async () => {
    const user = userEvent.setup();
    vi.mocked(copyLastMonthBudgetWithSnapshot).mockRejectedValue(new Error("db is gone"));
    const { onMutate } = setup();

    await user.click(screen.getByRole("button", { name: /copy last month/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't copy last month's budget/i
    );
    expect(onMutate).not.toHaveBeenCalled();
  });
});

describe("BudgetOverviewPanel copy last month mid-month", () => {
  beforeEach(() => {
    vi.mocked(getCopyLastMonthPreview).mockResolvedValue({
      overwriteCount: 3,
      overwriteAssigned: 1250,
      fillCount: 2,
    });
  });

  it("asks before overwriting work already assigned this month", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /copy last month/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/already assigned \$1,250\.00 across 3 categories/i);
    expect(copyLastMonthBudgetWithSnapshot).not.toHaveBeenCalled();
  });

  it("fills only empty categories when chosen, with Undo", async () => {
    const user = userEvent.setup();
    vi.mocked(copyLastMonthBudgetWithSnapshot).mockResolvedValue([
      { category_id: "a", assigned: 0 },
      { category_id: "b", assigned: 0 },
    ]);
    const { onMutate, undoEntry } = setup();

    await user.click(screen.getByRole("button", { name: /copy last month/i }));
    await user.click(await screen.findByRole("button", { name: /fill empty only/i }));

    expect(copyLastMonthBudgetWithSnapshot).toHaveBeenCalledWith(MONTH, "fill-empty");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/filled 2 empty categories from last month/i);
    expect(onMutate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(undoEntry).toHaveBeenCalledWith("mutation-7");
  });

  it("still allows replacing everything", async () => {
    const user = userEvent.setup();
    vi.mocked(copyLastMonthBudgetWithSnapshot).mockResolvedValue([
      { category_id: "a", assigned: 400 },
    ]);
    setup();

    await user.click(screen.getByRole("button", { name: /copy last month/i }));
    await user.click(await screen.findByRole("button", { name: /replace all/i }));

    expect(copyLastMonthBudgetWithSnapshot).toHaveBeenCalledWith(MONTH, "replace");
  });

  it("changes nothing when cancelled", async () => {
    const user = userEvent.setup();
    const { onMutate } = setup();

    await user.click(screen.getByRole("button", { name: /copy last month/i }));
    await user.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(copyLastMonthBudgetWithSnapshot).not.toHaveBeenCalled();
    expect(onMutate).not.toHaveBeenCalled();
  });
});

describe("BudgetOverviewPanel fund underfunded (F6/F7)", () => {
  async function openPreviewAndAssign(user: ReturnType<typeof userEvent.setup>) {
    // Preview must resolve non-empty so "Assign money" enables.
    vi.mocked(getFundUnderfundedPreview).mockResolvedValue([
      {
        category_id: "a",
        category_name: "Groceries",
        group_id: "g",
        group_name: "Everyday",
        amount: 40,
      },
    ]);
    await user.click(screen.getByRole("button", { name: /fund underfunded/i }));
    const assign = await screen.findByRole("button", { name: /assign money/i });
    await waitFor(() => expect(assign).toBeEnabled());
    await user.click(assign);
  }

  it("toasts with Undo and closes the dialog on success", async () => {
    const user = userEvent.setup();
    vi.mocked(fundUnderfundedWithSnapshot).mockResolvedValue([
      { category_id: "a", assigned: 0 },
      { category_id: "b", assigned: 0 },
      { category_id: "c", assigned: 0 },
    ]);
    const { undoEntry } = setup();

    await openPreviewAndAssign(user);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/funded 3 categories/i);
    await user.click(screen.getByRole("button", { name: /^undo$/i }));
    expect(undoEntry).toHaveBeenCalledWith("mutation-7");

    // Dialog closed.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /assign money/i })
      ).not.toBeInTheDocument()
    );
  });

  it("closes the dialog and warns when the fund write fails", async () => {
    const user = userEvent.setup();
    vi.mocked(fundUnderfundedWithSnapshot).mockRejectedValue(new Error("db is gone"));
    const { onMutate } = setup();

    await openPreviewAndAssign(user);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't fund the categories/i
    );
    expect(onMutate).not.toHaveBeenCalled();
    // Dialog did not hang open.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /assign money/i })
      ).not.toBeInTheDocument()
    );
  });
});
