import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

// ── Seed helpers (same shape as audit-pivot.test.ts) ──────────────────

function seedGroup(id: string, name: string, sortOrder = 0): string {
  db.prepare(
    `INSERT INTO category_groups (id, user_id, name, sort_order, is_income, is_system)
     VALUES (?, ?, ?, ?, 0, 0)`
  ).run(id, USER_ID, name, sortOrder);
  return id;
}

function seedCategory(id: string, groupId: string, name: string): string {
  db.prepare(
    `INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived)
     VALUES (?, ?, ?, ?, 0, 0)`
  ).run(id, USER_ID, groupId, name);
  return id;
}

function seedAccount(id: string, name = "Checking", type = "checking") {
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 0, 0, 0)`
  ).run(id, USER_ID, name, type);
  return id;
}

function seedTxn(
  id: string,
  date: string,
  amount: number,
  opts: { categoryId?: string | null; isSplitParent?: boolean; payee?: string } = {}
) {
  db.prepare(
    `INSERT INTO transactions
       (id, user_id, account_id, date, amount, category_id, payee,
        transfer_account_id, is_split_parent, is_envelope_movement)
     VALUES (?, ?, 'acct-1', ?, ?, ?, ?, NULL, ?, 0)`
  ).run(
    id,
    USER_ID,
    date,
    amount,
    opts.categoryId ?? null,
    opts.payee ?? null,
    opts.isSplitParent ? 1 : 0
  );
}

function seedSplit(id: string, parentId: string, categoryId: string, amount: number) {
  db.prepare(
    `INSERT INTO transaction_splits (id, parent_transaction_id, category_id, amount)
     VALUES (?, ?, ?, ?)`
  ).run(id, parentId, categoryId, amount);
}

async function calendar(year = 2026) {
  const { getSpendingCalendarData } = await import("@/app/(app)/insights/actions");
  return getSpendingCalendarData({ year });
}

async function seasonality() {
  const { getSeasonalityData } = await import("@/app/(app)/insights/actions");
  return getSeasonalityData({});
}

async function auditPivot() {
  const { getAuditPivotData } = await import("@/app/(app)/insights/actions");
  return getAuditPivotData({});
}

async function payeeTrends() {
  const { getPayeeSpendingTrends } = await import("@/app/(app)/insights/actions");
  return getPayeeSpendingTrends({});
}

function totalFor(
  data: Awaited<ReturnType<typeof calendar>>,
  date: string
): number | undefined {
  return data.days.find((d) => d.date === date)?.total;
}

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  seedAccount("acct-1");
  seedGroup("g-bills", "Bills");
  seedCategory("c-rent", "g-bills", "Rent");
  seedCategory("c-food", "g-bills", "Food");
});

afterEach(() => {
  clearTestDb();
  db.close();
});

describe("getSpendingCalendarData — split transactions", () => {
  /**
   * The regression this file exists for. A split transaction carries no
   * category on its parent row, so a bare `category_id IN (…)` over
   * `transactions` drops the whole day's money rather than miscategorising it —
   * the tile renders empty. Filed as item 1 of SEED-025, confirmed against the
   * dev DB on 2026-07-26 ($208 invisible across two days).
   */
  it("CAL-01: counts split children, not just categorised parents", async () => {
    seedTxn("t-split", "2026-03-04", -148, { isSplitParent: true });
    seedSplit("s1", "t-split", "c-rent", -100);
    seedSplit("s2", "t-split", "c-food", -48);

    const data = await calendar();

    expect(totalFor(data, "2026-03-04")).toBe(148);
  });

  it("CAL-02: a day with only split spend is not missing from the grid", async () => {
    seedTxn("t-split", "2026-05-08", -60, { isSplitParent: true });
    seedSplit("s1", "t-split", "c-food", -60);

    const data = await calendar();

    // Before the fix this day was absent entirely — an empty tile on a day
    // money was actually spent.
    expect(data.days.some((d) => d.date === "2026-05-08")).toBe(true);
    expect(totalFor(data, "2026-05-08")).toBe(60);
  });

  it("CAL-03: split and non-split spend on the same day sum together", async () => {
    seedTxn("t-plain", "2026-06-10", -25, { categoryId: "c-food" });
    seedTxn("t-split", "2026-06-10", -75, { isSplitParent: true });
    seedSplit("s1", "t-split", "c-rent", -75);

    const data = await calendar();

    expect(totalFor(data, "2026-06-10")).toBe(100);
  });

  it("CAL-04: the split parent's own amount is never double-counted", async () => {
    // The parent row carries the full -90 and the children carry the same money
    // again. Counting both would report 180 on a day that saw 90.
    seedTxn("t-split", "2026-07-22", -90, { isSplitParent: true });
    seedSplit("s1", "t-split", "c-rent", -50);
    seedSplit("s2", "t-split", "c-food", -40);

    const data = await calendar();

    expect(totalFor(data, "2026-07-22")).toBe(90);
  });

  it("CAL-05: maxDaily accounts for split-only days", async () => {
    seedTxn("t-plain", "2026-02-01", -30, { categoryId: "c-food" });
    seedTxn("t-split", "2026-02-02", -200, { isSplitParent: true });
    seedSplit("s1", "t-split", "c-rent", -200);

    const data = await calendar();

    // The heat ramp scales off maxDaily, so a missed split day also flattens
    // the colour scale for every other day of the year.
    expect(data.maxDaily).toBe(200);
  });

  it("CAL-06: weekday averages include split spend", async () => {
    // 2026-03-07 is a Saturday.
    seedTxn("t-split", "2026-03-07", -140, { isSplitParent: true });
    seedSplit("s1", "t-split", "c-food", -140);

    const data = await calendar();

    expect(data.weekdayAverages[6]).toBeGreaterThan(0);
  });
});

/**
 * Inflow days used to render as spending. The heat value came from
 * `Math.abs(daily net)`, so a refund, a reimbursement or an asset sale on a
 * given day showed up as that much money spent — across a long ledger, many
 * days of it, and the darkest tile of a year could be an inflow (a car sale,
 * say) which then calibrated the whole colour ramp.
 *
 * Resolved by summing outflows only, matching the Spending-breakdown donut.
 * Refunds therefore do NOT reduce a day's spend — that's the deliberate
 * trade-off, and CAL-08 pins it so nobody "fixes" it back to netting.
 */
describe("Insights reports — inflows are not spending", () => {
  it("CAL-07: a day that nets positive shows no spend at all", async () => {
    seedTxn("t-sale", "2026-09-14", 39000, { categoryId: "c-rent", payee: "Car sale" });
    seedTxn("t-spend", "2026-09-14", -120, { categoryId: "c-food" });

    const data = await calendar();

    // Only the -120 counts. Before the fix this tile read 38,880.
    expect(totalFor(data, "2026-09-14")).toBe(120);
  });

  it("CAL-08: a refund does not net against the same day's spend", async () => {
    seedTxn("t-buy", "2026-09-15", -60, { categoryId: "c-food" });
    seedTxn("t-refund", "2026-09-15", 50, { categoryId: "c-food" });

    const data = await calendar();

    // Deliberate: outflows only, so this reads 60 rather than the net 10.
    // Matches how the Spending-breakdown donut counts.
    expect(totalFor(data, "2026-09-15")).toBe(60);
  });

  it("CAL-09: an inflow no longer calibrates the colour ramp", async () => {
    seedTxn("t-sale", "2026-10-01", 39000, { categoryId: "c-rent", payee: "Car sale" });
    seedTxn("t-real", "2026-10-02", -250, { categoryId: "c-food" });

    const data = await calendar();

    // maxDaily drives the heat ramp. If the sale counted, every genuine
    // spending day would be washed out against a $39k scale.
    expect(data.maxDaily).toBe(250);
  });

  it("CAL-10: seasonality also ignores inflows", async () => {
    seedTxn("t-sale", "2026-11-03", 39000, { categoryId: "c-rent", payee: "Car sale" });
    seedTxn("t-spend", "2026-11-04", -80, { categoryId: "c-rent" });

    const data = await seasonality();
    const rent = data.rows.find((r) => r.categoryId === "c-rent");

    // Same `Math.abs`-on-a-net defect lived here; the row is a heat value too.
    expect(Math.abs(rent!.total)).toBe(80);
  });
});

/**
 * The calendar was the reported symptom, but every categorised-spend report on
 * the Insights page read `transactions` the same blind way. These lock the rest
 * of the family to the shared `CATEGORISED_SPEND` union so the page can't go
 * back to contradicting itself — one tab showing a day's money while the tab
 * beside it shows zero for the same categories.
 */
describe("Insights reports — split transactions, page-wide", () => {
  it("SPLIT-01: seasonality attributes split spend to its child categories", async () => {
    seedTxn("t-split", "2026-04-09", -90, { isSplitParent: true });
    seedSplit("s1", "t-split", "c-rent", -60);
    seedSplit("s2", "t-split", "c-food", -30);

    const data = await seasonality();
    const rent = data.rows.find((r) => r.categoryId === "c-rent");
    const food = data.rows.find((r) => r.categoryId === "c-food");

    // Both children appear; the money is split between them, not lost, and not
    // parked on the uncategorised parent.
    expect(rent).toBeDefined();
    expect(food).toBeDefined();
    expect(Math.abs(rent!.total)).toBe(60);
    expect(Math.abs(food!.total)).toBe(30);
  });

  it("SPLIT-02: the Category x Year audit pivot counts split children", async () => {
    seedTxn("t-plain", "2026-01-05", -10, { categoryId: "c-rent" });
    seedTxn("t-split", "2026-01-06", -70, { isSplitParent: true });
    seedSplit("s1", "t-split", "c-rent", -70);

    const data = await auditPivot();
    let rent: { total: number } | undefined;
    for (const g of data.groups) {
      for (const c of g.categories) if (c.rowKey === "c-rent") rent = c;
    }

    // -10 plain + -70 split. Before the fix this read -10.
    expect(rent!.total).toBe(-80);
  });

  it("SPLIT-03: payee trends keep the parent's payee on split money", async () => {
    seedTxn("t-split", "2026-02-11", -55, { isSplitParent: true, payee: "Costco" });
    seedSplit("s1", "t-split", "c-food", -55);

    const data = await payeeTrends();
    const costco = data.payees.find((p) => p.payee === "Costco");

    // The payee lives on the parent row, the money on the children — the union
    // has to carry the parent's payee down or this row never appears.
    expect(costco).toBeDefined();
    expect(Math.abs(costco!.total)).toBe(55);
  });

  it("SPLIT-04: no report double-counts the parent alongside its children", async () => {
    seedTxn("t-split", "2026-08-03", -120, { isSplitParent: true });
    seedSplit("s1", "t-split", "c-rent", -120);

    const cal = await calendar();
    const seas = await seasonality();
    const pivot = await auditPivot();

    let rentTotal = 0;
    for (const g of pivot.groups) {
      for (const c of g.categories) if (c.rowKey === "c-rent") rentTotal = c.total;
    }

    expect(totalFor(cal, "2026-08-03")).toBe(120);
    expect(Math.abs(seas.rows.find((r) => r.categoryId === "c-rent")!.total)).toBe(120);
    expect(rentTotal).toBe(-120);
  });
});
