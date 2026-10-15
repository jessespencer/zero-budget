"use server";

import { getDb, DEFAULT_USER_ID, STARTING_BALANCE_CATEGORY_ID } from "@/lib/db";
import { mapRows } from "@/lib/db-utils";
import { getMonthKey } from "@/lib/format";
import {
  getArchivedTrackedAssets,
  getTrackedAssets,
} from "@/app/(app)/assets/actions";
import { getNetWorthSeries, type NetWorthPoint } from "@/lib/net-worth-series";
import { getBudgetStartMonth } from "@/lib/app-settings";
import type { Account, TrackedAsset } from "@/lib/types";

export type SpendingItem = {
  name: string;
  amount: number;
  percent: number;
  // The two fields below are present only on the synthesized "Everything else"
  // row produced by the top-8 bucket pass in `computeSpending` — they're
  // optional so existing callsites (legend, donut, stats) keep working
  // without changes.
  categoryNames?: string[]; // present on the bucket; lists every category it aggregates
  isBucket?: boolean;       // true on the "Everything else" row
};

export type SpendingData = {
  totalSpending: number;
  byCategory: SpendingItem[];
  byGroup: SpendingItem[];
  avgDaily: number;
  largestOutflow: { payee: string; amount: number } | null;
  mostFrequentCategory: { name: string; count: number } | null;
  // Per-category transaction rows, preloaded with the slice aggregates so the
  // drilldown modal can render synchronously on click. Keys are category names
  // ("Groceries", "Uncategorized", …) matching SpendingItem.name. The
  // "Everything else" bucket isn't a key here — the client concats the entries
  // for the categories in `SpendingItem.categoryNames[]` on the bucket row.
  transactionsByCategory: Record<string, SpendingTransaction[]>;
};

export async function getInsightsData(): Promise<{
  accounts: Account[];
  trackedAssets: TrackedAsset[];
  /** Archived assets, for the holdings list's Archived section. */
  archivedAssets: TrackedAsset[];
  trackedAssetLastUpdated: Record<string, string | null>;
  series: NetWorthPoint[];
}> {
  const db = getDb();

  const accounts = mapRows<Account>(
    db
      .prepare(
        "SELECT * FROM accounts WHERE user_id = ? AND archived = 0 ORDER BY sort_order"
      )
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );

  // Phase 8 (SCHEMA-DROP-SNAPSHOTS): the chart now derives its series live
  // from transactions + tracked_asset_history via lib/net-worth-series.ts —
  // no snapshot table is read here.
  const trackedAssets = await getTrackedAssets();
  // Separate list, deliberately — every reader below (net worth, the series,
  // the holdings grouping) assumes `trackedAssets` excludes archived rows.
  const archivedAssets = await getArchivedTrackedAssets();

  // Pull the full net-worth series; the client-side chart filters per
  // selected time-range tab (1M, 3M, 6M, 1Y, All).
  const series = await getNetWorthSeries();

  // Most-recent recorded_at per non-archived tracked asset — feeds the
  // "Last updated N days ago" subtext in the holdings list.
  const lastUpdatedRows = db
    .prepare(
      `SELECT asset_id, MAX(recorded_at) AS last
       FROM tracked_asset_history
       WHERE asset_id IN (
         SELECT id FROM tracked_assets WHERE user_id = ? AND archived = 0
       )
       GROUP BY asset_id`
    )
    .all(DEFAULT_USER_ID) as { asset_id: string; last: string | null }[];
  const trackedAssetLastUpdated: Record<string, string | null> = {};
  for (const ta of trackedAssets) trackedAssetLastUpdated[ta.id] = null;
  for (const row of lastUpdatedRows) {
    trackedAssetLastUpdated[row.asset_id] = row.last;
  }

  return {
    accounts,
    trackedAssets,
    archivedAssets,
    trackedAssetLastUpdated,
    series,
  };
}

/**
 * Spending breakdown for a single month. Defaults to the current month if
 * `monthKey` is missing or malformed (caller-friendly — page passes whatever
 * sits on the searchParam).
 */
export async function getSpendingData(monthKey?: string): Promise<{
  month: string;
  spending: SpendingData;
}> {
  const db = getDb();
  const month = monthKey && /^\d{4}-\d{2}-01$/.test(monthKey) ? monthKey : getMonthKey();

  const monthDate = new Date(month + "T00:00:00");
  const monthEnd = new Date(monthDate);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setDate(0);

  // Single full-row load powers both the slice aggregates AND the preloaded
  // drilldown map. Same loader as getCategoryTransactionsForMonth — donut
  // values and modal sums match by construction.
  const rows = loadMonthSpendingRows(month);

  // Bucket per category for the dialog. Empty buckets aren't materialized —
  // the dialog falls back to [] when reading a key that isn't present.
  const transactionsByCategory: Record<string, SpendingTransaction[]> = {};
  for (const r of rows) {
    (transactionsByCategory[r.categoryName] ??= []).push(r);
  }

  // Project to the slim shape computeSpending expects — it only needs the
  // four aggregate inputs (amount, category_id, payee, date). For
  // computeSpending's category_id we need to reverse-map from name; simpler
  // to project the original loaded rows alongside, but the resolveName step
  // already collapsed system categories into "Uncategorized" so we need the
  // original category_id back. Re-query the slim shape — cheap on SQLite.
  const categories = db
    .prepare("SELECT id, name, category_group_id FROM categories WHERE user_id = ?")
    .all(DEFAULT_USER_ID) as { id: string; name: string; category_group_id: string }[];
  const categoryGroups = db
    .prepare("SELECT id, name, is_system FROM category_groups WHERE user_id = ?")
    .all(DEFAULT_USER_ID) as { id: string; name: string; is_system: number }[];

  const monthEndStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;
  const slimTxns = db
    .prepare(
      `SELECT amount, category_id, payee, date FROM transactions
       WHERE user_id = ?
         AND date >= ? AND date <= ?
         AND amount < 0
         AND transfer_account_id IS NULL
         AND is_split_parent = 0
         AND is_envelope_movement = 0`
    )
    .all(DEFAULT_USER_ID, month, monthEndStr) as {
    amount: number;
    category_id: string | null;
    payee: string | null;
    date: string;
  }[];
  const slimSplits = db
    .prepare(
      `SELECT s.amount, s.category_id, p.payee, p.date
       FROM transaction_splits s
       JOIN transactions p ON p.id = s.parent_transaction_id
       WHERE p.user_id = ?
         AND p.date >= ? AND p.date <= ?
         AND p.transfer_account_id IS NULL
         AND p.is_envelope_movement = 0
         AND s.amount < 0`
    )
    .all(DEFAULT_USER_ID, month, monthEndStr) as {
    amount: number;
    category_id: string | null;
    payee: string | null;
    date: string;
  }[];

  const spending = computeSpending(
    [...slimTxns, ...slimSplits],
    categories,
    categoryGroups,
    monthDate,
    monthEnd
  );
  spending.transactionsByCategory = transactionsByCategory;

  return { month, spending };
}

