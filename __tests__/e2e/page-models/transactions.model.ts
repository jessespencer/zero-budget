import type { Page, Locator } from "@playwright/test";

export class TransactionsModel {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The page heading */
  get heading(): Locator {
    return this.page.getByRole("heading", { name: "Transactions", exact: true });
  }

  /** The "Add transaction" button in the page header */
  get addButton(): Locator {
    return this.page.getByRole("button", { name: "Add transaction" }).first();
  }

  /** Transaction rows in the table */
  get rows(): Locator {
    return this.page.getByRole("row");
  }

  /** Open the add transaction dialog */
  async openAddDialog() {
    await this.addButton.click();
  }

  /** Fill out the transaction dialog and submit */
  async createTransaction(data: { amount: string; payee: string }) {
    await this.openAddDialog();

    // Wait for dialog to appear
    const dialog = this.page.getByRole("dialog");
    await dialog.waitFor();

    // Fill amount
    const amountInput = dialog.locator("#txn-amount");
    await amountInput.fill(data.amount);

    // Fill payee - it's a combobox, type into its input
    const payeeInput = dialog.getByPlaceholder(/Where did you spend/);
    await payeeInput.fill(data.payee);

    // Submit
    await dialog.getByRole("button", { name: "Add expense" }).click();

    // Wait for dialog to close
    await dialog.waitFor({ state: "hidden" });
  }

  /** Search for transactions */
  async search(query: string) {
    const searchInput = this.page.getByPlaceholder(/search/i);
    await searchInput.fill(query);
  }

  /** Get text content of a specific row */
  rowByPayee(payee: string): Locator {
    return this.page.getByRole("row").filter({ hasText: payee });
  }
}
