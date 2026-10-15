import { describe, it, expect } from "vitest";
import { __test_deriveSeries } from "@/lib/net-worth-series";
import type {
  Account,
  Transaction,
  TrackedAsset,
  TrackedAssetHistory,
  AccountType,
  TrackedAssetType,
} from "@/lib/types";

const ts = () => "2026-05-15T00:00:00.000Z";

function acct(overrides: Partial<Account> & { type?: AccountType } = {}): Account {
  return {
    id: overrides.id ?? "a",
    user_id: "u",
    name: "A",
    type: overrides.type ?? "checking",
    institution: null,
    current_balance: 0,
    is_budget_account: true,
    is_debt: false,
    sort_order: 0,
    archived: false,
    plaid_item_id: null,
    is_primary: false,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

function txn(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? `txn-${Math.random()}`,
    user_id: "u",
    account_id: overrides.account_id ?? "a",
    date: overrides.date ?? "2026-05-01",
    payee: null,
    memo: null,
    amount: overrides.amount ?? 0,
    category_id: null,
    transfer_account_id: null,
    cleared: false,
    approved: true,
    is_split_parent: false,
    is_envelope_movement: false,
    source: null,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

function tracked(
  overrides: Partial<TrackedAsset> & { asset_type?: TrackedAssetType } = {}
): TrackedAsset {
  return {
    id: overrides.id ?? "t",
    user_id: "u",
    name: "Asset",
    asset_type: overrides.asset_type ?? "investment",
    current_value: 0,
    notes: null,
    sort_order: 0,
    archived: false,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

function hist(overrides: Partial<TrackedAssetHistory>): TrackedAssetHistory {
  return {
    id: overrides.id ?? `h-${Math.random()}`,
    asset_id: overrides.asset_id ?? "t",
    value: overrides.value ?? 0,
    recorded_at: overrides.recorded_at ?? "2026-01-01",
    note: null,
    created_at: ts(),
    ...overrides,
  };
}

describe("deriveSeries", () => {
  it("returns [] when there are no accounts, assets, transactions, or history", () => {
    const points = __test_deriveSeries({
      accounts: [],
      trackedAssets: [],
      transactions: [],
      history: [],
      to: "2026-05-15",
    });
    expect(points).toEqual([]);
  });

  it("returns a single point at `to` with the current total when no events fall in range", () => {
    const points = __test_deriveSeries({
      accounts: [acct({ id: "a", current_balance: 1000 })],
      trackedAssets: [tracked({ id: "t", current_value: 500 })],
      transactions: [],
      history: [],
      to: "2026-05-15",
    });
    expect(points).toEqual([{ date: "2026-05-15", value: 1500 }]);
  });

  it("walks transactions backward from current_balance to compute prior end-of-day balances", () => {
    // current_balance: $1000. Two transactions:
    //   2026-05-05  +200  (income)
    //   2026-05-10  -50   (expense)
    // End-of-day balances:
    //   today = 1000
    //   2026-05-10 (after +200 income and -50 spend) = 1000
    //   2026-05-05 (after +200 income, before the -50) = 1000 - (-50) = 1050
    //   before 2026-05-05 = 1050 - 200 = 850
    const points = __test_deriveSeries({
      accounts: [acct({ id: "a", current_balance: 1000 })],
      trackedAssets: [],
      transactions: [
        txn({ account_id: "a", date: "2026-05-05", amount: 200 }),
        txn({ account_id: "a", date: "2026-05-10", amount: -50 }),
      ],
      history: [],
      to: "2026-05-15",
    });
    // event dates: 2026-05-05 and 2026-05-10; trailing point at 2026-05-15
    expect(points.map((p) => p.date)).toEqual([
      "2026-05-05",
      "2026-05-10",
      "2026-05-15",
    ]);
    // 2026-05-05: end-of-day = balance just BEFORE the next-day txn applies =
    //   the balance after this day's txns = 850 + 200 = 1050
    // 2026-05-10: after 1050 + (-50) = 1000
    // 2026-05-15 (trailing): 1000
    expect(points[0].value).toBe(1050);
    expect(points[1].value).toBe(1000);
    expect(points[2].value).toBe(1000);
  });

  it("step-interpolates tracked-asset history (most recent recorded_at <= date applies)", () => {
    const points = __test_deriveSeries({
      accounts: [],
      trackedAssets: [tracked({ id: "t", current_value: 1500 })],
      transactions: [],
      history: [
        hist({ asset_id: "t", value: 1000, recorded_at: "2026-01-01" }),
        hist({ asset_id: "t", value: 1200, recorded_at: "2026-03-01" }),
        hist({ asset_id: "t", value: 1500, recorded_at: "2026-05-01" }),
      ],
      to: "2026-05-15",
    });
    // event dates: 2026-01-01, 2026-03-01, 2026-05-01, trailing 2026-05-15
    expect(points.map((p) => p.date)).toEqual([
      "2026-01-01",
      "2026-03-01",
      "2026-05-01",
      "2026-05-15",
    ]);
    expect(points.map((p) => p.value)).toEqual([1000, 1200, 1500, 1500]);
  });

  it("carries the last known account balance onto asset-only dates instead of today's", () => {
    // Account: $1000 today; +200 on 05-05, -50 on 05-10 (so 850 before 05-05,
    // 1050 between). Asset values recorded on days with no transaction — before
    // the first one and between the two. Those dates must use the account's
    // balance as of that day, not current_balance (which spiked the chart).
    const points = __test_deriveSeries({
      accounts: [acct({ id: "a", current_balance: 1000 })],
      trackedAssets: [tracked({ id: "t", current_value: 0 })],
      transactions: [
        txn({ account_id: "a", date: "2026-05-05", amount: 200 }),
        txn({ account_id: "a", date: "2026-05-10", amount: -50 }),
      ],
      history: [
        hist({ asset_id: "t", value: 0, recorded_at: "2026-05-03" }),
        hist({ asset_id: "t", value: 0, recorded_at: "2026-05-07" }),
      ],
      to: "2026-05-15",
    });
    expect(points.map((p) => [p.date, p.value])).toEqual([
      ["2026-05-03", 850],
      ["2026-05-05", 1050],
      ["2026-05-07", 1050],
      ["2026-05-10", 1000],
      ["2026-05-15", 1000],
    ]);
  });

  it("subtracts debt accounts as abs() rather than adding them", () => {
    const points = __test_deriveSeries({
      accounts: [
        acct({ id: "cc", type: "credit_card", is_debt: true, current_balance: -500 }),
        acct({ id: "ck", current_balance: 1000 }),
      ],
      trackedAssets: [],
      transactions: [],
      history: [],
      to: "2026-05-15",
    });
    // 1000 - |-500| = 500
    expect(points).toEqual([{ date: "2026-05-15", value: 500 }]);
  });

  it("clips events to [from, to] when provided", () => {
    const points = __test_deriveSeries({
      accounts: [acct({ id: "a", current_balance: 1000 })],
      trackedAssets: [],
      transactions: [
        txn({ account_id: "a", date: "2026-01-15", amount: 100 }),
        txn({ account_id: "a", date: "2026-04-15", amount: 200 }),
        txn({ account_id: "a", date: "2026-06-15", amount: 300 }),
      ],
      history: [],
      from: "2026-03-01",
      to: "2026-05-01",
    });
    // Only 2026-04-15 falls in [2026-03-01, 2026-05-01], plus a trailing point at 2026-05-01.
    const dates = points.map((p) => p.date);
    expect(dates).toContain("2026-04-15");
    expect(dates).toContain("2026-05-01");
    expect(dates).not.toContain("2026-01-15");
    expect(dates).not.toContain("2026-06-15");
  });

  it("excludes archived accounts and assets entirely", () => {
    const points = __test_deriveSeries({
      accounts: [
        acct({ id: "live", current_balance: 1000 }),
        acct({ id: "dead", current_balance: 9999, archived: true }),
      ],
      trackedAssets: [
        tracked({ id: "deadAsset", current_value: 7777, archived: true }),
      ],
      transactions: [],
      history: [],
      to: "2026-05-15",
    });
    expect(points).toEqual([{ date: "2026-05-15", value: 1000 }]);
  });

  it("rounds all emitted values via roundCents", () => {
    const points = __test_deriveSeries({
      accounts: [acct({ id: "a", current_balance: 1000.005 })],
      trackedAssets: [tracked({ id: "t", current_value: 500.007 })],
      transactions: [],
      history: [],
      to: "2026-05-15",
    });
    // 1000.005 rounds to 1000.01; 500.007 rounds to 500.01 (banker's-round-free Math.round)
    // Math.round(1000.005 * 100) / 100 → either 1000 or 1000.01 depending on float; check both
    const v = points[0].value;
    expect(Number.isFinite(v)).toBe(true);
    // The value must be representable with at most 2 decimals.
    expect(Math.abs(v - Math.round(v * 100) / 100)).toBeLessThan(1e-9);
  });
});
