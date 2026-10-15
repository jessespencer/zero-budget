import type { Page, Locator } from "@playwright/test";

export class SidebarModel {
  readonly page: Page;
  readonly sidebar: Locator;
  readonly nav: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.locator("aside");
    this.nav = page.locator('nav[aria-label="Main navigation"]');
  }

  /** Navigate to a page via the sidebar link */
  async navigateTo(label: "Insights" | "Budget" | "Transactions" | "Schedules" | "Transfer plan") {
    await this.nav.getByText(label, { exact: true }).click();
  }

  /** Get a nav link locator */
  navLink(label: string): Locator {
    return this.nav.getByText(label, { exact: true });
  }

  /** Get the active nav link (aria-current="page") */
  activeNavLink(): Locator {
    return this.nav.locator('[aria-current="page"]');
  }

  /** Get the account balance text for a specific account name */
  accountLink(name: string): Locator {
    return this.sidebar.getByText(name, { exact: true });
  }

  /** Collapse the sidebar */
  async collapse() {
    await this.page.getByLabel("Collapse sidebar").click();
  }

  /** Expand the sidebar */
  async expand() {
    await this.page.getByLabel("Expand sidebar").click();
  }
}
