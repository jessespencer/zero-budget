import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { QuickAddForm } from "@/app/quick/quick-add-form";

// Amount maths on /quick (SEED-024) — the proving ground before the budget
// assign cell and the transaction amount pick it up. The evaluator itself is
// covered in lib/amount-expression.test.ts; this pins the keypad UX on top of
// it and that the evaluated total, not the last operand, is what gets saved.
vi.mock("@/app/(app)/transactions/actions", () => ({
  createQuickTransaction: vi.fn(() => Promise.resolve({ id: "txn-1" })),
  createQuickSplitTransaction: vi.fn(() => Promise.resolve({ id: "txn-2" })),
  createQuickTransfer: vi.fn(() => Promise.resolve({})),
  updateQuickTransaction: vi.fn(() => Promise.resolve()),
  deleteQuickTransaction: vi.fn(() => Promise.resolve()),
}));
import {
  createQuickTransaction,
  createQuickTransfer,
} from "@/app/(app)/transactions/actions";

function setup() {
  return renderWithProviders(
    <QuickAddForm
      accounts={[
        { id: "acct-1", name: "Checking", type: "checking", is_budget_account: true },
        { id: "acct-2", name: "Savings", type: "savings", is_budget_account: true },
      ]}
      categories={[{ id: "cat-1", name: "Groceries", category_group_id: "grp-1" }]}
      categoryGroups={[{ id: "grp-1", name: "Everyday", is_income: false }]}
      topCategoryIds={["cat-1"]}
      topIncomeCategoryIds={[]}
      recentQuickAdds={[]}
      payees={[]}
      availableByCategory={{}}
    />
  );
}

const amountInput = () => screen.getByPlaceholderText("0.00");
const total = () => screen.getByTestId("amount-total");

beforeEach(() => {
  vi.mocked(createQuickTransaction).mockClear();
  vi.mocked(createQuickTransfer).mockClear();
  localStorage.clear();
});

describe("QuickAddForm amount maths", () => {
  it("reads 5 + 5 as ten dollars, not ten cents", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "5+5");

    expect(amountInput()).toHaveValue("5 + 5");
    expect(total()).toHaveTextContent("$10.00");
  });

  it("types cents with a point", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "12.50+3");

    expect(amountInput()).toHaveValue("12.50 + 3");
    expect(total()).toHaveTextContent("$15.50");
  });

  it("does the same from the touch operator keys", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "12.50");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(amountInput(), "3");

    expect(amountInput()).toHaveValue("12.50 + 3");
  });

  it("divides by a plain number", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "90/3");

    expect(amountInput()).toHaveValue("90 ÷ 3");
    expect(total()).toHaveTextContent("$30.00");
  });

  it("shortens a plain amount on backspace", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "12.50{Backspace}");

    expect(amountInput()).toHaveValue("12.5");
  });

  it("backspaces through an operator into the previous operand", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "12+{Backspace}");

    expect(amountInput()).toHaveValue("12");
    expect(screen.queryByTestId("amount-total")).not.toBeInTheDocument();
  });

  it("applies a key at the end even when the caret was moved into the middle", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "12+");
    await user.type(amountInput(), "3", { initialSelectionStart: 0, initialSelectionEnd: 0 });

    expect(amountInput()).toHaveValue("12 + 3");
  });

  it("starts over when the whole amount is selected and typed over", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "12+3");
    await user.type(amountInput(), "5", {
      initialSelectionStart: 0,
      initialSelectionEnd: "12 + 3".length,
    });

    expect(amountInput()).toHaveValue("5");
  });

  it("reads a pasted amount as dollars", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(amountInput());
    await user.paste("$1,200.5");

    expect(amountInput()).toHaveValue("1200.50");
  });

  it("saves the evaluated total and clears the expression", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "12.50+3");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(createQuickTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -15.5 })
    );
    expect(amountInput()).toHaveValue("");
  });

  it("won't save an expression that goes negative", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(amountInput(), "10-25");

    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });
});

describe("QuickAddForm transfer memo", () => {
  it("shows the memo field in transfer mode and sends it with the transfer", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("tab", { name: /transfer/i }));
    await user.type(amountInput(), "100");
    // Savings appears in both the From and To rows; the To row comes second.
    const savingsChips = screen.getAllByRole("button", { name: "Savings" });
    await user.click(savingsChips[savingsChips.length - 1]);
    await user.type(screen.getByPlaceholderText("Memo (optional)"), "Emergency fund");
    await user.click(screen.getByRole("button", { name: /^transfer$/i }));

    expect(createQuickTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100, memo: "Emergency fund" })
    );
  });
});
