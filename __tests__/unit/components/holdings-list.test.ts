import { describe, it, expect } from "vitest";
import { __test_groupItems, GROUP_ORDER } from "@/components/net-worth/holdings-list-utils";
import type { Account, TrackedAsset } from "@/lib/types";

const ts = () => "2026-05-15T00:00:00.000Z";

function acct(overrides: Partial<Account>): Account {
  return {
    id: overrides.id ?? "a",
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

function tracked(
  overrides: Partial<TrackedAsset> & { lastRecordedAt?: string | null }
): TrackedAsset & { lastRecordedAt?: string | null } {
  return {
    id: overrides.id ?? "t",
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

describe("holdings-list — GROUP_ORDER constant", () => {
  it("declares the eight canonical groups in the SPEC requirement-7 order", () => {
    expect(GROUP_ORDER.map((g) => g.key)).toEqual([
      "cash",
      "credit_cards",
      "investments",
      "retirement",
      "real_estate",
      "crypto",
      "vehicles",
      "other",
    ]);
  });
});

describe("holdings-list — __test_groupItems", () => {
  it("returns empty when nothing in input", () => {
    const groups = __test_groupItems([], []);
    // Implementation returns the eight groups always; render layer hides empties.
    expect(groups.length).toBe(8);
    for (const g of groups) expect(g.items).toEqual([]);
  });

  it("places checking/savings/cash into the Cash and checking group", () => {
    const groups = __test_groupItems(
      [
        acct({ id: "a1", type: "checking", current_balance: 100, name: "Chase" }),
        acct({ id: "a2", type: "savings", current_balance: 500, name: "Ally" }),
        acct({ id: "a3", type: "cash", current_balance: 25, name: "Wallet" }),
      ],
      []
    );
    const cash = groups.find((g) => g.key === "cash")!;
    // Alphabetical by name: Ally (a2), Chase (a1), Wallet (a3).
    expect(cash.items.map((i) => i.id)).toEqual(["a2", "a1", "a3"]);
    expect(cash.total).toBe(625);
  });

  it("credit cards go into Credit cards with signed balances", () => {
    const groups = __test_groupItems(
      [acct({ id: "cc", type: "credit_card", current_balance: -200, is_debt: true })],
      []
    );
    const cc = groups.find((g) => g.key === "credit_cards")!;
    expect(cc.items[0].balance).toBe(-200);
  });

  it("investments group sources from tracked assets", () => {
    const groups = __test_groupItems(
      [],
      [tracked({ id: "inv-t", asset_type: "investment", current_value: 500, lastRecordedAt: "2026-05-10" })]
    );
    const inv = groups.find((g) => g.key === "investments")!;
    expect(inv.items.map((i) => i.id)).toEqual(["inv-t"]);
    expect(inv.total).toBe(500);
  });

  it("retirement/real_estate/crypto/vehicles/other route to correct groups", () => {
    const groups = __test_groupItems(
      [acct({ id: "cr-a", type: "other", current_balance: 1 })],
      [
        tracked({ id: "ret-t", asset_type: "retirement", current_value: 1 }),
        tracked({ id: "re-t", asset_type: "real_estate", current_value: 1 }),
        tracked({ id: "cr-t", asset_type: "crypto", current_value: 1 }),
        tracked({ id: "veh-t", asset_type: "vehicle", current_value: 1 }),
        tracked({ id: "oth-t", asset_type: "other", current_value: 1 }),
      ]
    );
    expect(groups.find((g) => g.key === "retirement")!.items.length).toBe(1);
    expect(groups.find((g) => g.key === "real_estate")!.items.length).toBe(1);
    expect(groups.find((g) => g.key === "crypto")!.items.length).toBe(1);
    expect(groups.find((g) => g.key === "vehicles")!.items.length).toBe(1);
    expect(groups.find((g) => g.key === "other")!.items.length).toBe(2);
  });

  it("tracked-asset rows expose lastUpdatedDays from lastRecordedAt", () => {
    const today = new Date().toISOString().slice(0, 10);
    const tenDaysAgo = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 10);
      return d.toISOString().slice(0, 10);
    })();
    const groups = __test_groupItems(
      [],
      [
        tracked({
          id: "t1",
          asset_type: "investment",
          current_value: 1,
          lastRecordedAt: tenDaysAgo,
        }),
        tracked({ id: "t2", asset_type: "investment", current_value: 1, lastRecordedAt: today }),
        tracked({ id: "t3", asset_type: "investment", current_value: 1, lastRecordedAt: null }),
      ]
    );
    const inv = groups.find((g) => g.key === "investments")!;
    const byId = new Map(inv.items.map((i) => [i.id, i]));
    expect(byId.get("t1")!.lastUpdatedDays).toBe(10);
    expect(byId.get("t2")!.lastUpdatedDays).toBe(0);
    expect(byId.get("t3")!.lastUpdatedDays).toBe(null);
  });

  it("budget-account rows do not expose lastUpdatedDays", () => {
    const groups = __test_groupItems(
      [acct({ id: "a1", type: "checking", current_balance: 100 })],
      []
    );
    const cash = groups.find((g) => g.key === "cash")!;
    expect(cash.items[0].lastUpdatedDays).toBe(undefined);
    expect(cash.items[0].kind).toBe("account");
  });

  it("tracked-asset hrefs point to /assets/[id]", () => {
    const groups = __test_groupItems(
      [],
      [tracked({ id: "t1", asset_type: "investment", current_value: 1 })]
    );
    const inv = groups.find((g) => g.key === "investments")!;
    const byId = new Map(inv.items.map((i) => [i.id, i]));
    expect(byId.get("t1")!.href).toBe("/assets/t1");
  });

  it("excludes archived rows", () => {
    const groups = __test_groupItems(
      [
        acct({ id: "active", type: "checking", current_balance: 100 }),
        acct({ id: "gone", type: "checking", current_balance: 50, archived: true }),
      ],
      [
        tracked({ id: "t-active", asset_type: "investment", current_value: 1 }),
        tracked({ id: "t-gone", asset_type: "investment", current_value: 1, archived: true }),
      ]
    );
    const cash = groups.find((g) => g.key === "cash")!;
    const inv = groups.find((g) => g.key === "investments")!;
    expect(cash.items.map((i) => i.id)).toEqual(["active"]);
    expect(inv.items.map((i) => i.id)).toEqual(["t-active"]);
  });
});
