import { test, expect } from "@playwright/test";

// The category detail panel + target CRUD had no e2e coverage — budget.spec.ts
// never opens the panel. This is the cheapest guard for the "form closed as if
// it saved, but nothing persisted" class (F4): drive a real create through the
// server action and reload to prove the row survived a round-trip.

// ≥1400px renders the inline detail panel rather than the mobile drawer.
test.use({ viewport: { width: 1600, height: 1000 } });

// A seeded spendable category that starts with no target.
const CATEGORY = "Groceries";

async function openPanel(page: import("@playwright/test").Page) {
  await page.getByRole("rowheader", { name: CATEGORY, exact: true }).click();
  // Goals tab is default; the target section renders here.
  await expect(page.getByRole("tab", { name: /goals/i })).toBeVisible();
}

test.describe("Budget target CRUD", () => {
  test("creates a target, persists across reload, then deletes it", async ({ page }) => {
    await page.goto("/budget");
    await openPanel(page);

    // Empty state → create.
    await expect(page.getByText(/how much do you need/i)).toBeVisible();
    await page.getByRole("button", { name: /create target/i }).click();

    // Monthly "Set aside" is the default chip/goal.
    await page.getByPlaceholder("0.00").fill("250");
    await page.getByRole("button", { name: /save target/i }).click();

    // Wait for the summary view, which only renders once createTarget has
    // resolved. Don't gate on "Set aside $250" — the open form's own preview
    // reads "Set aside $250.00 every month", so that matched before the save
    // landed and the reload below raced the in-flight server action (~2 in 5).
    await expect(page.getByRole("button", { name: /edit target/i })).toBeVisible();
    await expect(page.getByText(/set aside \$250/i)).toBeVisible();

    // The point of the test: reload and confirm the write actually persisted.
    await page.reload();
    await openPanel(page);
    await expect(page.getByText(/set aside \$250/i)).toBeVisible();

    // Delete → snapshot Undo toast (no confirm gate), then confirm it's gone.
    await page.getByRole("button", { name: /edit target/i }).click();
    await page.getByRole("button", { name: /^delete$/i }).click();
    await expect(
      page.getByText(/deleted the groceries target/i)
    ).toBeVisible();

    await page.reload();
    await openPanel(page);
    await expect(page.getByText(/how much do you need/i)).toBeVisible();
  });
});
