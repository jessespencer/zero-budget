import { test, expect } from "@playwright/test";
import { SidebarModel } from "../page-models/sidebar.model";

test.describe("Navigation", () => {
  test("app loads and shows sidebar with navigation links", async ({ page }) => {
    await page.goto("/budget");

    const sidebar = new SidebarModel(page);

    // All nav items are visible
    await expect(sidebar.navLink("Insights")).toBeVisible();
    await expect(sidebar.navLink("Budget")).toBeVisible();
    await expect(sidebar.navLink("Transactions")).toBeVisible();
    await expect(sidebar.navLink("Schedules")).toBeVisible();
    await expect(sidebar.navLink("Transfer plan")).toBeVisible();
  });

  test("sidebar shows budget accounts section", async ({ page }) => {
    await page.goto("/budget");

    // The "Budget" section header should appear in the sidebar
    const sidebar = page.locator("aside");
    await expect(sidebar.getByText("Budget", { exact: true }).first()).toBeVisible();
  });

  test("navigating between pages updates the active link", async ({ page }) => {
    await page.goto("/budget");
    const sidebar = new SidebarModel(page);

    // Budget should be active
    await expect(sidebar.activeNavLink()).toContainText("Budget");

    // Navigate to Transactions
    await sidebar.navigateTo("Transactions");
    await expect(page).toHaveURL(/\/transactions/);
    await expect(sidebar.activeNavLink()).toContainText("Transactions");

    // Navigate to Insights
    await sidebar.navigateTo("Insights");
    await expect(page).toHaveURL(/\/insights/);
    await expect(sidebar.activeNavLink()).toContainText("Insights");

    // Navigate to Schedules
    await sidebar.navigateTo("Schedules");
    await expect(page).toHaveURL(/\/schedules/);
    await expect(sidebar.activeNavLink()).toContainText("Schedules");
  });

  test("sidebar can be collapsed and expanded", async ({ page }) => {
    await page.goto("/budget");
    const sidebar = new SidebarModel(page);

    // Initially expanded — nav labels are visible
    await expect(sidebar.navLink("Insights")).toBeVisible();

    // Collapse
    await sidebar.collapse();

    // Sidebar should be narrow (60px)
    await expect(page.locator("aside")).toHaveCSS("width", "60px");

    // Expand
    await sidebar.expand();

    // Sidebar should be wide again (260px)
    await expect(page.locator("aside")).toHaveCSS("width", "260px");
  });

  test("each page loads without errors", async ({ page }) => {
    const pages = [
      { path: "/insights", heading: "Insights" },
      { path: "/budget", selector: '[aria-label^="Ready to assign:"]' },
      { path: "/transactions", heading: "Transactions" },
      { path: "/schedules", heading: "Schedules" },
    ];

    for (const p of pages) {
      await page.goto(p.path);
      if ("heading" in p && p.heading) {
        await expect(page.getByRole("heading", { name: p.heading }).first()).toBeVisible();
      }
      if ("selector" in p && p.selector) {
        await expect(page.locator(p.selector).first()).toBeVisible();
      }
    }
  });
});
