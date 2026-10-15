import type { Page, Locator } from "@playwright/test";

export class InsightsModel {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The page heading */
  get heading(): Locator {
    return this.page.getByRole("heading", { name: "Insights", exact: true });
  }

  /** Account name in the account table */
  accountRow(name: string): Locator {
    return this.page.getByRole("row").filter({ hasText: name });
  }
}
