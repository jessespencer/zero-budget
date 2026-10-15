import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { STARTING_BALANCE_CATEGORY_ID } from "@/lib/db-constants";

const USER_ID = "00000000-0000-0000-0000-000000000000";

let db: Database.Database;

// ── Seed helpers ─────────────────────────────────────────────────────

function seedGroup(
  id: string,
  name: string,
  { isIncome = false, sortOrder = 0 }: { isIncome?: boolean; sortOrder?: number } = {}
): string {
  db.prepare(
    `INSERT INTO category_groups (id, user_id, name, sort_order, is_income, is_system)
     VALUES (?, ?, ?, ?, ?, 0)`
  ).run(id, USER_ID, name, sortOrder, isIncome ? 1 : 0);
  return id;
}

function seedCategory(
  id: string,
  groupId: string,
  name: string,
  { archived = false, sortOrder = 0 }: { archived?: boolean; sortOrder?: number } = {}
): string {
  db.prepare(
    `INSERT INTO categories (id, user_id, category_group_id, name, sort_order, archived)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, USER_ID, groupId, name, sortOrder, archived ? 1 : 0);
  return id;
}

function seedAccount(id: string, name = "Checking", type = "checking") {
  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, current_balance, sort_order, archived)
     VALUES (?, ?, ?, ?, 0, 0, 0)`
  ).run(id, USER_ID, name, type);
  return id;
}

type TxnOpts = {
  categoryId?: string | null;
  isEnvelopeMovement?: boolean;
  transferAccountId?: string | null;
  isSplitParent?: boolean;
  accountId?: string;
};