export type SpendingTransaction = {
  id: string;
  date: string;
  payee: string | null;
  memo: string | null;
  amount: number;
  accountName: string;
  categoryName: string; // resolved server-side; "Uncategorized" for null
};

// Shared loader powering both `getSpendingData`'s preloaded
// `transactionsByCategory` map and `getCategoryTransactionsForMonth`'s
// filtered list. Single source of truth for the filter shape so the donut's
// slice values and the modal's row sums can't drift.
function loadMonthSpendingRows(monthKey: string): SpendingTransaction[] {
  const db = getDb();
  const monthDate = new Date(monthKey + "T00:00:00");
  const monthEnd = new Date(monthDate);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setDate(0);
  const monthEndStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;

  // Filter mirrors getSpendingData's outflow query exactly: outflows only,
  // no transfers, no split parents (drill into children), no envelope moves.
  const rawTxns = db
    .prepare(
      `SELECT t.id, t.date, t.payee, t.memo, t.amount, t.category_id,
              a.name AS account_name
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.user_id = ?
         AND t.date >= ? AND t.date <= ?
         AND t.amount < 0
         AND t.transfer_account_id IS NULL
         AND t.is_split_parent = 0
         AND t.is_envelope_movement = 0
       ORDER BY t.date DESC, t.amount ASC`
    )
    .all(DEFAULT_USER_ID, monthKey, monthEndStr) as {
    id: string;
    date: string;
    payee: string | null;
    memo: string | null;
    amount: number;
    category_id: string | null;
    account_name: string | null;
  }[];

  // Split children — parent's date sets the month, child's category is the
  // real categorization. Surface each child as its own row with parent's payee.
  const rawSplits = db
    .prepare(
      `SELECT s.id, p.date, p.payee, s.memo, s.amount, s.category_id,
              a.name AS account_name
       FROM transaction_splits s
       JOIN transactions p ON p.id = s.parent_transaction_id
       LEFT JOIN accounts a ON a.id = p.account_id
       WHERE p.user_id = ?
         AND p.date >= ? AND p.date <= ?
         AND p.transfer_account_id IS NULL
         AND p.is_envelope_movement = 0
         AND s.amount < 0`
    )
    .all(DEFAULT_USER_ID, monthKey, monthEndStr) as {
    id: string;
    date: string;
    payee: string | null;
    memo: string | null;
    amount: number;
    category_id: string | null;
    account_name: string | null;
  }[];

  const categories = db
    .prepare("SELECT id, name, category_group_id FROM categories WHERE user_id = ?")
    .all(DEFAULT_USER_ID) as { id: string; name: string; category_group_id: string }[];
  const categoryGroups = db
    .prepare("SELECT id, name, is_system FROM category_groups WHERE user_id = ?")
    .all(DEFAULT_USER_ID) as { id: string; name: string; is_system: number }[];

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const systemCategoryIds = new Set(
    categories
      .filter((c) =>
        categoryGroups.some((g) => g.id === c.category_group_id && g.is_system)
      )
      .map((c) => c.id)
  );

  const resolveName = (categoryId: string | null): string => {
    if (!categoryId) return "Uncategorized";
    if (systemCategoryIds.has(categoryId)) return "Uncategorized";
    return catMap.get(categoryId)?.name ?? "Uncategorized";
  };

  const rows: SpendingTransaction[] = [];
  for (const r of [...rawTxns, ...rawSplits]) {
    if (r.category_id && systemCategoryIds.has(r.category_id)) continue;
    rows.push({
      id: r.id,
      date: r.date,
      payee: r.payee,
      memo: r.memo,
      amount: r.amount,
      accountName: r.account_name ?? "—",
      categoryName: resolveName(r.category_id),
    });
  }

  // Concat above interleaves splits and parents — re-sort by date DESC, then
  // amount ASC (amounts are negative, so larger outflow sorts first per date).
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.amount - b.amount;
  });
  return rows;
}

/**
 * Per-month transaction list scoped to one (or many) category names. Powers
 * the spending-breakdown drilldown modal. Filter shape MUST match the donut
 * query in `getSpendingData` exactly — by construction the rows here sum to
 * the slice value on the chart. If a row appears in the modal, it counts on
 * the donut and vice versa.
 *
 * The literal string "Uncategorized" in `categoryNames` includes rows where
 * `category_id IS NULL` OR points to a category in a system group — matches
 * how `computeSpending` buckets them.
 */
/**
 * Per-month transaction list scoped to one (or many) category names. Kept as
 * a server action for the rare cases the preloaded `transactionsByCategory`
 * map isn't available (cross-tab snapshots, future external callers). The
 * insights's drilldown modal reads from the preload — it doesn't call this.
 */
export async function getCategoryTransactionsForMonth(
  categoryNames: string[],
  monthKey: string
): Promise<SpendingTransaction[]> {
  const month = /^\d{4}-\d{2}-01$/.test(monthKey) ? monthKey : getMonthKey();
  const wanted = new Set(categoryNames);
  return loadMonthSpendingRows(month).filter((r) => wanted.has(r.categoryName));
}

