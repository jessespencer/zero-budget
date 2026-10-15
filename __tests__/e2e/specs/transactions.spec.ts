import { test, expect } from "@playwright/test";
import { TransactionsModel } from "../page-models/transactions.model";

test.describe("Transactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/transactions");
  });

  test("shows the transactions page heading", async ({ page }) => {
    const txns = new TransactionsModel(page);
    await expect(txns.heading).toBeVisible();
  });

  test("add transaction button opens dialog", async ({ page }) => {
    const txns = new TransactionsModel(page);

    await txns.openAddDialog();

    // Dialog should be visible with the heading
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Add expense" })).toBeVisible();

    // Can close it
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("transaction dialog has expense/income toggle", async ({ page }) => {
    const txns = new TransactionsModel(page);
    await txns.openAddDialog();

    const dialog = page.getByRole("dialog");

    // Expense toggle button (use exact match to avoid matching "Add expense")
    const expenseBtn = dialog.getByRole("button", { name: "Expense", exact: true });
    const incomeBtn = dialog.getByRole("button", { name: "Income", exact: true });

    await expect(expenseBtn).toHaveAttribute("aria-pressed", "true");
    await expect(incomeBtn).toHaveAttribute("aria-pressed", "false");

    // Toggle to income
    await incomeBtn.click();
    await expect(incomeBtn).toHaveAttribute("aria-pressed", "true");

    // Title changes
    await expect(dialog.getByRole("heading", { name: "Add income" })).toBeVisible();
  });

  test("transaction dialog has amount, date, and payee fields", async ({ page }) => {
    const txns = new TransactionsModel(page);
    await txns.openAddDialog();

    const dialog = page.getByRole("dialog");

    // Amount input with placeholder
    await expect(dialog.locator("#txn-amount")).toBeVisible();

    // Date input
    await expect(dialog.locator("#txn-date")).toBeVisible();

    // Payee input
    await expect(dialog.getByPlaceholder(/Where did you spend/)).toBeVisible();

    // Memo input
    await expect(dialog.getByPlaceholder("Add a note (optional)")).toBeVisible();
  });
});
