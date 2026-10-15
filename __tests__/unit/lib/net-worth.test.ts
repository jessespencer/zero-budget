import { describe, it, expect } from "vitest";
import { computeNetWorth } from "@/lib/net-worth";
import type { Account, TrackedAsset, AccountType, TrackedAssetType } from "@/lib/types";

// ── Local fixture builders (inline; leaf types — no shared factory needed) ──

const ts = () => "2026-05-15T00:00:00.000Z";

function acct(overrides: Partial<Account> & { type?: AccountType } = {}): Account {
  return {
    id: overrides.id ?? "a-" + Math.random().toString(36).slice(2, 10),
    user_id: "u",
    name: overrides.name ?? "Account",
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

function tracked(overrides: Partial<TrackedAsset> & { asset_type?: TrackedAssetType } = {}): TrackedAsset {
  return {
    id: overrides.id ?? "t-" + Math.random().toString(36).slice(2, 10),
    user_id: "u",
    name: overrides.name ?? "Asset",
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

describe("computeNetWorth", () => {
  it("returns zeroes for empty input", () => {
    const result = computeNetWorth({ accounts: [], trackedAssets: [] });
    expect(result.assets).toBe(0);
    expect(result.debt).toBe(0);
    expect(result.netWorth).toBe(0);
    expect(result.byType).toEqual({});
  });

  it("matches the SPEC Requirement 4 fixture (assets=203400, debt=500, netWorth=202900)", () => {
    // 3 accounts: checking $1000, credit card −$500 (is_debt), savings $2000.
    // 2 tracked assets: crypto $400, real estate $200,000.
    const accounts: Account[] = [
      acct({ id: "a1", type: "checking", current_balance: 1000, is_debt: false }),
      acct({ id: "a2", type: "credit_card", current_balance: -500, is_debt: true }),
      acct({ id: "a3", type: "savings", current_balance: 2000, is_debt: false }),
    ];
    const trackedAssets: TrackedAsset[] = [
      tracked({ id: "t1", asset_type: "crypto", current_value: 400 }),
      tracked({ id: "t2", asset_type: "real_estate", current_value: 200000 }),
    ];

    const result = computeNetWorth({ accounts, trackedAssets });

    expect(result.assets).toBe(203400);
    expect(result.debt).toBe(500);
    expect(result.netWorth).toBe(202900);
  });

  it("excludes archived accounts and archived tracked assets", () => {
    const accounts: Account[] = [
      acct({ id: "a1", type: "checking", current_balance: 1000, is_debt: false }),
      acct({ id: "a2", type: "savings", current_balance: 5000, is_debt: false, archived: true }),
    ];
    const trackedAssets: TrackedAsset[] = [
      tracked({ id: "t1", asset_type: "investment", current_value: 200 }),
      tracked({ id: "t2", asset_type: "vehicle", current_value: 30000, archived: true }),
    ];

    const result = computeNetWorth({ accounts, trackedAssets });

    // Only the un-archived rows count: 1000 + 200 = 1200.
    expect(result.assets).toBe(1200);
    expect(result.debt).toBe(0);
    expect(result.netWorth).toBe(1200);
    expect(result.byType).toEqual({ checking: 1000, investment: 200 });
  });

  it("debt accounts contribute Math.abs(balance) to debt, not assets", () => {
    const accounts: Account[] = [
      acct({ id: "a1", type: "credit_card", current_balance: -1234.56, is_debt: true }),
    ];
    const result = computeNetWorth({ accounts, trackedAssets: [] });
    expect(result.debt).toBe(1234.56);
    expect(result.assets).toBe(0);
    expect(result.netWorth).toBe(-1234.56);
    // Signed balance preserved in byType so the UI can render -$1,234.56 directly.
    expect(result.byType.credit_card).toBe(-1234.56);
  });

  it("byType keys are the account/asset type and sums match", () => {
    const accounts: Account[] = [
      acct({ id: "a1", type: "checking", current_balance: 1000, is_debt: false }),
      acct({ id: "a2", type: "checking", current_balance: 250, is_debt: false }),
      acct({ id: "a3", type: "credit_card", current_balance: -300, is_debt: true }),
    ];
    const trackedAssets: TrackedAsset[] = [
      tracked({ id: "t1", asset_type: "investment", current_value: 5000 }),
      tracked({ id: "t2", asset_type: "investment", current_value: 2500 }),
      tracked({ id: "t3", asset_type: "real_estate", current_value: 100000 }),
    ];

    const result = computeNetWorth({ accounts, trackedAssets });

    expect(result.byType.checking).toBe(1250);
    expect(result.byType.credit_card).toBe(-300);
    expect(result.byType.investment).toBe(7500);
    expect(result.byType.real_estate).toBe(100000);

    // Sanity: totals match the byType breakdown.
    expect(result.assets).toBe(1000 + 250 + 5000 + 2500 + 100000);
    expect(result.debt).toBe(300);
    expect(result.netWorth).toBe(108450);
  });
});
