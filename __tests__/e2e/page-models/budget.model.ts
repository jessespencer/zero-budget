import type { Page, Locator } from "@playwright/test";

export class BudgetModel {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * The Ready to assign figure in the page header. Both header states — the
   * amount pill and the zero-state headline — carry this label, so it is
   * present whatever the balance is. Matching the visible "Ready to assign"
   * text instead hits the hidden overview panel first.
   */
  readyToAssign(): Locator {
    return this.page.locator('[aria-label^="Ready to assign:"]').first();
  }

  /** Find a category row by name */
  categoryRow(name: string): Locator {
    return this.page.getByRole("row").filter({ hasText: name });
  }

  /** Click the assigned cell for a category to begin editing */
  async clickAssigned(categoryName: string) {
    const row = this.categoryRow(categoryName);
    // The assign button shows "—" for zero or a dollar amount
    await row.locator("button").filter({ hasText: /^(\$|—)/ }).click();
  }

  /** Type a new assignment value and press Enter */
  async setAssigned(categoryName: string, amount: string) {
    await this.clickAssigned(categoryName);
    const input = this.page.locator('input[type="number"]');
    await input.fill(amount);
    await input.press("Enter");
  }

  /** Get a category group row */
  groupRow(name: string): Locator {
    return this.page.getByRole("row").filter({ hasText: name }).first();
  }

  /** Navigate to a specific month using the month selector */
  async goToMonth(direction: "prev" | "next") {
    if (direction === "prev") {
      await this.page.getByLabel("Previous month").click();
    } else {
      await this.page.getByLabel("Next month").click();
    }
  }
}
