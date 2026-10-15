import { getDb, DEFAULT_USER_ID } from "@/lib/db";
import { mapRows, roundCents } from "@/lib/db-utils";
import { getBudgetStartMonth } from "@/lib/app-settings";
import type {
  Account,
  Transaction,
  TrackedAsset,
  TrackedAssetHistory,
} from "@/lib/types";

/**
 * A single point on the net-worth chart series. `value` is the total net worth
 * at end-of-day on `date` (YYYY-MM-DD).
 */
export type NetWorthPoint = { date: string; value: number };

/**
 * Derive the net-worth time series live from `transactions` (for budget
 * accounts) + `tracked_asset_history` (for tracked assets). No snapshot table
 * is read or written — Phase 8 replaces the legacy monthly-snapshot model with
 * this read-time derivation (SCHEMA-DROP-SNAPSHOTS).
 *
 * SPEC Requirement 6 (08-SPEC.md). The chart line at any historical date is:
 *
 *   sum over non-archived accounts of (is_debt ? -|balance|: balance)
 *     + sum over non-archived tracked assets of step-current value
 *
 * where:
 *   - per-account "balance at end-of-day D" is computed by walking
 *     transactions DESC from `accounts.current_balance` (today) and subtracting
 *     each transaction's signed amount as we move backward in time;
 *   - per-asset "step-current value at D" is the value of the most recent
 *     `tracked_asset_history` row with `recorded_at <= D`.
 *
 * Returns a sorted, deduplicated array of points covering every event date in
 * `[from, to]` plus a trailing point at `to ?? today` with the current totals.
 *
 * The series is computed in two halves:
 *   1. `deriveSeries` — pure helper, no DB access, fully unit-testable.
 *   2. `getNetWorthSeries` — server-only wrapper that loads rows then calls
 *      `deriveSeries`.
 */
export async function getNetWorthSeries(range?: {
  from?: string;
  to?: string;
}): Promise<NetWorthPoint[]> {
  const db = getDb();
  const from = range?.from;
  const to = range?.to;

  const accountRows = db
    .prepare(
      "SELECT * FROM accounts WHERE user_id = ? AND archived = 0"
    )
    .all(DEFAULT_USER_ID) as Record<string, unknown>[];
  const accounts = mapRows<Account>(accountRows);

  const trackedAssetRows = db
    .prepare(
      "SELECT * FROM tracked_assets WHERE user_id = ? AND archived = 0"
    )
    .all(DEFAULT_USER_ID) as Record<string, unknown>[];
  const trackedAssets = mapRows<TrackedAsset>(trackedAssetRows);

  // Bounded transaction query when a range is provided; otherwise pull all.
  let transactions: Transaction[];
  if (from && to) {
    transactions = mapRows<Transaction>(
      db
        .prepare(
          "SELECT * FROM transactions WHERE user_id = ? AND date BETWEEN ? AND ?"
        )
        .all(DEFAULT_USER_ID, from, to) as Record<string, unknown>[]
    );
  } else if (from) {
    transactions = mapRows<Transaction>(
      db
        .prepare("SELECT * FROM transactions WHERE user_id = ? AND date >= ?")
        .all(DEFAULT_USER_ID, from) as Record<string, unknown>[]
    );
  } else if (to) {
    transactions = mapRows<Transaction>(
      db
        .prepare("SELECT * FROM transactions WHERE user_id = ? AND date <= ?")
        .all(DEFAULT_USER_ID, to) as Record<string, unknown>[]
    );
  } else {
    transactions = mapRows<Transaction>(
      db
        .prepare("SELECT * FROM transactions WHERE user_id = ?")
        .all(DEFAULT_USER_ID) as Record<string, unknown>[]
    );
  }

  // Pull history for non-archived assets only.
  let history: TrackedAssetHistory[] = [];
  if (trackedAssets.length > 0) {
    const placeholders = trackedAssets.map(() => "?").join(",");
    const historyRows = db
      .prepare(
        `SELECT * FROM tracked_asset_history WHERE asset_id IN (${placeholders})`
      )
      .all(...trackedAssets.map((a) => a.id)) as Record<string, unknown>[];
    history = mapRows<TrackedAssetHistory>(historyRows);
  }

  const budgetStartMonth = getBudgetStartMonth();

  return deriveSeries({
    accounts,
    trackedAssets,
    transactions,
    history,
    from,
    to,
    budgetStartMonth,
  });
}

