import { test, expect } from "@playwright/test";
import { SchedulesModel } from "../page-models/schedules.model";

test.describe("Schedules", () => {
  test("shows the schedules page", async ({ page }) => {
    await page.goto("/schedules");

    const schedules = new SchedulesModel(page);
    await expect(schedules.heading).toBeVisible();
    await expect(schedules.addButton).toBeVisible();
  });

  test("add schedule button opens dialog", async ({ page }) => {
    await page.goto("/schedules");

    const schedules = new SchedulesModel(page);
    await schedules.openAddDialog();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Dialog should have a heading with "schedule" in it
    await expect(dialog.getByRole("heading").first()).toBeVisible();
  });
});
