import { test, expect } from "@playwright/test";
import { BudgetModel } from "../page-models/budget.model";

test.describe("Budget", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/budget");
  });

  test("shows Ready to Assign header", async ({ page }) => {
    await expect(new BudgetModel(page).readyToAssign()).toBeVisible();
  });

  test("shows category groups and categories", async ({ page }) => {
    // Column headers are uppercase in the source
    await expect(page.getByText("CATEGORY").first()).toBeVisible();
    await expect(page.getByText("ASSIGNED").first()).toBeVisible();
    await expect(page.getByText("ACTIVITY").first()).toBeVisible();
    await expect(page.getByText("AVAILABLE").first()).toBeVisible();
  });

  test("month selector navigates between months", async ({ page }) => {
    const budget = new BudgetModel(page);

    // Get current month text
    const monthDisplay = page.locator("text=/[A-Z][a-z]+ \\d{4}/").first();
    const initialMonth = await monthDisplay.textContent();

    // Navigate to previous month
    await budget.goToMonth("prev");
    await page.waitForTimeout(500); // Wait for navigation

    // Month should have changed
    const newMonth = await monthDisplay.textContent();
    expect(newMonth).not.toBe(initialMonth);

    // Navigate back
    await budget.goToMonth("next");
  });

  test("has add category group button", async ({ page }) => {
    // Icon-only in the control row, so find it by its accessible name.
    await expect(
      page.getByRole("button", { name: "Add category group" }).first()
    ).toBeVisible();
  });

  // Default viewport is below the 1400px inline-panel breakpoint, so a
  // selected category opens in the drawer. The assign test below pins the
  // other half: clicking an assign cell must NOT open it (the modal drawer
  // stole focus and closed the input before a keystroke).
  test("clicking a category name opens its drawer at narrow widths", async ({ page }) => {
    await page.getByRole("rowheader", { name: "Groceries", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("tab", { name: /goals/i })).toBeVisible();
  });

  // The whole assign chunk exists to keep Ready to assign honest: assigning
  // money must reduce it by exactly that amount, and undo must return it.
  test("assigning money moves Ready to assign, and undo returns it", async ({ page }) => {
    // The RTA amount always carries an aria-label with the real figure, even
    // when the visible chrome changes with sign.
    const rtaLabel = new BudgetModel(page).readyToAssign();
    await expect(rtaLabel).toBeVisible();

    const readRta = async (): Promise<number> => {
      const label = (await rtaLabel.getAttribute("aria-label")) ?? "";
      const negative = /-|\(/.test(label);
      const magnitude = parseFloat(label.replace(/[^0-9.]/g, ""));
      return negative ? -magnitude : magnitude;
    };

    const before = await readRta();

    // Assign cells are the muted-field buttons in the Assigned column; the
    // available pills next to them are badges, not bg-muted, so this can't
    // grab one by mistake.
    const assignCell = page.locator("button.bg-muted").first();
    await assignCell.click();
    const input = page.locator('input[type="number"]').first();
    const current = parseFloat((await input.inputValue()) || "0") || 0;
    await input.fill(String(current + 100));
    await input.press("Enter");

    // Server-driven (revalidatePath), so poll rather than reading once.
    await expect.poll(readRta).toBeCloseTo(before - 100, 2);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(readRta).toBeCloseTo(before, 2);
  });
});
