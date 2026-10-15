import { roundCents } from "./db-utils";
import type { Account, TrackedAsset } from "./types";

/**
 * Result of `computeNetWorth`.
 *
 * - `assets` / `debt` / `netWorth` are rounded to cents (REAL money pattern).
 * - `byType` is keyed by `Account.type` for budget accounts and by
 *   `TrackedAsset.asset_type` for tracked assets. Values are signed so the UI
 *   can render a credit card group as e.g. `-500` directly. We intentionally
 *   DO NOT round `byType` — sums of doubles at two-decimal precision are safe
 *   for personal-finance amounts (IEEE 754 ~15-16 sig digits), and rounding
 *   each bucket would let buckets drift versus the (rounded) totals.
 */
export type NetWorthBreakdown = {
  assets: number;
  debt: number;
  netWorth: number;
  byType: Record<string, number>;
};

/**
 * Pure computation of net worth from accounts + tracked assets. No DB access,
 * no side effects. Mirrors the budget engine's input-struct → output-struct
 * pattern so it can be unit-tested without fixtures or a database.
 *
 * Rules (locked in 08-SPEC.md Requirement 4):
 *   - Archived rows (accounts + tracked assets) are excluded entirely.
 *   - `is_debt` accounts contribute `Math.abs(current_balance)` to `debt`.
 *     Non-debt accounts contribute `current_balance` to `assets`.
 *   - All non-archived tracked assets contribute `current_value` to `assets`.
 *   - `netWorth = assets - debt`, rounded to cents.
 *   - `byType` keeps signed balances so the UI can render credit_card as a
 *     negative bucket.
 */
export function computeNetWorth(input: {
  accounts: Account[];
  trackedAssets: TrackedAsset[];
}): NetWorthBreakdown {
  // 260517-vxf: tracking-only accounts (is_budget_account = 0) are INCLUDED
  // here. Net worth is a "what I own minus what I owe" view; the
  // tracking-only flag is a Ready-to-Assign concern, not a balance-sheet
  // concern. Do NOT add an is_budget_account filter — business checking,
  // brokerage and other off-budget accounts still represent real money the user holds.
  let assets = 0;
  let debt = 0;
  const byType: Record<string, number> = {};

  for (const acct of input.accounts) {
    if (acct.archived) continue;
    const balance = Number(acct.current_balance);
    if (acct.is_debt) {
      debt += Math.abs(balance);
    } else {
      assets += balance;
    }
    byType[acct.type] = (byType[acct.type] ?? 0) + balance;
  }

  for (const ta of input.trackedAssets) {
    if (ta.archived) continue;
    const value = Number(ta.current_value);
    assets += value;
    byType[ta.asset_type] = (byType[ta.asset_type] ?? 0) + value;
  }

  return {
    assets: roundCents(assets),
    debt: roundCents(debt),
    netWorth: roundCents(assets - debt),
    byType,
  };
}