// ---------------------------------------------------------------------------
// Pure helper — no DB access, fully unit-testable.
// ---------------------------------------------------------------------------

type DeriveArgs = {
  accounts: Account[];
  trackedAssets: TrackedAsset[];
  transactions: Transaction[];
  history: TrackedAssetHistory[];
  from?: string;
  to?: string;
  // Earliest month the back-walk should consider. Transactions dated before
  // this are historical-import noise (SEED-016 Phase 3/4) — they describe
  // money flows that happened long before Zero's account `current_balance`
  // values were initialized, so feeding them into the back-walk produces
  // fictional pre-cutoff balances (especially for credit cards via the
  // is_debt inversion). Pre-cutoff dates fall back to `current_balance` for
  // real accounts; tracked-asset history is untouched and continues to vary.
  budgetStartMonth?: string;
};

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function withinRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function deriveSeries(args: DeriveArgs): NetWorthPoint[] {
  const { accounts: rawAccounts, trackedAssets: rawAssets, history } = args;
  // 260517-vxf: tracking-only accounts (is_budget_account = 0) are INCLUDED
  // in the series. Net worth is a balance-sheet view; the tracking-only flag
  // is a Ready-to-Assign concern, not a net-worth one. The SELECT in
  // getNetWorthSeries filters only on `archived`, intentionally.
  const accounts = rawAccounts.filter((a) => !a.archived);
  const trackedAssets = rawAssets.filter((a) => !a.archived);
  const to = args.to ?? todayDateStr();

  // Drop pre-cutoff transactions before the back-walk (SEED-016 Phase 4.5).
  // Real accounts' current_balance reflects state at/after Zero's start;
  // historical-import transactions describe activity that never actually
  // moved those balances, so feeding them in produces fictional history.
  const cutoff = args.budgetStartMonth ?? "0000-01-01";
  const transactions = args.transactions.filter((t) => t.date >= cutoff);

  // Empty-data short-circuit.
  if (accounts.length === 0 && trackedAssets.length === 0) {
    return [];
  }

  // ── Per-account backward walk ─────────────────────────────────────────────
  //
  // For each account, we want a map { date → end-of-day balance on that date }.
  // We start from `current_balance` (representing the balance at end-of-`to`)
  // and walk transactions in DESC date order. End-of-day balance for date D is
  // the balance after applying all transactions dated <= D and before applying
  // any transactions dated > D — equivalently: the balance at the moment the
  // day rolls over to D+1.
  //
  // Algorithm: maintain `runningBalance[acctId]` = end-of-day balance for the
  // most recently processed date. As we step backward to an earlier txn,
  // subtract that txn's signed amount to compute the prior end-of-day balance.
  //
  // After we finish processing the LAST txn on a given date D, the
  // `runningBalance` reflects the balance at end-of-day for D-1 (i.e. before
  // any of D's transactions hit). To get end-of-day-D, we record the balance
  // BEFORE backing out D's txns — i.e. at the point we ENTER the next earlier
  // date, the previous `runningBalance` (just after this date's txns were
  // backed out) is end-of-day for the date BEFORE D.
  //
  // Concretely: sort txns DESC, group by date, then for each date group:
  //   - record `runningBalance[acctId]` = end-of-day balance for that date
  //     (BEFORE backing out this date's txns).
  //   - subtract every txn's amount in this date group from `runningBalance`.

  const accountIds = accounts.map((a) => a.id);
  const accountSet = new Set(accountIds);

  const runningBalance = new Map<string, number>();
  for (const a of accounts) runningBalance.set(a.id, Number(a.current_balance));

  // Map<accountId, Map<date, endOfDayBalance>>
  const balanceByAccountAndDate = new Map<string, Map<string, number>>();
  for (const id of accountIds) balanceByAccountAndDate.set(id, new Map());

  // Sort transactions DESC by (date, created_at) — same tiebreaker as the
  // account detail page so balance roll-back is deterministic.
  const sortedTxns = transactions
    .filter((t) => accountSet.has(t.account_id))
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.created_at < b.created_at ? 1 : -1;
    });

  // Group by date as we iterate.
  let i = 0;
  while (i < sortedTxns.length) {
    const currentDate = sortedTxns[i].date;

    // Record end-of-day balance for `currentDate` for every account that has
    // a balance entry (i.e. all of them — we want a snapshot per account).
    for (const acctId of accountIds) {
      const bal = runningBalance.get(acctId) ?? 0;
      balanceByAccountAndDate.get(acctId)!.set(currentDate, bal);
    }

    // Back out every txn dated `currentDate`.
    while (i < sortedTxns.length && sortedTxns[i].date === currentDate) {
      const t = sortedTxns[i];
      const prev = runningBalance.get(t.account_id) ?? 0;
      runningBalance.set(t.account_id, prev - Number(t.amount));
      i++;
    }
  }

  // After the walk, `runningBalance` holds each account's balance before its
  // earliest transaction — the opening balance for dates before any activity.
  const openingBalance = new Map(runningBalance);
  const txnDatesAsc = [...new Set(sortedTxns.map((t) => t.date))].sort();

  // End-of-day balance on any date, including dates with no transactions
  // (e.g. a tracked-asset update): carry forward the most recent transaction
  // date on or before it. Falling back to `current_balance` instead used to
  // spike the chart on every asset-only date.
  function accountBalanceAt(acctId: string, date: string): number {
    let lo = 0;
    let hi = txnDatesAsc.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (txnDatesAsc[mid] <= date) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found === -1) return openingBalance.get(acctId) ?? 0;
    return balanceByAccountAndDate.get(acctId)?.get(txnDatesAsc[found]) ?? 0;
  }

  // ── Per-tracked-asset step interpolation ──────────────────────────────────
  const historyByAsset = new Map<string, TrackedAssetHistory[]>();
  for (const ta of trackedAssets) historyByAsset.set(ta.id, []);
  for (const h of history) {
    const list = historyByAsset.get(h.asset_id);
    if (list) list.push(h);
  }
  // Sort each asset's history ASC by recorded_at (then created_at) so we can
  // do a binary-style lookup for "most recent entry <= D".
  for (const list of historyByAsset.values()) {
    list.sort((a, b) => {
      if (a.recorded_at !== b.recorded_at)
        return a.recorded_at < b.recorded_at ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    });
  }

  function assetValueAt(assetId: string, date: string): number {
    const list = historyByAsset.get(assetId);
    if (!list || list.length === 0) return 0;
    // Linear scan ASC; for the dataset sizes this app sees (manual entry only)
    // this is O(n*m) overall and inconsequential.
    let value = 0;
    for (const h of list) {
      if (h.recorded_at <= date) value = Number(h.value);
      else break;
    }
    return value;
  }

  // ── Collect event dates ────────────────────────────────────────────────────
  const eventDateSet = new Set<string>();
  for (const t of sortedTxns) eventDateSet.add(t.date);
  for (const h of history) eventDateSet.add(h.recorded_at);

  const eventDates = [...eventDateSet]
    .filter((d) => withinRange(d, args.from, to))
    .sort();

  // ── Emit one point per event date ─────────────────────────────────────────
  const points: NetWorthPoint[] = [];

  function totalAt(date: string): number {
    let total = 0;
    for (const acct of accounts) {
      const bal = accountBalanceAt(acct.id, date);
      total += acct.is_debt ? -Math.abs(bal) : bal;
    }
    for (const ta of trackedAssets) {
      total += assetValueAt(ta.id, date);
    }
    return total;
  }

  for (const date of eventDates) {
    points.push({ date, value: roundCents(totalAt(date)) });
  }

  // ── Trailing point at `to` using current totals ────────────────────────────
  let currentTotal = 0;
  for (const a of accounts) {
    currentTotal += a.is_debt ? -Math.abs(Number(a.current_balance)) : Number(a.current_balance);
  }
  for (const ta of trackedAssets) currentTotal += Number(ta.current_value);
  const trailing: NetWorthPoint = { date: to, value: roundCents(currentTotal) };

  if (points.length === 0) {
    points.push(trailing);
  } else if (points[points.length - 1].date !== trailing.date) {
    points.push(trailing);
  } else {
    // The trailing date matches an event date — overwrite with current totals
    // to ensure the last point is exactly today's totals.
    points[points.length - 1] = trailing;
  }

  return points;
}

