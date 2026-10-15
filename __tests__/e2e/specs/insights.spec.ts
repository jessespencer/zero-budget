import { test, expect } from "@playwright/test";
import { InsightsModel } from "../page-models/insights.model";

test.describe("Insights", () => {
  test("shows the insights with heading", async ({ page }) => {
    await page.goto("/insights");

    const insights = new InsightsModel(page);
    await expect(insights.heading).toBeVisible();
  });

  test("displays account data from seed", async ({ page }) => {
    await page.goto("/insights");

    // The seeded accounts should have their data visible somewhere
    await expect(page.getByText("Checking").first()).toBeVisible();
  });
});