function computeSpending(
  transactions: { amount: number; category_id: string | null; payee: string | null; date: string }[],
  categories: { id: string; name: string; category_group_id: string }[],
  categoryGroups: { id: string; name: string; is_system: number }[],
  monthStart: Date,
  monthEnd: Date
): SpendingData {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const groupMap = new Map(categoryGroups.map((g) => [g.id, g]));

  const systemCategoryIds = new Set(
    categories
      .filter((c) =>
        categoryGroups.some((g) => g.id === c.category_group_id && g.is_system)
      )
      .map((c) => c.id)
  );

  // Drop transactions tied to system-driven categories (e.g. "Category not
  // needed", "Balance adjustment") so they don't distort the breakdown.
  // Null category_id stays — those are legitimate "Uncategorized" txns.
  const filteredTxns = transactions.filter(
    (t) => !(t.category_id && systemCategoryIds.has(t.category_id))
  );

  const totalSpending = filteredTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // By category
  const catTotals = new Map<string, number>();
  const catCounts = new Map<string, number>();
  for (const t of filteredTxns) {
    const name = t.category_id ? (catMap.get(t.category_id)?.name ?? "Uncategorized") : "Uncategorized";
    catTotals.set(name, (catTotals.get(name) ?? 0) + Math.abs(t.amount));
    catCounts.set(name, (catCounts.get(name) ?? 0) + 1);
  }
  const byCategorySorted: SpendingItem[] = [...catTotals.entries()]
    .map(([name, amount]) => ({
      name,
      amount,
      percent: totalSpending > 0 ? (amount / totalSpending) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Cap the donut at 8 individual slices + an "Everything else" bucket so the
  // chart stays legible when a month has 12-15 active categories. The bucket
  // itself drills into a multi-category transaction list. Skip the bucket on
  // degenerate cases — ≤8 categories, or a bucket so small (<2%) it would
  // just be visual noise.
  const TOP_N = 8;
  const BUCKET_MIN_PERCENT = 2;
  let byCategory: SpendingItem[];
  if (byCategorySorted.length <= TOP_N) {
    byCategory = byCategorySorted;
  } else {
    const top = byCategorySorted.slice(0, TOP_N);
    const rest = byCategorySorted.slice(TOP_N);
    const bucketAmount = rest.reduce((sum, r) => sum + r.amount, 0);
    const bucketPercent = totalSpending > 0 ? (bucketAmount / totalSpending) * 100 : 0;
    if (bucketPercent < BUCKET_MIN_PERCENT) {
      byCategory = byCategorySorted;
    } else {
      byCategory = [
        ...top,
        {
          name: "Everything else",
          amount: bucketAmount,
          percent: bucketPercent,
          categoryNames: rest.map((r) => r.name),
          isBucket: true,
        },
      ];
    }
  }

  // By group
  const groupTotals = new Map<string, number>();
  for (const t of filteredTxns) {
    const cat = t.category_id ? catMap.get(t.category_id) : null;
    const groupName = cat ? (groupMap.get(cat.category_group_id)?.name ?? "Uncategorized") : "Uncategorized";
    groupTotals.set(groupName, (groupTotals.get(groupName) ?? 0) + Math.abs(t.amount));
  }
  const byGroup: SpendingItem[] = [...groupTotals.entries()]
    .map(([name, amount]) => ({
      name,
      amount,
      percent: totalSpending > 0 ? (amount / totalSpending) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Days in month for average
  const daysInMonth = Math.ceil((monthEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const today = new Date();
  const daysElapsed = today < monthEnd
    ? Math.ceil((today.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
    : daysInMonth;
  const avgDaily = daysElapsed > 0 ? totalSpending / daysElapsed : 0;

  // Largest outflow
  let largestOutflow: { payee: string; amount: number } | null = null;
  for (const t of filteredTxns) {
    const abs = Math.abs(t.amount);
    if (!largestOutflow || abs > largestOutflow.amount) {
      largestOutflow = { payee: t.payee ?? "Unknown", amount: abs };
    }
  }

  // Most frequent category
  let mostFrequentCategory: { name: string; count: number } | null = null;
  for (const [name, count] of catCounts) {
    if (!mostFrequentCategory || count > mostFrequentCategory.count) {
      mostFrequentCategory = { name, count };
    }
  }

  return {
    totalSpending,
    byCategory,
    byGroup,
    avgDaily,
    largestOutflow,
    mostFrequentCategory,
    // Populated by getSpendingData after computeSpending returns —
    // computeSpending only has access to slim rows, not the full
    // SpendingTransaction shape the dialog needs.
    transactionsByCategory: {},
  };
}

// ─── Audit pivot (Phase 9 / SEED-017 Phase 1) ───────────────────────────────
// Category × Year forensic pivot over the full transaction history. Net
// spending per (category, year) — signed sum of transactions (outflows +
// refunds). Excludes envelope-movement rows, transfers, income groups, and
// the STARTING_BALANCE system category.
//
// pivotBy:
//   "zero"         — rows = Zero categories, grouped by Zero category_groups
//   "everydollar"  — rows = EveryDollar source_category, grouped by EveryDollar source_group
//   "ynab"         — rows = YNAB source_category, grouped by YNAB source_group
//
// Source pivots only include transactions where the matching import_source is
// set (i.e. historically-imported rows). Post-cutoff Zero-native transactions
// don't appear in source pivots — they had no "original" grouping.

export type AuditPivot = "zero" | "everydollar" | "ynab";

export type AuditDrill =
  | { kind: "zero"; categoryId: string }
  | { kind: "source"; importSource: "everydollar" | "ynab"; sourceCategory: string };

export type AuditCategoryRow = {
  rowKey: string;
  displayName: string;
  archived: boolean;
  drill: AuditDrill;
  yearTotals: Record<number, number>;
  total: number;
  // Running-balance trajectory aligned to `years`, for the Trend sparkline.
  // Present on the Tables (zero) pivots; absent on the dormant source pivots.
  balances?: number[];
};

export type AuditGroupRow = {
  groupKey: string;
  groupName: string;
  yearTotals: Record<number, number>;
  total: number;
  categories: AuditCategoryRow[];
  balances?: number[];
};

export type AuditPivotData = {
  pivotBy: AuditPivot;
  // Column keys. Year mode: calendar years. Month mode: month indices 0–11
  // (label via `columnLabels`). Named `years` for historical reasons.
  years: number[];
  groups: AuditGroupRow[];
  allGroups: { key: string; name: string }[];
  // Present in month mode: column key → short month label ("Jan"…), and the
  // calendar year the month columns belong to (for transaction drill ranges).
  columnLabels?: Record<number, string>;
  monthlyYear?: number;
};

export async function getAuditPivotData(filters: {
  pivotBy?: AuditPivot;
  groupKeys?: string[];
  includeArchived?: boolean;
}): Promise<AuditPivotData> {
  const pivotBy: AuditPivot = filters.pivotBy ?? "zero";
  if (pivotBy === "everydollar" || pivotBy === "ynab") {
    return getSourceAuditPivot(pivotBy, filters.groupKeys);
  }
  return getZeroAuditPivot(filters.groupKeys, filters.includeArchived ?? true);
}

type ZeroAuditCategory = {
  id: string;
  name: string;
  category_group_id: string;
  sort_order: number;
  archived: number;
};

// Shared category selection for the Zero pivot (audit grid + seasonality).
// Resolves the non-income, non-system groups, applies the group filter and the
// "Include hidden" toggle, and returns the categories to aggregate. Extracted
// so getZeroAuditPivot (year-level) and getSeasonalityData (month-level) select
// the exact same row set — they only differ in how they GROUP the transactions.
/**
 * Every categorised-spend row, split-aware — one row per (category, date,
 * payee, amount). Read from this instead of from `transactions` directly.
 *
 * A split transaction carries no category on its parent row; the categories
 * live on the children in `transaction_splits`. So the obvious
 * `SELECT … FROM transactions WHERE category_id IS NOT NULL` doesn't
 * miscategorise split spend, it **drops the money entirely** — the day, the
 * category and the payee all silently under-report. That was live on every
 * Insights report until 2026-07-26 (SEED-025 item 1).
 *
 * The first leg excludes split parents so their full amount isn't counted
 * alongside the children's, which would double the money instead of losing it.
 *
 * Two `user_id` binds, one per leg — pass `CATEGORISED_SPEND_PARAMS` first,
 * then your own. Callers add bucketing (`strftime`), the category filter and
 * any date range on the outside.
 */
const CATEGORISED_SPEND = `
  SELECT category_id, date, payee, amount
  FROM transactions
  WHERE user_id = ?
    AND is_envelope_movement = 0
    AND transfer_account_id IS NULL
    AND is_split_parent = 0
    AND category_id IS NOT NULL
  UNION ALL
  SELECT s.category_id, p.date, p.payee, s.amount
  FROM transaction_splits s
  JOIN transactions p ON p.id = s.parent_transaction_id
  WHERE p.user_id = ?
    AND p.is_envelope_movement = 0
    AND p.transfer_account_id IS NULL
    AND s.category_id IS NOT NULL
`;

/** Leading binds for {@link CATEGORISED_SPEND} — one `user_id` per leg. */
const CATEGORISED_SPEND_PARAMS = [DEFAULT_USER_ID, DEFAULT_USER_ID];

function selectZeroAuditCategories(
  db: ReturnType<typeof getDb>,
  groupKeys: string[] | undefined,
  includeArchived: boolean
): {
  allGroups: { key: string; name: string }[];
  selectedGroupIds: string[];
  categories: ZeroAuditCategory[];
} {
  const allGroupsRaw = db
    .prepare(
      `SELECT id, name FROM category_groups
       WHERE user_id = ? AND is_income = 0 AND is_system = 0
       ORDER BY sort_order, name COLLATE NOCASE`
    )
    .all(DEFAULT_USER_ID) as { id: string; name: string }[];
  const allGroups = allGroupsRaw.map((g) => ({ key: g.id, name: g.name }));

  const selectedGroupIds =
    groupKeys && groupKeys.length > 0
      ? groupKeys.filter((k) => allGroups.some((g) => g.key === k))
      : allGroups.map((g) => g.key);

  if (selectedGroupIds.length === 0) {
    return { allGroups, selectedGroupIds, categories: [] };
  }

  // "Archived" mirrors the budget page's hidden set: a category is hidden when
  // its own flag is set OR its parent group is hidden — hiding a group never
  // flips the children's flags (see hideGroup in budget/actions.ts).
  const archivedClause = includeArchived
    ? ""
    : "AND c.archived = 0 AND g.archived = 0";
  const groupPlaceholders = selectedGroupIds.map(() => "?").join(", ");
  const categories = db
    .prepare(
      `SELECT c.id, c.name, c.category_group_id, c.sort_order,
              MAX(c.archived, g.archived) AS archived
       FROM categories c
       JOIN category_groups g ON g.id = c.category_group_id
       WHERE c.user_id = ? AND c.category_group_id IN (${groupPlaceholders}) ${archivedClause}`
    )
    .all(DEFAULT_USER_ID, ...selectedGroupIds) as ZeroAuditCategory[];

  return { allGroups, selectedGroupIds, categories };
}

const MONTH_LABELS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Running-balance trajectory for the Tables "Trend" sparkline. Per category we
// accumulate post-cutoff net flow — monthly_budgets.assigned (funding in) plus
// signed transaction activity (incl. envelope movements, excl. transfers).
// Pre-cutoff (imported-history) flows are excluded: those balances were managed
// elsewhere and would otherwise drag the line negative. Mirrors the budget
// engine's post-cutoff stance and the savings tracker's `available` math,
// reduced to a per-column trajectory. This is a SHAPE (is the envelope filling
// up or churning?), not the exact budget-available figure — that lives on the
// budget page.
function computeBalanceSeries(
  db: ReturnType<typeof getDb>,
  categoryIds: string[],
  window: { mode: "year"; years: number[] } | { mode: "month"; year: number }
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  if (categoryIds.length === 0) return result;
  const cutoffStart = getBudgetStartMonth(); // "YYYY-MM-01"
  const idSet = new Set(categoryIds);

  // Net flow per (category, "YYYY-MM"), post-cutoff only.
  const flow = new Map<string, Map<string, number>>();
  const add = (catId: string, ym: string, amt: number) => {
    if (!idSet.has(catId)) return;
    let m = flow.get(catId);
    if (!m) {
      m = new Map();
      flow.set(catId, m);
    }
    m.set(ym, (m.get(ym) ?? 0) + amt);
  };

  const assignedRows = db
    .prepare(
      `SELECT category_id, substr(month, 1, 7) AS ym, SUM(assigned) AS amt
       FROM monthly_budgets
       WHERE user_id = ? AND month >= ?
       GROUP BY category_id, ym`
    )
    .all(DEFAULT_USER_ID, cutoffStart) as {
    category_id: string;
    ym: string;
    amt: number;
  }[];
  for (const r of assignedRows) add(r.category_id, r.ym, Number(r.amt));

  // Split-aware, like every other spend read in this file — but it can't use
  // `CATEGORISED_SPEND`, because this series deliberately *includes* envelope
  // movements (see the comment above) and the shared fragment filters them out.
  // Same two-leg shape, one filter short.
  const txnRows = db
    .prepare(
      `SELECT category_id, substr(date, 1, 7) AS ym, SUM(amount) AS amt FROM (
         SELECT category_id, date, amount
         FROM transactions
         WHERE user_id = ? AND date >= ? AND transfer_account_id IS NULL
           AND is_split_parent = 0
           AND category_id IS NOT NULL
         UNION ALL
         SELECT s.category_id, p.date, s.amount
         FROM transaction_splits s
         JOIN transactions p ON p.id = s.parent_transaction_id
         WHERE p.user_id = ? AND p.date >= ? AND p.transfer_account_id IS NULL
           AND s.category_id IS NOT NULL
       )
       WHERE category_id != ?
       GROUP BY category_id, ym`
    )
    .all(
      DEFAULT_USER_ID,
      cutoffStart,
      DEFAULT_USER_ID,
      cutoffStart,
      STARTING_BALANCE_CATEGORY_ID
    ) as {
    category_id: string;
    ym: string;
    amt: number;
  }[];
  for (const r of txnRows) add(r.category_id, r.ym, Number(r.amt));

  for (const catId of categoryIds) {
    const m = flow.get(catId) ?? new Map<string, number>();
    if (window.mode === "year") {
      let running = 0;
      result.set(
        catId,
        window.years.map((y) => {
          const prefix = String(y);
          let yearNet = 0;
          for (const [ym, amt] of m) if (ym.slice(0, 4) === prefix) yearNet += amt;
          running += yearNet;
          return running;
        })
      );
    } else {
      const yr = window.year;
      let running = 0;
      // Opening balance = everything that landed before this year (string
      // compare on "YYYY-MM" is chronological).
      for (const [ym, amt] of m) if (ym < `${yr}-01`) running += amt;
      result.set(
        catId,
        MONTH_LABELS_SHORT.map((_, i) => {
          running += m.get(`${yr}-${String(i + 1).padStart(2, "0")}`) ?? 0;
          return running;
        })
      );
    }
  }
  return result;
}

// Column-wise sum of member category balance series → the group's trajectory.
function sumBalanceSeries(series: number[][], width: number): number[] {
  const out = new Array(width).fill(0);
  for (const s of series) for (let i = 0; i < width; i++) out[i] += s[i] ?? 0;
  return out;
}

async function getZeroAuditPivot(
  groupKeys: string[] | undefined,
  includeArchived: boolean
): Promise<AuditPivotData> {
  const db = getDb();

  const { allGroups, selectedGroupIds, categories } = selectZeroAuditCategories(
    db,
    groupKeys,
    includeArchived
  );

  if (selectedGroupIds.length === 0) {
    return { pivotBy: "zero", years: [], groups: [], allGroups };
  }

  const years = enumerateYears(db);
  if (years.length === 0) {
    return { pivotBy: "zero", years: [], groups: [], allGroups };
  }

  if (categories.length === 0) {
    return { pivotBy: "zero", years, groups: [], allGroups };
  }

  const categoryIdSet = new Set(categories.map((c) => c.id));
  const rows = db
    .prepare(
      `SELECT category_id, strftime('%Y', date) AS year, SUM(amount) AS total
       FROM (${CATEGORISED_SPEND})
       WHERE category_id != ?
       GROUP BY category_id, year`
    )
    .all(...CATEGORISED_SPEND_PARAMS, STARTING_BALANCE_CATEGORY_ID) as {
    category_id: string;
    year: string;
    total: number;
  }[];

  const catTotals = new Map<string, { yearTotals: Record<number, number>; total: number }>();
  for (const row of rows) {
    if (!categoryIdSet.has(row.category_id)) continue;
    const yearNum = Number(row.year);
    const amount = Number(row.total);
    const existing = catTotals.get(row.category_id) ?? { yearTotals: {}, total: 0 };
    existing.yearTotals[yearNum] = (existing.yearTotals[yearNum] ?? 0) + amount;
    existing.total += amount;
    catTotals.set(row.category_id, existing);
  }

  const balanceMap = computeBalanceSeries(
    db,
    categories.map((c) => c.id),
    { mode: "year", years }
  );

  const groupMap = new Map<string, AuditGroupRow>();
  const groupMeta = new Map(allGroups.map((g) => [g.key, g]));

  for (const cat of categories) {
    const groupInfo = groupMeta.get(cat.category_group_id);
    if (!groupInfo) continue;
    const tot = catTotals.get(cat.id) ?? { yearTotals: {}, total: 0 };
    const balances = balanceMap.get(cat.id) ?? new Array(years.length).fill(0);
    // Keep an envelope if it has spending OR a non-zero balance trajectory, so
    // savings envelopes (funded but rarely spent) still surface — their cells
    // read "—" while the Trend sparkline climbs.
    const hasSpending = tot.total !== 0;
    const hasBalance = balances.some((b) => Math.abs(b) > 0.005);
    if (!hasSpending && !hasBalance) continue;

    const catRow: AuditCategoryRow = {
      rowKey: cat.id,
      displayName: cat.name,
      archived: cat.archived === 1,
      drill: { kind: "zero", categoryId: cat.id },
      yearTotals: tot.yearTotals,
      total: tot.total,
      balances,
    };

    const groupRow =
      groupMap.get(cat.category_group_id) ??
      ({
        groupKey: cat.category_group_id,
        groupName: groupInfo.name,
        yearTotals: {},
        total: 0,
        categories: [] as AuditCategoryRow[],
      } satisfies AuditGroupRow);

    for (const year of years) {
      const y = catRow.yearTotals[year] ?? 0;
      if (y !== 0) {
        groupRow.yearTotals[year] = (groupRow.yearTotals[year] ?? 0) + y;
      }
    }
    groupRow.total += catRow.total;
    groupRow.categories.push(catRow);
    groupMap.set(cat.category_group_id, groupRow);
  }

  const orderedGroups: AuditGroupRow[] = [];
  // Order categories to match the budget page (category sort_order). The
  // archive group has no curated order, so fall back to alphabetical there.
  const sortOrderMap = new Map(categories.map((c) => [c.id, c.sort_order]));
  for (const g of allGroups) {
    const row = groupMap.get(g.key);
    if (!row) continue;
    const isArchive = row.groupName === "(archive)";
    row.categories.sort((a, b) => {
      if (isArchive) return a.displayName.localeCompare(b.displayName);
      const oa = sortOrderMap.get(a.rowKey) ?? 0;
      const ob = sortOrderMap.get(b.rowKey) ?? 0;
      return oa - ob || a.displayName.localeCompare(b.displayName);
    });
    row.balances = sumBalanceSeries(
      row.categories.map((c) => c.balances ?? []),
      years.length
    );
    orderedGroups.push(row);
  }

  return { pivotBy: "zero", years, groups: orderedGroups, allGroups };
}

// Month-granular sibling of getZeroAuditPivot: same all-envelope category set
// and group rollups, but columns are the 12 months of `year`. Cells are net
// spending per month; the Trend sparkline shows the running balance climbing
// through the year. Powers the Tables tab's Month view.
async function getZeroMonthlyPivot(
  year: number,
  groupKeys: string[] | undefined,
  includeArchived: boolean
): Promise<AuditPivotData> {
  const db = getDb();

  const { allGroups, selectedGroupIds, categories } = selectZeroAuditCategories(
    db,
    groupKeys,
    includeArchived
  );

  const months = MONTH_LABELS_SHORT.map((_, i) => i);
  const columnLabels: Record<number, string> = Object.fromEntries(
    MONTH_LABELS_SHORT.map((label, i) => [i, label])
  );
  const base = { pivotBy: "zero" as const, allGroups, columnLabels, monthlyYear: year };

  if (selectedGroupIds.length === 0 || categories.length === 0) {
    return { ...base, years: months, groups: [] };
  }

  const categoryIdSet = new Set(categories.map((c) => c.id));
  const rows = db
    .prepare(
      `SELECT category_id, CAST(strftime('%m', date) AS INTEGER) - 1 AS m, SUM(amount) AS total
       FROM (${CATEGORISED_SPEND})
       WHERE category_id != ?
         AND date >= ? AND date <= ?
       GROUP BY category_id, m`
    )
    .all(
      ...CATEGORISED_SPEND_PARAMS,
      STARTING_BALANCE_CATEGORY_ID,
      `${year}-01-01`,
      `${year}-12-31`
    ) as { category_id: string; m: number; total: number }[];

  const catTotals = new Map<string, { yearTotals: Record<number, number>; total: number }>();
  for (const row of rows) {
    if (!categoryIdSet.has(row.category_id)) continue;
    const amount = Number(row.total);
    const existing = catTotals.get(row.category_id) ?? { yearTotals: {}, total: 0 };
    existing.yearTotals[row.m] = (existing.yearTotals[row.m] ?? 0) + amount;
    existing.total += amount;
    catTotals.set(row.category_id, existing);
  }

  const balanceMap = computeBalanceSeries(
    db,
    categories.map((c) => c.id),
    { mode: "month", year }
  );

  const groupMap = new Map<string, AuditGroupRow>();
  const groupMeta = new Map(allGroups.map((g) => [g.key, g]));

  for (const cat of categories) {
    const groupInfo = groupMeta.get(cat.category_group_id);
    if (!groupInfo) continue;
    const tot = catTotals.get(cat.id) ?? { yearTotals: {}, total: 0 };
    const balances = balanceMap.get(cat.id) ?? new Array(12).fill(0);
    const hasSpending = tot.total !== 0;
    const hasBalance = balances.some((b) => Math.abs(b) > 0.005);
    if (!hasSpending && !hasBalance) continue;

    const catRow: AuditCategoryRow = {
      rowKey: cat.id,
      displayName: cat.name,
      archived: cat.archived === 1,
      drill: { kind: "zero", categoryId: cat.id },
      yearTotals: tot.yearTotals,
      total: tot.total,
      balances,
    };

    const groupRow =
      groupMap.get(cat.category_group_id) ??
      ({
        groupKey: cat.category_group_id,
        groupName: groupInfo.name,
        yearTotals: {},
        total: 0,
        categories: [] as AuditCategoryRow[],
      } satisfies AuditGroupRow);

    for (const m of months) {
      const v = catRow.yearTotals[m] ?? 0;
      if (v !== 0) groupRow.yearTotals[m] = (groupRow.yearTotals[m] ?? 0) + v;
    }
    groupRow.total += catRow.total;
    groupRow.categories.push(catRow);
    groupMap.set(cat.category_group_id, groupRow);
  }

  const orderedGroups: AuditGroupRow[] = [];
  const sortOrderMap = new Map(categories.map((c) => [c.id, c.sort_order]));
  for (const g of allGroups) {
    const row = groupMap.get(g.key);
    if (!row) continue;
    const isArchive = row.groupName === "(archive)";
    row.categories.sort((a, b) => {
      if (isArchive) return a.displayName.localeCompare(b.displayName);
      const oa = sortOrderMap.get(a.rowKey) ?? 0;
      const ob = sortOrderMap.get(b.rowKey) ?? 0;
      return oa - ob || a.displayName.localeCompare(b.displayName);
    });
    row.balances = sumBalanceSeries(
      row.categories.map((c) => c.balances ?? []),
      months.length
    );
    orderedGroups.push(row);
  }

  return { ...base, years: months, groups: orderedGroups };
}

// Tables tab pivot — Month (12 months of `year`) or Year (decade) granularity.
export async function getTablesPivot(filters: {
  grain: "month" | "year";
  year: number;
  groupKeys?: string[];
  includeArchived?: boolean;
}): Promise<AuditPivotData> {
  const includeArchived = filters.includeArchived ?? true;
  return filters.grain === "year"
    ? getZeroAuditPivot(filters.groupKeys, includeArchived)
    : getZeroMonthlyPivot(filters.year, filters.groupKeys, includeArchived);
}

// ─── Payee spending trends (Trends tab — "By payee" toggle) ──────────────────
// Payee × year aggregation that mirrors getZeroAuditPivot's category × year
// shape, payee swapped for category_id. Same row set as the category pivot:
// identical group/archived selection (selectZeroAuditCategories) and identical
// transaction filters (no envelope movements, no transfers, no income/system
// groups, no STARTING_BALANCE). Scoped to the selected categories so "By payee"
// under a category chip shows payees *within* that category. The Trends tab
// renders either this or the category pivot depending on the section toggle.
//
// PROVISIONAL — payee strings are aggregated RAW: "AMAZON", "Amazon.com", and
// "AMZN Mktp" stay distinct rows, so a per-payee total under-counts a merchant
// that bills under several names. A future payee-normalization pass hooks in
// HERE (collapse the payee key before it enters `byPayee`); totals are
// approximate per real-world merchant until then.
export type PayeeTrendRow = {
  payee: string;
  yearTotals: Record<number, number>; // signed, like AuditCategoryRow.yearTotals
  total: number; // signed lifetime sum; client takes Math.abs (refunds net)
};

export type PayeeTrendsData = {
  years: number[];
  payees: PayeeTrendRow[]; // sorted desc by absolute lifetime total
};

export async function getPayeeSpendingTrends(filters: {
  groupKeys?: string[];
  includeArchived?: boolean;
}): Promise<PayeeTrendsData> {
  const db = getDb();

  const { selectedGroupIds, categories } = selectZeroAuditCategories(
    db,
    filters.groupKeys,
    filters.includeArchived ?? true
  );
  if (selectedGroupIds.length === 0 || categories.length === 0) {
    return { years: [], payees: [] };
  }

  const years = enumerateYears(db);
  if (years.length === 0) return { years: [], payees: [] };

  const categoryPlaceholders = categories.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT payee, strftime('%Y', date) AS year, SUM(amount) AS total
       FROM (${CATEGORISED_SPEND})
       WHERE category_id IN (${categoryPlaceholders})
         AND category_id != ?
         AND payee IS NOT NULL AND TRIM(payee) != ''
       GROUP BY payee, year`
    )
    .all(
      ...CATEGORISED_SPEND_PARAMS,
      ...categories.map((c) => c.id),
      STARTING_BALANCE_CATEGORY_ID
    ) as { payee: string; year: string; total: number }[];

  const byPayee = new Map<
    string,
    { yearTotals: Record<number, number>; total: number }
  >();
  for (const r of rows) {
    const amount = Number(r.total);
    if (amount === 0) continue;
    const yearNum = Number(r.year);
    const existing = byPayee.get(r.payee) ?? { yearTotals: {}, total: 0 };
    existing.yearTotals[yearNum] = (existing.yearTotals[yearNum] ?? 0) + amount;
    existing.total += amount;
    byPayee.set(r.payee, existing);
  }

  const payees: PayeeTrendRow[] = [];
  for (const [payee, agg] of byPayee) {
    if (agg.total === 0) continue;
    payees.push({ payee, yearTotals: agg.yearTotals, total: agg.total });
  }
  payees.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return { years, payees };
}

// ─── Seasonality (Trends tab, Milestone 2) ──────────────────────────────────
// Month-granular extension of the Zero audit aggregation. Same category
// selection and transaction filters as getZeroAuditPivot, but the SUM is
// grouped by (category, year, calendar-month) so each calendar month can be
// averaged across the years a category was active. Powers the "Seasonal
// patterns" heatmap. Income/transfer rows are already excluded by the shared
// filters (is_income groups never enter selectZeroAuditCategories; transfers
// and envelope movements are filtered in the WHERE clause).

export type SeasonalityCell = {
  avg: number; // average spend in this calendar month across active years
  perYear: { year: number; amount: number }[]; // nonzero years, most-recent first
};

export type SeasonalityRow = {
  categoryId: string;
  displayName: string;
  archived: boolean;
  months: SeasonalityCell[]; // length 12, index 0 = January
  rowMax: number; // largest monthly average — normalization denominator
  total: number; // lifetime absolute spend, for row ordering
};

export type SeasonalityData = {
  rows: SeasonalityRow[];
  allGroups: { key: string; name: string }[];
};

export async function getSeasonalityData(filters: {
  groupKeys?: string[];
  includeArchived?: boolean;
}): Promise<SeasonalityData> {
  const db = getDb();

  const { allGroups, selectedGroupIds, categories } = selectZeroAuditCategories(
    db,
    filters.groupKeys,
    filters.includeArchived ?? true
  );

  if (selectedGroupIds.length === 0 || categories.length === 0) {
    return { rows: [], allGroups };
  }

  const categoryIdSet = new Set(categories.map((c) => c.id));

  const rows = db
    .prepare(
      // Outflows only, for the same reason as the calendar above: this bucket
      // is read through `Math.abs` and presented as spend magnitude, so a
      // category-month that nets positive would render as heavy spending.
      // The Tables pivots deliberately keep signed sums — netting is correct
      // for an audit; it is only wrong where the number becomes a heat value.
      `SELECT category_id,
              strftime('%Y', date) AS year,
              strftime('%m', date) AS month,
              SUM(amount) AS total
       FROM (${CATEGORISED_SPEND})
       WHERE category_id != ?
         AND amount < 0
       GROUP BY category_id, year, month`
    )
    .all(...CATEGORISED_SPEND_PARAMS, STARTING_BALANCE_CATEGORY_ID) as {
    category_id: string;
    year: string;
    month: string;
    total: number;
  }[];

  // Per category: monthIndex → year → absolute spend, plus the set of years the
  // category had any activity (the average's denominator). Using one constant
  // denominator per row keeps each month's average proportional to its summed
  // spend, so per-row normalization renders the true seasonal shape.
  type Acc = {
    monthYear: Map<number, Map<number, number>>;
    activeYears: Set<number>;
    total: number;
  };
  const accByCat = new Map<string, Acc>();
  for (const r of rows) {
    if (!categoryIdSet.has(r.category_id)) continue;
    const amount = Math.abs(Number(r.total));
    if (amount === 0) continue;
    const monthIdx = Number(r.month) - 1;
    const yearNum = Number(r.year);
    const acc =
      accByCat.get(r.category_id) ??
      { monthYear: new Map(), activeYears: new Set<number>(), total: 0 };
    const ym = acc.monthYear.get(monthIdx) ?? new Map<number, number>();
    ym.set(yearNum, (ym.get(yearNum) ?? 0) + amount);
    acc.monthYear.set(monthIdx, ym);
    acc.activeYears.add(yearNum);
    acc.total += amount;
    accByCat.set(r.category_id, acc);
  }

  const result: SeasonalityRow[] = [];
  for (const cat of categories) {
    const acc = accByCat.get(cat.id);
    if (!acc || acc.total === 0) continue;
    const yearCount = acc.activeYears.size || 1;

    const months: SeasonalityCell[] = [];
    let rowMax = 0;
    for (let m = 0; m < 12; m++) {
      const ym = acc.monthYear.get(m);
      let sum = 0;
      const perYear: { year: number; amount: number }[] = [];
      if (ym) {
        for (const [year, amount] of ym) {
          sum += amount;
          perYear.push({ year, amount });
        }
        perYear.sort((a, b) => b.year - a.year);
      }
      const avg = sum / yearCount;
      if (avg > rowMax) rowMax = avg;
      months.push({ avg, perYear });
    }

    result.push({
      categoryId: cat.id,
      displayName: cat.name,
      archived: cat.archived === 1,
      months,
      rowMax,
      total: acc.total,
    });
  }

  // Order rows by lifetime total desc — same signal as the all-time bars, so
  // the two Trends sections read in a consistent order.
  result.sort((a, b) => b.total - a.total);

  return { rows: result, allGroups };
}

// ─── Spending calendar (Calendar tab) ───────────────────────────────────────
// Aggregate per-day outflow for a single year, GitHub-contribution-graph style.
// Same category selection + outflow filters as the audit/seasonality paths, but
// summed by calendar day (the `date` column is already a YYYY-MM-DD day string).
// Also rolls up a per-weekday average for the headline strip.

export type CalendarDay = { date: string; total: number }; // absolute spend; only days with spend

export type SpendingCalendarData = {
  year: number;
  days: CalendarDay[];
  maxDaily: number; // largest single-day total — calendar normalization denominator
  weekdayAverages: number[]; // length 7, index 0 = Sunday … 6 = Saturday
  allGroups: { key: string; name: string }[];
};

export async function getSpendingCalendarData(filters: {
  year: number;
  groupKeys?: string[];
  includeArchived?: boolean;
}): Promise<SpendingCalendarData> {
  const db = getDb();
  const { year } = filters;

  const { allGroups, selectedGroupIds, categories } = selectZeroAuditCategories(
    db,
    filters.groupKeys,
    filters.includeArchived ?? true
  );

  if (selectedGroupIds.length === 0 || categories.length === 0) {
    return { year, days: [], maxDaily: 0, weekdayAverages: new Array(7).fill(0), allGroups };
  }

  const categoryPlaceholders = categories.map(() => "?").join(", ");
  const rows = db
    .prepare(
      // `amount < 0` — outflows only, matching the Spending-breakdown donut
      // (`loadMonthSpendingRows`). Netting the day instead and taking the
      // absolute value, as this did until 2026-07-26, renders a day that nets
      // *positive* — a refund, a reimbursement, an asset sale — as that much
      // spending. Across a long ledger that adds up to many days of spend that
      // never happened, and the single darkest tile of a year can be an inflow
      // — a car sale, say — which then calibrates the whole year's colour ramp
      // and washes out every real spending day.
      `SELECT date, SUM(amount) AS total
       FROM (${CATEGORISED_SPEND})
       WHERE category_id IN (${categoryPlaceholders})
         AND category_id != ?
         AND amount < 0
         AND date >= ? AND date <= ?
       GROUP BY date`
    )
    .all(
      ...CATEGORISED_SPEND_PARAMS,
      ...categories.map((c) => c.id),
      STARTING_BALANCE_CATEGORY_ID,
      `${year}-01-01`,
      `${year}-12-31`
    ) as { date: string; total: number }[];

  const days: CalendarDay[] = [];
  const dailyByDate = new Map<string, number>();
  let maxDaily = 0;
  for (const r of rows) {
    const total = Math.abs(Number(r.total));
    if (total === 0) continue;
    days.push({ date: r.date, total });
    dailyByDate.set(r.date, total);
    if (total > maxDaily) maxDaily = total;
  }

  // Per-weekday average: sum of that weekday's spend ÷ number of that weekday in
  // the year (incl. zero-spend days), so it reads as "a typical Saturday".
  const weekdayTotals = new Array(7).fill(0);
  const weekdayCounts = new Array(7).fill(0);
  const cursor = new Date(`${year}-01-01T00:00:00`);
  while (cursor.getFullYear() === year) {
    const w = cursor.getDay(); // 0 = Sunday … 6 = Saturday
    weekdayCounts[w] += 1;
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    weekdayTotals[w] += dailyByDate.get(key) ?? 0;
    cursor.setDate(cursor.getDate() + 1);
  }
  const weekdayAverages = weekdayTotals.map((t, w) =>
    weekdayCounts[w] > 0 ? t / weekdayCounts[w] : 0
  );

  return { year, days, maxDaily, weekdayAverages, allGroups };
}

async function getSourceAuditPivot(
  pivotBy: "everydollar" | "ynab",
  groupKeys: string[] | undefined
): Promise<AuditPivotData> {
  const db = getDb();

  // Enumerate distinct (source_group, source_category) pairs for this source —
  // those are the rows the table will render. Filter out NULL keys (a few
  // imported rows lack one of the source fields).
  const pairs = db
    .prepare(
      `SELECT source_group, source_category,
              strftime('%Y', date) AS year, SUM(amount) AS total
       FROM transactions
       WHERE user_id = ?
         AND is_envelope_movement = 0
         AND transfer_account_id IS NULL
         AND import_source = ?
         AND source_group IS NOT NULL
         AND source_category IS NOT NULL
       GROUP BY source_group, source_category, year`
    )
    .all(DEFAULT_USER_ID, pivotBy) as {
    source_group: string;
    source_category: string;
    year: string;
    total: number;
  }[];

  const years = enumerateYears(db, pivotBy);
  const allGroupNames = Array.from(new Set(pairs.map((p) => p.source_group))).sort(
    (a, b) => a.localeCompare(b)
  );
  const allGroups = allGroupNames.map((name) => ({ key: name, name }));

  if (pairs.length === 0) {
    return { pivotBy, years, groups: [], allGroups };
  }

  const selectedGroupKeys =
    groupKeys && groupKeys.length > 0
      ? groupKeys.filter((k) => allGroupNames.includes(k))
      : allGroupNames;
  const selectedSet = new Set(selectedGroupKeys);

  // Build per (group, category) totals
  type SourceRowAcc = { yearTotals: Record<number, number>; total: number };
  const rowMap = new Map<string, SourceRowAcc>();
  for (const p of pairs) {
    if (!selectedSet.has(p.source_group)) continue;
    const key = `${p.source_group}::${p.source_category}`;
    const acc = rowMap.get(key) ?? { yearTotals: {}, total: 0 };
    const yr = Number(p.year);
    const amt = Number(p.total);
    acc.yearTotals[yr] = (acc.yearTotals[yr] ?? 0) + amt;
    acc.total += amt;
    rowMap.set(key, acc);
  }

  // Assemble group rows
  const groupMap = new Map<string, AuditGroupRow>();
  for (const [key, acc] of rowMap.entries()) {
    if (acc.total === 0) continue;
    const [sourceGroup, sourceCategory] = key.split("::");

    const catRow: AuditCategoryRow = {
      rowKey: key,
      displayName: sourceCategory,
      archived: false,
      drill: { kind: "source", importSource: pivotBy, sourceCategory },
      yearTotals: acc.yearTotals,
      total: acc.total,
    };

    const groupRow =
      groupMap.get(sourceGroup) ??
      ({
        groupKey: sourceGroup,
        groupName: sourceGroup,
        yearTotals: {},
        total: 0,
        categories: [] as AuditCategoryRow[],
      } satisfies AuditGroupRow);

    for (const yr of years) {
      const y = catRow.yearTotals[yr] ?? 0;
      if (y !== 0) groupRow.yearTotals[yr] = (groupRow.yearTotals[yr] ?? 0) + y;
    }
    groupRow.total += catRow.total;
    groupRow.categories.push(catRow);
    groupMap.set(sourceGroup, groupRow);
  }

  const orderedGroups: AuditGroupRow[] = [];
  for (const name of allGroupNames) {
    const row = groupMap.get(name);
    if (!row) continue;
    row.categories.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    orderedGroups.push(row);
  }

  return { pivotBy, years, groups: orderedGroups, allGroups };
}

function enumerateYears(
  db: ReturnType<typeof getDb>,
  importSource?: "everydollar" | "ynab"
): number[] {
  // Bound the columns by the same row set the pivot body aggregates —
  // otherwise income-only years (e.g. 2015, paychecks only) render as
  // permanently empty columns the audit can never fill.
  const yearBounds = (
    importSource
      ? db
          .prepare(
            `SELECT MIN(date) AS minDate, MAX(date) AS maxDate
             FROM transactions
             WHERE user_id = ? AND is_envelope_movement = 0 AND transfer_account_id IS NULL
               AND import_source = ? AND source_group IS NOT NULL AND source_category IS NOT NULL`
          )
          .get(DEFAULT_USER_ID, importSource)
      : db
          .prepare(
            // Reads the split-aware union so a year whose only spend is split
            // still gets a column. Joining `transactions.category_id` directly
            // would skip such a year entirely, and the pivots below would then
            // hold data with nowhere to render it.
            `SELECT MIN(t.date) AS minDate, MAX(t.date) AS maxDate
             FROM (${CATEGORISED_SPEND}) t
             JOIN categories c ON c.id = t.category_id
             JOIN category_groups g ON g.id = c.category_group_id
             WHERE g.is_income = 0 AND g.is_system = 0`
          )
          .get(...CATEGORISED_SPEND_PARAMS)
  ) as { minDate: string | null; maxDate: string | null };
  if (!yearBounds.minDate || !yearBounds.maxDate) return [];
  const minYear = Number(yearBounds.minDate.slice(0, 4));
  const maxYear = Number(yearBounds.maxDate.slice(0, 4));
  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);
  return years;
}