// Exported under a __test_ prefix so unit tests can exercise the pure helper
// without needing a database. Not part of the public API — Wave 3+ consumers
// should call `getNetWorthSeries` only.
export const __test_deriveSeries = deriveSeries;

// ---------------------------------------------------------------------------
// Per-asset step interpolation helper (shared with the per-asset detail page).
//
// HIGH fix H2 (Plan 08-04): the per-asset chart on /assets/[id] MUST use the
// same step-interpolation rule as the insights hero chart so the two charts
// agree at every date. Both call this helper so step semantics live in a single
// source of truth.
//
// Rule: for each event date in [from, to], emit `{ date, value }` where value
// is the most recent history row's `value` with `recorded_at <= date`. If
// `from` predates the first history row, prepend either `{ from, 0 }` (no
// prior data) or `{ from, <carried-over value> }` (an earlier row exists).
// Always emit a trailing `{ to, currentValue }` so the chart ends at today's
// number.
// ---------------------------------------------------------------------------

export function stepInterpolateForAsset(
  history: TrackedAssetHistory[],
  currentValue: number,
  range?: { from?: string; to?: string }
): NetWorthPoint[] {
  const to = range?.to ?? todayDateStr();
  const from = range?.from;

  // Sort ASC by (recorded_at, created_at) — same tiebreaker as deriveSeries.
  const sorted = history.slice().sort((a, b) => {
    if (a.recorded_at !== b.recorded_at)
      return a.recorded_at < b.recorded_at ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });

  // No history → flat at currentValue from `from` (or today) through `to`.
  if (sorted.length === 0) {
    const v = roundCents(currentValue);
    return from && from !== to
      ? [
          { date: from, value: v },
          { date: to, value: v },
        ]
      : [{ date: to, value: v }];
  }

  const points: NetWorthPoint[] = [];

  // ── Leading synthetic point ───────────────────────────────────────────────
  if (from) {
    if (from < sorted[0].recorded_at) {
      // The asset's first history row is AFTER `from`. No prior value exists,
      // so the leading segment is flat at 0.
      points.push({ date: from, value: 0 });
    } else {
      // An earlier row exists; the leading segment carries that value forward.
      let carry = 0;
      for (const h of sorted) {
        if (h.recorded_at <= from) carry = Number(h.value);
        else break;
      }
      points.push({ date: from, value: roundCents(carry) });
    }
  }

  // ── One point per history row within [from, to] ───────────────────────────
  for (const h of sorted) {
    if (from && h.recorded_at < from) continue;
    if (h.recorded_at > to) break;
    // Suppress duplicate at the synthetic `from` boundary.
    if (
      points.length > 0 &&
      points[points.length - 1].date === h.recorded_at
    ) {
      points[points.length - 1] = {
        date: h.recorded_at,
        value: roundCents(Number(h.value)),
      };
      continue;
    }
    points.push({ date: h.recorded_at, value: roundCents(Number(h.value)) });
  }

  // ── Trailing point at `to` ────────────────────────────────────────────────
  if (points.length === 0 || points[points.length - 1].date !== to) {
    points.push({ date: to, value: roundCents(currentValue) });
  } else {
    // Trailing date already matches — overwrite with currentValue so the last
    // point reflects today's number (e.g. when the most-recent history row IS
    // dated `to`, but currentValue is the source of truth for "today").
    points[points.length - 1] = { date: to, value: roundCents(currentValue) };
  }

  return points;
}
