import { defineConfig, devices } from "@playwright/test";
import { createSeededDatabase } from "./__tests__/e2e/fixtures/test-database";

/**
 * E2E test configuration.
 *
 * Local development:
 *   1. Start dev server: npm run dev
 *   2. Run tests: npm run test:e2e
 *
 * CI: Set E2E_BASE_URL or uses default port 3000.
 */
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const isCI = !!process.env.CI;

// Seed here, at config load, not in globalSetup: Playwright starts `webServer`
// before globalSetup runs, so a path exported from there never reaches the dev
// server — it silently falls back to `data/zero.db`. This file is also
// evaluated in every worker process; workers inherit the runner's env, so the
// guard makes sure only the runner seeds. global-teardown.ts removes the dir.
if (isCI && !process.env.ZERO_E2E_DB_PATH) {
  process.env.ZERO_E2E_DB_PATH = createSeededDatabase().dbPath;
}
const e2eDbPath = process.env.ZERO_E2E_DB_PATH;

export default defineConfig({
  testDir: "__tests__/e2e/specs",
  globalTeardown: isCI ? "__tests__/e2e/global-teardown.ts" : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: isCI ? 1 : 0,
  workers: isCI ? 3 : 1,
  reporter: isCI ? [["blob"], ["list"]] : [["list"]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(isCI &&
    e2eDbPath && {
      webServer: {
        command: `npx next dev --turbopack --port 3000`,
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 120_000,
        env: { ZERO_DB_PATH: e2eDbPath },
        stdout: "pipe",
      },
    }),
});
