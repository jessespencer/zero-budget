import type { Page, Locator } from "@playwright/test";

export class SchedulesModel {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The page heading */
  get heading(): Locator {
    return this.page.getByRole("heading", { name: "Schedules", exact: true });
  }

  /**
   * The header "Add schedule" button. With no schedules the empty state renders
   * a second one, so `.first()` keeps this unambiguous in both states.
   */
  get addButton(): Locator {
    return this.page.getByRole("button", { name: "Add schedule" }).first();
  }

  /** Schedule rows in the table */
  get rows(): Locator {
    return this.page.getByRole("row");
  }

  /** Open the add schedule dialog */
  async openAddDialog() {
    await this.addButton.click();
  }

  /** Find a schedule row by payee name */
  rowByPayee(payee: string): Locator {
    return this.page.getByRole("row").filter({ hasText: payee });
  }
}
