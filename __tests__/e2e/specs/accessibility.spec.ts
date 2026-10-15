import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Axe-core smoke regression.
 *
 * Fails only on `serious` and `critical` violations. `moderate` and `minor`
 * issues were triaged at audit time and are NOT regressions.
 *
 * Routes covered (each scanned in both light and dark themes):
 *   - /insights
 *   - /budget
 *   - /transactions
 *   - /schedules
 *   - /quick (mobile viewport)
 *   - /transfer-plan
 *   - /accounts/[id] — discovered at runtime from the first insights link
 *   - /assets/[id] — discovered at runtime from the first insights link
 *
 * /dev/* routes are debug-only and not user-facing, so they're skipped.
 * (There used to be a /reports/reconciliation exclusion here too; that page
 * was deleted 2026-07-26 — reconciling now happens in the account-page
 * dialog via reconcileAccountWithSnapshot.)
 *
 * Theme parametrization: next-themes stores the active theme in
 * `localStorage["theme"]`. We seed that value via `page.addInitScript`
 * before navigation so the inline `<script>` next-themes injects sets
 * the document class (`light` / `dark`) before paint — axe then scans
 * the correctly-themed DOM on the first pass.
 *
 * Wait pattern mirrors __tests__/e2e/specs/navigation.spec.ts "each page loads
 * without errors" — wait for a known heading or text string before scanning.
 *
 * Dynamic IDs: the /accounts/[id] and /assets/[id] cases visit /insights
 * first, grab the first `a[href^="/accounts/"]` / `a[href^="/assets/"]` href,
 * then navigate. Avoids hardcoding fixture IDs against the live dev DB.
 */

type Route = {
  path: string;
  heading?: string;
  text?: string;
  /** CSS selector to wait for when neither a heading nor unique text fits. */
  selector?: string;
  mobileViewport?: boolean;
  /**
   * When set, the spec navigates to /insights first and reads the first
   * matching href to derive the real id, then navigates to it. Use for any
   * dynamic-segment route whose id changes per environment.
   */
  discoverHrefFromInsights?: string; // CSS selector, e.g. 'a[href^="/accounts/"]'
};

const routes: Route[] = [
  { path: "/insights", heading: "Insights" },
  { path: "/budget", selector: '[aria-label^="Ready to assign:"]' },
  { path: "/transactions", heading: "Transactions" },
  { path: "/schedules", heading: "Schedules" },
  // /quick is the mobile PWA surface — emulate iPhone 14 viewport
  { path: "/quick", text: "Quick add", mobileViewport: true },
  { path: "/transfer-plan" },
  {
    path: "/accounts/[id]",
    discoverHrefFromInsights: 'a[href^="/accounts/"]',
  },
  {
    path: "/assets/[id]",
    discoverHrefFromInsights: 'a[href^="/assets/"]',
  },
];

const themes: Array<"light" | "dark"> = ["light", "dark"];

test.describe("Accessibility smoke (axe-core)", () => {
  for (const theme of themes) {
    for (const route of routes) {
      test(`no serious or critical axe violations on ${route.path} (${theme})`, async ({ page }) => {
        if (route.mobileViewport) {
          await page.setViewportSize({ width: 390, height: 844 });
        }

        // Seed next-themes' localStorage key before the page loads so its
        // inline script sets the correct class on <html> before first paint.
        await page.addInitScript((t) => {
          try {
            window.localStorage.setItem("theme", t);
          } catch {
            // Some test contexts disallow localStorage access; swallow so
            // the test still runs against whatever the default theme is.
          }
        }, theme);

        let targetPath = route.path;
        if (route.discoverHrefFromInsights) {
          await page.goto("/insights");
          await expect(
            page.getByRole("heading", { name: "Insights" }).first(),
          ).toBeVisible();
          const href = await page
            .locator(route.discoverHrefFromInsights)
            .first()
            .getAttribute("href");
          test.skip(!href, `No ${route.path} link found on /insights — DB has no rows of this type`);
          targetPath = href!;
        }

        await page.goto(targetPath);

        if (route.heading) {
          await expect(
            page.getByRole("heading", { name: route.heading }).first(),
          ).toBeVisible();
        }
        if (route.text) {
          await expect(page.getByText(route.text).first()).toBeVisible();
        }
        if (route.selector) {
          await expect(page.locator(route.selector).first()).toBeVisible();
        }

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();

        const serious = results.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        );

        // Include the full violation payload in the failure message so the
        // output is actionable without re-running with --debug.
        expect(
          serious,
          `Serious/critical axe violations on ${route.path} (${theme}):\n${JSON.stringify(serious, null, 2)}`,
        ).toEqual([]);
      });
    }
  }
});