function seedTxn(
  id: string,
  date: string,
  amount: number,
  opts: TxnOpts = {}
) {
  db.prepare(
    `INSERT INTO transactions
       (id, user_id, account_id, date, amount, category_id,
        transfer_account_id, is_split_parent, is_envelope_movement)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    USER_ID,
    opts.accountId ?? "acct-1",
    date,
    amount,
    opts.categoryId === undefined ? null : opts.categoryId,
    opts.transferAccountId ?? null,
    opts.isSplitParent ? 1 : 0,
    opts.isEnvelopeMovement ? 1 : 0
  );
}

async function pivot(filters: Parameters<
  typeof import("@/app/(app)/insights/actions")["getAuditPivotData"]
>[0] = {}) {
  const { getAuditPivotData } = await import("@/app/(app)/insights/actions");
  return getAuditPivotData(filters);
}

/** Flatten the zero pivot into a category-id → row lookup for assertions. */
function rowsByCategory(data: Awaited<ReturnType<typeof pivot>>) {
  const map = new Map<string, (typeof data.groups)[number]["categories"][number]>();
  for (const g of data.groups) {
    for (const c of g.categories) map.set(c.rowKey, c);
  }
  return map;
}

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  seedAccount("acct-1");
});

afterEach(() => {
  clearTestDb();
  db.close();
});

describe("getAuditPivotData — zero pivot correctness", () => {
  it("AUDIT-01: yearTotals and total equal signed SUM(amount) per (category, year)", async () => {
    seedGroup("g-bills", "Bills");
    seedCategory("c-rent", "g-bills", "Rent");
    seedTxn("t1", "2023-03-01", -100, { categoryId: "c-rent" });
    seedTxn("t2", "2024-07-01", -50, { categoryId: "c-rent" });

    const data = await pivot();
    const rent = rowsByCategory(data).get("c-rent");

    expect(rent).toBeDefined();
    expect(rent!.yearTotals[2023]).toBe(-100);
    expect(rent!.yearTotals[2024]).toBe(-50);
    expect(rent!.total).toBe(-150);

    // group subtotal mirrors the single category
    const group = data.groups.find((g) => g.groupKey === "g-bills");
    expect(group!.total).toBe(-150);
    expect(group!.yearTotals[2023]).toBe(-100);
  });

  it("AUDIT-01: excludes envelope-movement, transfer, income, and STARTING_BALANCE rows", async () => {
    seedGroup("g-bills", "Bills");
    seedGroup("g-income", "Income", { isIncome: true });
    seedCategory("c-rent", "g-bills", "Rent");
    seedCategory("c-paycheck", "g-income", "Paycheck");
    seedAccount("acct-savings", "Savings", "savings");

    // The one row that SHOULD count
    seedTxn("t-keep", "2023-01-01", -100, { categoryId: "c-rent" });
    // Excluded: envelope movement
    seedTxn("t-env", "2023-01-02", -999, {
      categoryId: "c-rent",
      isEnvelopeMovement: true,
    });
    // Excluded: transfer (non-null transfer_account_id)
    seedTxn("t-xfer", "2023-01-03", -888, {
      categoryId: "c-rent",
      transferAccountId: "acct-savings",
    });
    // Excluded: income group category
    seedTxn("t-inc", "2023-01-04", 5000, { categoryId: "c-paycheck" });
    // Excluded: STARTING_BALANCE category
    seedTxn("t-sb", "2023-01-05", 7777, {
      categoryId: STARTING_BALANCE_CATEGORY_ID,
    });

    const data = await pivot();
    const rent = rowsByCategory(data).get("c-rent");

    // Only the -100 row survives all exclusion clauses
    expect(rent!.total).toBe(-100);
    expect(rent!.yearTotals[2023]).toBe(-100);

    // The income group is not even a selectable group (is_income = 1)
    expect(data.allGroups.some((g) => g.key === "g-income")).toBe(false);
    expect(rowsByCategory(data).has("c-paycheck")).toBe(false);
  });

  it("AUDIT-01 split-parent regression (Pitfall 4): a split parent with NULL category contributes 0 to every cell", async () => {
    seedGroup("g-bills", "Bills");
    seedCategory("c-rent", "g-bills", "Rent");

    // Split parent carries NULL category_id; its children
    // carry the categories. The parent amount must never appear in any cell.
    seedTxn("t-parent", "2023-05-01", -300, {
      categoryId: null,
      isSplitParent: true,
    });
    // A child line, categorized
    seedTxn("t-child", "2023-05-01", -300, { categoryId: "c-rent" });

    const data = await pivot();
    const rent = rowsByCategory(data).get("c-rent");

    // Only the child's -300 is counted; the parent's -300 is excluded by the
    // category_id IS NOT NULL clause, so no double-count.
    expect(rent!.total).toBe(-300);
    expect(rent!.yearTotals[2023]).toBe(-300);

    // Assert the parent's amount never appears anywhere: every cell across the
    // pivot sums to exactly -300, not -600.
    let grandTotal = 0;
    for (const g of data.groups) grandTotal += g.total;
    expect(grandTotal).toBe(-300);
  });

  it("AUDIT-02: archived categories respect the includeArchived filter", async () => {
    seedGroup("g-bills", "Bills");
    seedCategory("c-active", "g-bills", "Active");
    seedCategory("c-old", "g-bills", "Old envelope", { archived: true });
    seedTxn("t-active", "2023-01-01", -10, { categoryId: "c-active" });
    seedTxn("t-old", "2023-01-01", -20, { categoryId: "c-old" });

    const withoutArchived = await pivot({ includeArchived: false });
    expect(rowsByCategory(withoutArchived).has("c-old")).toBe(false);
    expect(rowsByCategory(withoutArchived).has("c-active")).toBe(true);

    const withArchived = await pivot({ includeArchived: true });
    const old = rowsByCategory(withArchived).get("c-old");
    expect(old).toBeDefined();
    expect(old!.archived).toBe(true);
    expect(old!.total).toBe(-20);
  });

  it("AUDIT-01: years enumerate min→max date with no hard-coded range; single year yields one year", async () => {
    seedGroup("g-bills", "Bills");
    seedCategory("c-rent", "g-bills", "Rent");

    // Multi-year dataset enumerates every year in between, inclusive.
    seedTxn("t1", "2019-02-01", -10, { categoryId: "c-rent" });
    seedTxn("t2", "2022-11-01", -10, { categoryId: "c-rent" });
    const multi = await pivot();
    expect(multi.years).toEqual([2019, 2020, 2021, 2022]);

    // Single-year dataset yields exactly one year.
    db.prepare("DELETE FROM transactions").run();
    seedTxn("s1", "2021-04-01", -10, { categoryId: "c-rent" });
    const single = await pivot();
    expect(single.years).toEqual([2021]);
  });

  it("AUDIT-01: income-only years do not widen the year range (no empty columns)", async () => {
    seedGroup("g-bills", "Bills");
    seedCategory("c-rent", "g-bills", "Rent");
    seedGroup("g-inflow", "Inflow", { isIncome: true });
    seedCategory("c-paycheck", "g-inflow", "Paycheck");

    // Income arrives in 2015; expenses only span 2016-2017. The 2015 paychecks
    // must not produce a permanently empty 2015 column.
    seedTxn("i1", "2015-06-15", 2500, { categoryId: "c-paycheck" });
    seedTxn("e1", "2016-03-01", -10, { categoryId: "c-rent" });
    seedTxn("e2", "2017-08-01", -10, { categoryId: "c-rent" });

    const data = await pivot();
    expect(data.years).toEqual([2016, 2017]);
  });

  it("AUDIT-03: each zero-pivot row drill is { kind: 'zero', categoryId } with the seeded id", async () => {
    seedGroup("g-bills", "Bills");
    seedCategory("c-rent", "g-bills", "Rent");
    seedTxn("t1", "2023-01-01", -100, { categoryId: "c-rent" });

    const data = await pivot();
    const rent = rowsByCategory(data).get("c-rent");

    expect(rent!.drill).toEqual({ kind: "zero", categoryId: "c-rent" });
  });
});
