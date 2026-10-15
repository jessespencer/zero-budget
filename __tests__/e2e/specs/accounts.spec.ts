import { test, expect, type Page } from "@playwright/test";

/**
 * Accounts — mutation feedback and undo.
 *
 * Written during a 2026-07-20 quality pass over accounts, the first time these
 * flows were driven by hand. Every finding in that pass was a
 * call-site defect: a `*WithSnapshot` action whose snapshot was dropped, undo
 * entries pushed with no acknowledgement, and bare awaits that made failures
 * invisible. Component tests in `__tests__/unit/components/` pin the wiring;
 * this spec pins the part that only exists in a browser — that the toast
 * actually renders, its Undo actually reverses the write, and the reversal
 * survives a reload.
 *
 * The reload is the point. Optimistic UI lies; a balance that "went back" in
 * the DOM has proved nothing until the page has been re-fetched from SQLite.
 *
 * ## Running this
 *
 * With `CI=1`, `playwright.config.ts` seeds a throwaway temp DB from the same
 * `seed:dev` fixture and boots its own dev server against it — the safe way to
 * run this. Without `CI`, **this suite drives whatever `data/zero.db` is
 * currently mounted** — up to and including real financial data, if that's
 * what your dev DB holds. To run against your own dev server instead:
 *
 *     npm run db:slot status     # confirm the LIVE counts, not just the marker
 *     npm run db:slot seeded     # 4 accounts, ~450 transactions ending today
 *     # restart the dev server — it holds the old, now-unlinked file
 *
 * Then `E2E_BASE_URL=http://localhost:3001 npx playwright test accounts`.
 *
 * Fixture assumptions (seeded slot): a cash account named "Wallet" that opened
 * with a $180 starting balance inside the budget window, and a credit-card
 * account named "Visa Card" with a non-zero balance owed. Account
 * IDs are discovered at runtime from the sidebar rather than hardcoded, matching
 * the approach in `accessibility.spec.ts` — the UUIDs are regenerated whenever
 * the fixture is reseeded.
 *
 * Each test restores what it changed, so the suite is order-independent and
 * leaves the fixture as it found it.
 */

const TOAST = '[role="status"]';

/** Open an account by its sidebar link text and wait for the page header. */
async function openAccount(page: Page, name: string): Promise<void> {
  await page.goto("/budget");
  const link = page.locator(`aside a`, { hasText: name }).first();
  await link.click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

/**
 * The page-header kebab, not the sidebar one. Both carry the same aria-label,
 * and the sidebar copy is rendered on every route — scoping to `main` is what
 * makes this unambiguous. The Convert item only exists on this variant.
 */
function headerMenu(page: Page, accountName: string) {
  return page.locator("main").getByRole("button", {
    name: `Options for ${accountName}`,
  });
}

test.describe("accounts — mutation feedback", () => {
  test("adjusting a balance toasts, and its Undo restores the balance", async ({
    page,
  }) => {
    await openAccount(page, "Wallet");

    const header = page.locator("main").first();
    const before = await header.getByText(/^\$/).first().innerText();

    await headerMenu(page, "Wallet").click();
    await page.getByRole("menuitem", { name: "Adjust balance" }).click();

    const input = page.getByLabel("New balance");
    await expect(input).toBeVisible();

    // Derive the target from whatever is currently in the field rather than
    // hardcoding one. A fixed value silently turns this test into a no-op if
    // the balance already happens to equal it: `willChange` goes false, the
    // button stays "Done", nothing is written, and the toast assertion below
    // fails for a reason that has nothing to do with the code under test.
    // (That is exactly how this spec first failed, against a fixture left
    // dirty by an earlier run.)
    const current = Number((await input.inputValue()).replace(/[^0-9.-]/g, ""));
    const target = (current + 10).toFixed(2);
    await input.fill(target);

    // The label switches from "Done" to "Adjust balance" only once the typed
    // value differs — a real regression surface, since a no-op save must not
    // write an adjustment transaction.
    await page.getByRole("button", { name: "Adjust balance" }).click();

    // F1: before this pass the snapshot was discarded entirely, so there was
    // no toast and no undo path of any kind.
    const toast = page.locator(TOAST).filter({ hasText: "Balance adjusted" });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Wallet");
    // No figure in the copy — it would be the one unmasked number on screen
    // in privacy mode.
    await expect(toast).not.toContainText("$");

    await expect(header).toContainText(
      `$${Number(target).toLocaleString("en-US", {
        minimumFractionDigits: 2,
      })}`
    );

    await toast.getByRole("button", { name: "Undo" }).click();

    // Reload before believing it. The DOM reverting proves nothing.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Wallet" })).toBeVisible();
    await expect(header.getByText(/^\$/).first()).toHaveText(before);
  });

  test("paying a card names the source account and no amount", async ({
    page,
  }) => {
    await openAccount(page, "Visa Card");

    await page.getByRole("button", { name: /^Pay/ }).first().click();

    const payButton = page.getByRole("button", { name: /^Pay \$/ });
    await expect(payButton).toBeEnabled();
    await payButton.click();

    // F7: the undo entry already existed here; the toast did not. It names the
    // source account because that is the balance the user cannot see — the
    // card's own balance updates on screen.
    const toast = page.locator(TOAST).filter({ hasText: "Paid" });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Visa Card");
    await expect(toast).toContainText("from");
    // Privacy guard: a toast reading "Paid $1,240.00 to Chase" would defeat
    // hidden-amounts mode, which cannot mask text baked into a message string.
    await expect(toast).not.toContainText(/\d/);

    // Undo via the toolbar rather than the toast: the toast auto-dismisses
    // after six seconds and racing it makes this test flaky. Both routes reach
    // the same module-singleton stack.
    await page.getByRole("button", { name: "Undo" }).first().click();

    await page.reload();
    // Both legs of the transfer must be gone, not just the card's.
    await expect(
      page.getByRole("row").filter({ hasText: "Transfer from" }).filter({
        hasText: new Date().toISOString().slice(5, 7),
      })
    ).toHaveCount(0);
  });

  test("excluding a starting balance names the amount that moves, then toasts", async ({
    page,
  }) => {
    await openAccount(page, "Wallet");

    await headerMenu(page, "Wallet").click();
    await page.getByRole("menuitem", { name: /starting balance/ }).click();

    // The confirm copy names the starting-balance transaction's amount — the
    // number that actually moves. It once interpolated
    // `account.current_balance`, which drifts from it the moment the account
    // has activity. The fixture's Wallet opened with $180 inside the budget
    // window; its current balance is something else entirely.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Removes $180.00 from Ready to assign");

    await dialog.getByRole("button", { name: /starting balance/ }).click();

    // F2: this moves money into or out of Ready to assign — a number on
    // /budget — while nothing on this page changes. Without the toast the
    // click had no acknowledgement at all.
    const toast = page.locator(TOAST).filter({ hasText: "Ready to assign" });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Wallet");

    await toast.getByRole("button", { name: "Undo" }).click();

    // Restore the fixture: the menu item must read "Exclude" again once the
    // undo has landed.
    await page.reload();
    await headerMenu(page, "Wallet").click();
    await expect(
      page.getByRole("menuitem", { name: "Exclude starting balance" })
    ).toBeVisible();
  });
});
