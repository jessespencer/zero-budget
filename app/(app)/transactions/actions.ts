"use server";

import { getDb, DEFAULT_USER_ID, READY_TO_ASSIGN_CATEGORY_ID } from "@/lib/db";
import { newId, now, mapRows } from "@/lib/db-utils";
import { applyToBalance, applyPostingToBalance } from "@/lib/balance";
import { revalidatePath } from "next/cache";
import type {
  TransactionSource,
  TransactionSplitWithCategory,
  TransactionWithDetails,
} from "@/lib/types";
import { findBestPayeeMatch } from "@/lib/payee-match";
import { getMonthKey } from "@/lib/format";
import { getBudgetData } from "@/app/(app)/budget/actions";
import { computeBudgetMonth } from "@/lib/budget-engine";
import { transactionsToCsv } from "@/lib/csv-export";
import {
  createTransferPairWithSnapshot,
  type TransferPairSnapshot,
} from "@/app/(app)/transfer-plan/actions";

export type TransactionFilters = {
  accountId?: string;
  categoryId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  cleared?: boolean;
  approved?: boolean;
  importSource?: "everydollar" | "ynab";
  sourceGroup?: string;
  sourceCategory?: string;
  sortBy?: "date" | "account" | "payee" | "category" | "amount";
  sortDir?: "asc" | "desc";
};

// Strip currency formatting ($ and thousands commas) so pasted amounts like
// "$32.63" or "$1,234.56" match the raw numeric forms in the DB, then escape
// LIKE metacharacters.
function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[$,]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

// ---------------------------------------------------------------------------
// Transfer pair cascade — find the implicit sibling leg of a transfer.
//
// Transfer pairs (created via `insertTransferPair`) share three invariants:
//   - same `date`
//   - mirrored `amount` (one is +x, the other is -x)
//   - swapped account references (sibling.account_id === parent.transfer_account_id
//     and sibling.transfer_account_id === parent.account_id)
//   - same `created_at` timestamp (set in a single `db.transaction()` block)
//
// No `pair_id` column, no DB-level cascade between legs — pairing is implicit.
// This helper queries against that implicit shape using the PRE-mutation field
// values from the parent leg. Returns the closest-by-created_at match if more
// than one row matches (extremely unlikely given the four-tuple constraint).
//
// MUST NOT throw. A broken mirror (mismatched amount, missing sibling, manual
// edit that desynced the pair) yields `null` and the caller proceeds with the
// primary mutation only — silently. See task 260518-fqy.
// ---------------------------------------------------------------------------

type TransferSiblingRow = {
  id: string;
  account_id: string;
  amount: number;
  transfer_account_id: string | null;
  date: string;
  created_at: string;
  payee: string | null;
  // Carried so balance writes against the sibling can be approval-gated like
  // every other one (see lib/balance.ts). Transfer legs are created approved,
  // so this reads 1 today.
  approved: number;
};

function findTransferSibling(
  db: ReturnType<typeof getDb>,
  parent: {
    id: string;
    account_id: string;
    transfer_account_id: string | null;
    amount: number;
    date: string;
    created_at?: string;
  }
): TransferSiblingRow | null {
  if (parent.transfer_account_id === null) return null;

  const createdAtAnchor = parent.created_at ?? parent.date;

  const row = db
    .prepare(
      `SELECT id, account_id, amount, transfer_account_id, date, created_at, payee, approved
         FROM transactions
        WHERE user_id = ?
          AND id != ?
          AND account_id = ?
          AND transfer_account_id = ?
          AND date = ?
          AND amount = ?
        ORDER BY ABS(julianday(created_at) - julianday(?)) ASC, created_at ASC
        LIMIT 1`
    )
    .get(
      DEFAULT_USER_ID,
      parent.id,
      parent.transfer_account_id,
      parent.account_id,
      parent.date,
      -Number(parent.amount),
      createdAtAnchor
    ) as TransferSiblingRow | undefined;

  return row ?? null;
}

// Hard cap on rows returned per query. The table renders every row to the DOM
// (no virtualization), so this guards against the unfiltered ~16k-row view
// tanking the page. Sized to comfortably cover any realistic single-category
// filter (largest is ~2k) while keeping the DOM bounded.
const TRANSACTION_QUERY_LIMIT = 5000;

export async function getTransactions(
  filters: TransactionFilters = {}
): Promise<TransactionWithDetails[]> {
  const db = getDb();

  const conditions: string[] = ["t.user_id = ?"];
  const params: unknown[] = [DEFAULT_USER_ID];

  if (filters.accountId) {
    conditions.push("t.account_id = ?");
    params.push(filters.accountId);
  }
  // Category filter: for split parents, show the split's amount instead of the parent's full amount
  let splitUnionSql: string | null = null;
  const splitUnionParams: unknown[] = [];

  if (filters.categoryId) {
    if (filters.categoryId === "uncategorized") {
      // Transfers have category_id NULL too but are categorized by virtue of
      // being transfers — exclude them so the filter only surfaces rows
      // genuinely missing a category.
      conditions.push(
        "t.category_id IS NULL AND t.is_split_parent = 0 AND t.transfer_account_id IS NULL"
      );
    } else {
      // Direct category matches (non-split transactions)
      conditions.push("(t.category_id = ? AND t.is_split_parent = 0)");
      params.push(filters.categoryId);

      // Build a union query for split parents — returns parent fields but split amount
      const splitConditions: string[] = ["t.user_id = ?", "t.is_split_parent = 1", "ts.category_id = ?"];
      splitUnionParams.push(DEFAULT_USER_ID, filters.categoryId);

      if (filters.accountId) {
        splitConditions.push("t.account_id = ?");
        splitUnionParams.push(filters.accountId);
      }
      if (filters.startDate) {
        splitConditions.push("t.date >= ?");
        splitUnionParams.push(filters.startDate);
      }
      if (filters.endDate) {
        splitConditions.push("t.date <= ?");
        splitUnionParams.push(filters.endDate);
      }

      // NOTE: This column list must match `t.*` in baseSql for the UNION ALL
      // to type-check. Any new column added to the transactions table needs
      // a corresponding `t.<col>` entry below.
      splitUnionSql = `
        SELECT t.id, t.user_id, t.account_id, t.date, t.payee,
          ts.memo, ts.amount, ts.category_id, t.transfer_account_id,
          t.cleared, t.approved, t.is_split_parent,
          t.created_at, t.updated_at, t.schedule_id, t.source,
          t.is_envelope_movement,
          t.import_source, t.source_group, t.source_category,
          a.name AS account_name, c.name AS category_name, cg.name AS category_group_name
        FROM transactions t
        JOIN transaction_splits ts ON ts.parent_transaction_id = t.id
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = ts.category_id
        LEFT JOIN category_groups cg ON cg.id = c.category_group_id
        WHERE ${splitConditions.join(" AND ")}
      `;
    }
  }
  if (filters.startDate) {
    conditions.push("t.date >= ?");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push("t.date <= ?");
    params.push(filters.endDate);
  }
  if (filters.importSource) {
    conditions.push("t.import_source = ?");
    params.push(filters.importSource);
  }
  if (filters.sourceGroup) {
    conditions.push("t.source_group = ?");
    params.push(filters.sourceGroup);
  }
  if (filters.sourceCategory) {
    conditions.push("t.source_category = ?");
    params.push(filters.sourceCategory);
  }
  if (filters.cleared !== undefined) {
    conditions.push("t.cleared = ?");
    params.push(filters.cleared ? 1 : 0);
  }
  if (filters.approved !== undefined) {
    conditions.push("t.approved = ?");
    params.push(filters.approved ? 1 : 0);
  }
  if (filters.search) {
    const sanitized = sanitizeSearchTerm(filters.search);
    conditions.push("(t.payee LIKE ? ESCAPE '\\' OR t.memo LIKE ? ESCAPE '\\' OR CAST(t.amount AS TEXT) LIKE ? ESCAPE '\\' OR printf('%.2f', t.amount) LIKE ? ESCAPE '\\' OR printf('%.2f', ABS(t.amount)) LIKE ? ESCAPE '\\')");
    params.push(`%${sanitized}%`, `%${sanitized}%`, `%${sanitized}%`, `%${sanitized}%`, `%${sanitized}%`);
  }

  // Sort columns use the projected aliases (payee / account_name / category_name)
  // rather than `t.payee` / `a.name` so the same ORDER BY works in both the
  // direct query and the outer wrap around the split-union path.
  // COLLATE NOCASE on text columns so "USPS" and "baby romper" interleave
  // case-insensitively (default SQLite text collation puts all uppercase
  // before all lowercase, dumping lowercase entries to the bottom).
  const sortColumns: Record<string, string> = {
    date: "date",
    account: "account_name COLLATE NOCASE",
    payee: "payee COLLATE NOCASE",
    category: "category_name COLLATE NOCASE",
    amount: "amount",
  };
  const sortCol = sortColumns[filters.sortBy ?? "date"] ?? "date";
  const sortDirection = filters.sortDir === "asc" ? "ASC" : "DESC";
  const orderBy = filters.sortBy
    ? `${sortCol} ${sortDirection}`
    : "date DESC, created_at DESC";

  const baseSql = `
    SELECT t.*, a.name AS account_name, c.name AS category_name, cg.name AS category_group_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN category_groups cg ON cg.id = c.category_group_id
    WHERE ${conditions.join(" AND ")}
  `;

  let sql: string;
  let allParams: unknown[];

  if (splitUnionSql) {
    sql = `SELECT * FROM (${baseSql} UNION ALL ${splitUnionSql}) ORDER BY ${orderBy} LIMIT ${TRANSACTION_QUERY_LIMIT}`;
    allParams = [...params, ...splitUnionParams];
  } else {
    sql = `${baseSql} ORDER BY ${orderBy} LIMIT ${TRANSACTION_QUERY_LIMIT}`;
    allParams = params;
  }

  const rows = db.prepare(sql).all(...allParams) as Record<string, unknown>[];

  const result = mapRows<TransactionWithDetails>(rows).map((row) => ({
    ...row,
    account_name: (row.account_name as string) ?? "",
    category_name: (row.category_name as string) ?? null,
    category_group_name: (row.category_group_name as string) ?? null,
  }));

  // Attach split counts for split parents
  const splitParentIds = result.filter((r) => r.is_split_parent).map((r) => r.id);
  if (splitParentIds.length > 0) {
    const ph = splitParentIds.map(() => "?").join(",");
    const counts = db
      .prepare(
        `SELECT parent_transaction_id, COUNT(*) as count
         FROM transaction_splits
         WHERE parent_transaction_id IN (${ph})
         GROUP BY parent_transaction_id`
      )
      .all(...splitParentIds) as { parent_transaction_id: string; count: number }[];

    const countMap = new Map(counts.map((c) => [c.parent_transaction_id, c.count]));
    for (const row of result) {
      if (row.is_split_parent) {
        row.split_count = countMap.get(row.id) ?? 0;
      }
    }
  }

  return result;
}

/**
 * Count transactions whose date falls outside [startDate, endDate] for the
 * given scope. Used to decide whether the "Some transactions are hidden by
 * filters" footer hint is worth showing — if nothing is hidden, the hint
 * has nothing to offer.
 */
export async function countTransactionsOutsideRange(filters: {
  accountId?: string;
  categoryId?: string;
  importSource?: "everydollar" | "ynab";
  sourceGroup?: string;
  sourceCategory?: string;
  search?: string;
  startDate: string | null;
  endDate: string | null;
}): Promise<number> {
  if (!filters.startDate && !filters.endDate) return 0;
  const db = getDb();

  // "Hidden" must mean rows that match every *other* active filter but fall
  // outside the date range — i.e. exactly the rows "View all" (which clears
  // only the date filter) would reveal. Counting against the date filter alone
  // over-reports: a category/search filter that leaves nothing outside the
  // range would still light up the footer. Mirror getTransactions' non-date
  // conditions here, then invert the date condition.
  const where: string[] = ["t.user_id = ?"];
  const params: unknown[] = [DEFAULT_USER_ID];

  if (filters.accountId) {
    where.push("t.account_id = ?");
    params.push(filters.accountId);
  }

  // Split parents are matched by category via their splits, so the direct-row
  // category condition only applies to non-split rows. The split case is
  // counted separately below (mirrors the UNION ALL path in getTransactions).
  let countSplitParents = false;
  if (filters.categoryId === "uncategorized") {
    where.push(
      "t.category_id IS NULL AND t.is_split_parent = 0 AND t.transfer_account_id IS NULL"
    );
  } else if (filters.categoryId) {
    where.push("(t.category_id = ? AND t.is_split_parent = 0)");
    params.push(filters.categoryId);
    countSplitParents = true;
  }

  if (filters.importSource) {
    where.push("t.import_source = ?");
    params.push(filters.importSource);
  }
  if (filters.sourceGroup) {
    where.push("t.source_group = ?");
    params.push(filters.sourceGroup);
  }
  if (filters.sourceCategory) {
    where.push("t.source_category = ?");
    params.push(filters.sourceCategory);
  }
  if (filters.search) {
    const sanitized = sanitizeSearchTerm(filters.search);
    where.push(
      "(t.payee LIKE ? ESCAPE '\\' OR t.memo LIKE ? ESCAPE '\\' OR CAST(t.amount AS TEXT) LIKE ? ESCAPE '\\' OR printf('%.2f', t.amount) LIKE ? ESCAPE '\\' OR printf('%.2f', ABS(t.amount)) LIKE ? ESCAPE '\\')"
    );
    params.push(`%${sanitized}%`, `%${sanitized}%`, `%${sanitized}%`, `%${sanitized}%`, `%${sanitized}%`);
  }

  const outside: string[] = [];
  if (filters.startDate) {
    outside.push("t.date < ?");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    outside.push("t.date > ?");
    params.push(filters.endDate);
  }
  where.push(`(${outside.join(" OR ")})`);

  const row = db
    .prepare(`SELECT COUNT(*) as count FROM transactions t WHERE ${where.join(" AND ")}`)
    .get(...params) as { count: number };
  let count = row.count;

  // Split parents whose split matches the category but whose date sits outside
  // the range — these are hidden too but never satisfy the direct condition.
  if (countSplitParents) {
    const splitWhere: string[] = [
      "t.user_id = ?",
      "t.is_split_parent = 1",
      "ts.category_id = ?",
    ];
    const splitParams: unknown[] = [DEFAULT_USER_ID, filters.categoryId];
    if (filters.accountId) {
      splitWhere.push("t.account_id = ?");
      splitParams.push(filters.accountId);
    }
    const splitOutside: string[] = [];
    if (filters.startDate) {
      splitOutside.push("t.date < ?");
      splitParams.push(filters.startDate);
    }
    if (filters.endDate) {
      splitOutside.push("t.date > ?");
      splitParams.push(filters.endDate);
    }
    splitWhere.push(`(${splitOutside.join(" OR ")})`);
    const splitRow = db
      .prepare(
        `SELECT COUNT(DISTINCT t.id) as count
         FROM transactions t
         JOIN transaction_splits ts ON ts.parent_transaction_id = t.id
         WHERE ${splitWhere.join(" AND ")}`
      )
      .get(...splitParams) as { count: number };
    count += splitRow.count;
  }

  return count;
}

/**
 * Count uncategorized transactions across ALL history, ignoring the active
 * date range and every other toolbar filter. Drives the "needs categorizing"
 * banner, which is meant to supersede filters — an uncategorized row in an
 * out-of-range month should still nag you. Mirrors the banner's definition of
 * "uncategorized": a real (non-split, non-transfer) row with no category.
 *
 * Optionally scoped to a single account for the /accounts/[id] view.
 */
export async function countUncategorizedTransactions(
  accountId?: string
): Promise<number> {
  const db = getDb();
  const where: string[] = [
    "t.user_id = ?",
    "t.category_id IS NULL",
    "t.is_split_parent = 0",
    "t.transfer_account_id IS NULL",
  ];
  const params: unknown[] = [DEFAULT_USER_ID];
  if (accountId) {
    where.push("t.account_id = ?");
    params.push(accountId);
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM transactions t WHERE ${where.join(" AND ")}`
    )
    .get(...params) as { count: number };
  return row.count;
}

/**
 * Build an import-compatible CSV string of EVERY transaction for the user,
 * ignoring all filters and the 5000-row DOM cap. Powers the "export all history"
 * scope of the CSV export modal (260611-hv3).
 *
 * Deliberately does NOT reuse getTransactions({}) — that reader is hard-capped at
 * TRANSACTION_QUERY_LIMIT (5000) for DOM rendering, and the real instance has
 * ~16k rows, so reusing it would silently truncate the export. The cap is a
 * render concern, not a server-string concern: a CSV string for ~16k rows is a
 * small payload and serializes well under a request budget.
 *
 * Like the current-view path, split parents export as their stored parent row
 * (no split-union expansion) — export rows mirror stored rows 1:1.
 *
 * Returns the CSV string (not row objects) to bound the payload on the large
 * instance. Read-only: no revalidatePath.
 *
 * Pass `accountId` to scope the export to one account's full history (the
 * per-account export on /accounts/[id]).
 */
export async function exportAllTransactionsCsv(accountId?: string): Promise<string> {
  const db = getDb();

  const sql = `
    SELECT t.*, a.name AS account_name, c.name AS category_name, cg.name AS category_group_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN category_groups cg ON cg.id = c.category_group_id
    WHERE t.user_id = ?${accountId ? " AND t.account_id = ?" : ""}
    ORDER BY date DESC, created_at DESC
  `;

  const params = accountId ? [DEFAULT_USER_ID, accountId] : [DEFAULT_USER_ID];
  const dbRows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  const rows = mapRows<TransactionWithDetails>(dbRows).map((row) => ({
    ...row,
    account_name: (row.account_name as string) ?? "",
    category_name: (row.category_name as string) ?? null,
    category_group_name: (row.category_group_name as string) ?? null,
  }));

  return transactionsToCsv(rows);
}

export type CreateTransactionInput = {
  date: string;
  payee: string;
  memo?: string;
  amount: number;
  account_id: string;
  category_id?: string;
  cleared?: boolean;
  // Provenance — defaults to 'desktop' so all existing callers stay quiet.
  // /quick wrappers override with 'quick'; the CSV importer overrides with
  // 'import'. See SEED-014 / migration 018.
  source?: TransactionSource;
};

export async function createTransaction(input: CreateTransactionInput) {
  const db = getDb();
  const source: TransactionSource = input.source ?? "desktop";

  // Normalize payee name and auto-categorize from fuzzy match
  let categoryId = input.category_id || null;
  let payeeName = input.payee;
  if (input.payee) {
    // Try exact payee match first
    const exactPayee = db
      .prepare(`SELECT default_category_id FROM payees WHERE user_id = ? AND name = ?`)
      .get(DEFAULT_USER_ID, input.payee) as { default_category_id: string | null } | undefined;
    if (exactPayee) {
      if (!categoryId && exactPayee.default_category_id) {
        categoryId = exactPayee.default_category_id;
      }
    } else {
      // Fuzzy match: normalize "KROGER #1234" → "Kroger", "AMAZON.COM*AB12CD" → "Amazon"
      const allPayees = db
        .prepare(`SELECT name, default_category_id FROM payees WHERE user_id = ?`)
        .all(DEFAULT_USER_ID) as { name: string; default_category_id: string | null }[];
      const match = findBestPayeeMatch(input.payee, allPayees);
      if (match) {
        payeeName = match;
        if (!categoryId) {
          const matched = allPayees.find((p) => p.name.toLowerCase() === match.toLowerCase());
          if (matched?.default_category_id) categoryId = matched.default_category_id;
        }
      }
    }
  }

  // For income without a category, auto-assign to an income category
  if (input.amount > 0 && !categoryId) {
    categoryId = await ensureIncomeCategory();
  }

  const id = newId();
  const timestamp = now();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (id, user_id, date, payee, memo, amount, account_id, category_id, cleared, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      DEFAULT_USER_ID,
      input.date,
      payeeName,
      input.memo || null,
      input.amount,
      input.account_id,
      categoryId,
      input.cleared ? 1 : 0,
      source,
      timestamp,
      timestamp
    );

    // The INSERT above omits `approved`, so the row takes the schema default
    // of 1 — a desktop/quick entry is posted the moment it is created.
    applyToBalance(db, {
      account_id: input.account_id,
      date: input.date,
      amount: input.amount,
      approved: true,
    });

    if (payeeName) {
      db.prepare(
        `INSERT INTO payees (id, user_id, name, default_category_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, name) DO UPDATE SET default_category_id = COALESCE(payees.default_category_id, excluded.default_category_id)`
      ).run(newId(), DEFAULT_USER_ID, payeeName, categoryId);
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");

  return { id };
}

export async function updateTransaction(
  id: string,
  updates: Partial<{
    date: string;
    payee: string;
    // null/"" clears the memo; an undefined key is a no-op (existing semantics
    // at the SQL handler below convert "" → NULL).
    memo: string | null;
    amount: number;
    account_id: string;
    category_id: string | null;
    cleared: boolean;
    approved: boolean;
  }>
) {
  const db = getDb();

  const setClauses: string[] = [];
  const setParams: unknown[] = [];

  if (updates.date !== undefined) {
    setClauses.push("date = ?");
    setParams.push(updates.date);
  }
  if (updates.payee !== undefined) {
    setClauses.push("payee = ?");
    setParams.push(updates.payee);
  }
  if (updates.memo !== undefined) {
    setClauses.push("memo = ?");
    setParams.push(updates.memo);
  }
  if (updates.amount !== undefined) {
    setClauses.push("amount = ?");
    setParams.push(updates.amount);
  }
  if (updates.account_id !== undefined) {
    setClauses.push("account_id = ?");
    setParams.push(updates.account_id);
  }
  if (updates.category_id !== undefined) {
    setClauses.push("category_id = ?");
    setParams.push(updates.category_id);
  }
  if (updates.cleared !== undefined) {
    setClauses.push("cleared = ?");
    setParams.push(updates.cleared ? 1 : 0);
  }
  if (updates.approved !== undefined) {
    setClauses.push("approved = ?");
    setParams.push(updates.approved ? 1 : 0);
  }

  if (setClauses.length === 0) return;

  const timestamp = now();
  setClauses.push("updated_at = ?");
  setParams.push(timestamp);

  db.transaction(() => {
    // Always read pre-update mirror fields when ANY mirrorable field is being
    // updated (amount, account_id, date, memo) — the sibling cascade below
    // needs the PRE-update shape to locate the implicit pair. The previous
    // narrower gate (amount/account_id only) missed date/memo mirroring.
    const needsExisting =
      updates.amount !== undefined ||
      updates.account_id !== undefined ||
      updates.date !== undefined ||
      updates.memo !== undefined ||
      updates.approved !== undefined;

    const existing = needsExisting
      ? (db
          .prepare(
            `SELECT id, amount, account_id, date, transfer_account_id, memo, approved, created_at
               FROM transactions WHERE id = ? AND user_id = ?`
          )
          .get(id, DEFAULT_USER_ID) as
          | {
              id: string;
              amount: number;
              account_id: string;
              date: string;
              transfer_account_id: string | null;
              memo: string | null;
              approved: number;
              created_at: string;
            }
          | undefined)
      : undefined;

    if (existing) {
      const oldAmount = Number(existing.amount);
      const newAmount = updates.amount ?? oldAmount;
      const oldAccountId = existing.account_id;
      const newAccountId = updates.account_id ?? oldAccountId;

      // Each balance write is gated by ITS OWN date (260603-bdb). When the
      // user edits a txn so its date crosses the cutoff (pre→post or
      // post→pre), the reverse leg uses the OLD date and the apply leg uses
      // the NEW date — each is gated independently so the helper does the
      // right thing in every combination.
      const oldDate = existing.date;
      const newDate = updates.date ?? existing.date;

      const wasApproved = existing.approved === 1;
      const isApproved = updates.approved ?? wasApproved;

      if (wasApproved !== isApproved) {
        // Approval transition — this is the balance write. The held amount
        // enters (or leaves) in ONE move against the shape that matters:
        // posting uses the row's post-update shape, un-posting reverses the
        // pre-update shape that is actually sitting in the balance. Field
        // edits arriving in the same call (the approveEdit path in
        // transactions-client, which sends `approved` alongside amount /
        // account / date) are folded in here rather than applied twice.
        if (isApproved) {
          applyPostingToBalance(db, {
            account_id: newAccountId,
            date: newDate,
            amount: newAmount,
          });
        } else {
          applyPostingToBalance(db, {
            account_id: oldAccountId,
            date: oldDate,
            amount: -oldAmount,
          });
        }
      } else if (updates.amount !== undefined || updates.account_id !== undefined) {
        // No transition. `approved` is passed to every leg, so editing a
        // pending row is a balance no-op — its money was never applied, so
        // there is nothing to reverse and nothing to re-apply; posting later
        // picks up the edited amount.
        if (oldAccountId !== newAccountId) {
          // Moving to a different account: reverse from old, apply to new
          applyToBalance(db, {
            account_id: oldAccountId,
            date: oldDate,
            amount: -oldAmount,
            approved: isApproved,
          });
          applyToBalance(db, {
            account_id: newAccountId,
            date: newDate,
            amount: newAmount,
            approved: isApproved,
          });
        } else {
          // Same account: apply the diff. When the date crosses the cutoff,
          // the diff is split into reverse-old + apply-new so each leg is
          // gated by the correct date. When the date didn't change (or both
          // dates fall on the same side), the diff is a single delta.
          const diff = newAmount - oldAmount;
          if (diff !== 0) {
            if (oldDate !== newDate) {
              applyToBalance(db, {
                account_id: oldAccountId,
                date: oldDate,
                amount: -oldAmount,
                approved: isApproved,
              });
              applyToBalance(db, {
                account_id: oldAccountId,
                date: newDate,
                amount: newAmount,
                approved: isApproved,
              });
            } else {
              applyToBalance(db, {
                account_id: oldAccountId,
                date: newDate,
                amount: diff,
                approved: isApproved,
              });
            }
          }
        }
      }
    }

    db.prepare(
      `UPDATE transactions SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`
    ).run(...setParams, id, DEFAULT_USER_ID);

    // Transfer pair cascade — mirror amount/date/account/memo to the sibling
    // leg if one exists. Uses PRE-update field values to locate the pair.
    // Broken mirror (no sibling found) silently no-ops. See task 260518-fqy.
    //
    // `approved` is deliberately NOT mirrored, and that is a known gap rather
    // than a decision: an approval transition above posts the PRIMARY leg's
    // amount to current_balance, and the sibling stays approved = 0 with its
    // amount held out — a half-posted pair. It is unreachable today because
    // both callers that send `approved` (the ApprovalCell popover and
    // approveEdit in transactions-client) are gated on FEATURES.BANK_SYNC,
    // which is off. Before that flag flips, approving one leg has to approve
    // and post both — probably by routing transfers through a pair-aware
    // action the way edits already go through updateTransferPairWithSnapshot,
    // not by bolting `approved` onto the mirror below.
    if (existing && existing.transfer_account_id !== null) {
      const sibling = findTransferSibling(db, {
        id: existing.id,
        account_id: existing.account_id,
        transfer_account_id: existing.transfer_account_id,
        amount: Number(existing.amount),
        date: existing.date,
        created_at: existing.created_at,
      });

      if (sibling) {
        const siblingSet: string[] = [];
        const siblingParams: unknown[] = [];

        if (updates.amount !== undefined) {
          const newSiblingAmount = -updates.amount;
          const oldSiblingAmount = Number(sibling.amount);
          siblingSet.push("amount = ?");
          siblingParams.push(newSiblingAmount);

          // Sibling stays on its own account — only the parent leg may move
          // accounts. Adjust the sibling's balance for the amount diff. Each
          // leg gated by its own date (260603-bdb) so if the user also moved
          // the date across the cutoff, the reverse and apply are gated
          // independently.
          const oldSibDate = sibling.date;
          const newSibDate = updates.date ?? sibling.date;
          const diff = newSiblingAmount - oldSiblingAmount;
          if (diff !== 0) {
            if (oldSibDate !== newSibDate) {
              applyToBalance(db, {
                account_id: sibling.account_id,
                date: oldSibDate,
                amount: -oldSiblingAmount,
                approved: sibling.approved,
              });
              applyToBalance(db, {
                account_id: sibling.account_id,
                date: newSibDate,
                amount: newSiblingAmount,
                approved: sibling.approved,
              });
            } else {
              applyToBalance(db, {
                account_id: sibling.account_id,
                date: newSibDate,
                amount: diff,
                approved: sibling.approved,
              });
            }
          }
        }

        if (updates.date !== undefined) {
          siblingSet.push("date = ?");
          siblingParams.push(updates.date);
        }

        if (updates.account_id !== undefined && updates.account_id !== existing.account_id) {
          // Parent moved accounts → sibling's transfer_account_id (its
          // pointer back to the parent's account) must follow. Sibling's own
          // account_id never changes here.
          siblingSet.push("transfer_account_id = ?");
          siblingParams.push(updates.account_id);

          // Rewrite the sibling's canonical payee ("Transfer from <oldName>"
          // or "Transfer to <oldName>") to track the parent's new account.
          // Only rewrite when the current payee matches the canonical pattern
          // — preserves any user-typed payee customization (260518-fqy #8).
          const oldName = (
            db
              .prepare(`SELECT name FROM accounts WHERE id = ? AND user_id = ?`)
              .get(existing.account_id, DEFAULT_USER_ID) as
              | { name: string }
              | undefined
          )?.name;
          const newName = (
            db
              .prepare(`SELECT name FROM accounts WHERE id = ? AND user_id = ?`)
              .get(updates.account_id, DEFAULT_USER_ID) as
              | { name: string }
              | undefined
          )?.name;

          if (oldName && newName && sibling.payee) {
            let newPayee: string | null = null;
            if (sibling.payee === `Transfer from ${oldName}`) {
              newPayee = `Transfer from ${newName}`;
            } else if (sibling.payee === `Transfer to ${oldName}`) {
              newPayee = `Transfer to ${newName}`;
            }
            if (newPayee !== null) {
              siblingSet.push("payee = ?");
              siblingParams.push(newPayee);
            }
          }
        }

        if (updates.memo !== undefined) {
          siblingSet.push("memo = ?");
          siblingParams.push(updates.memo === "" ? null : updates.memo);
        }

        if (siblingSet.length > 0) {
          siblingSet.push("updated_at = ?");
          siblingParams.push(timestamp);

          db.prepare(
            `UPDATE transactions SET ${siblingSet.join(", ")} WHERE id = ? AND user_id = ?`
          ).run(...siblingParams, sibling.id, DEFAULT_USER_ID);
        }
      }
    }

    // Upsert payee for auto-complete (best-effort)
    if (updates.payee) {
      db.prepare(
        `INSERT INTO payees (id, user_id, name, default_category_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, name) DO UPDATE SET default_category_id = excluded.default_category_id`
      ).run(
        newId(),
        DEFAULT_USER_ID,
        updates.payee,
        updates.category_id !== undefined ? updates.category_id : null
      );
    }

    // Learn category: when category changes, update the payee's default
    if (updates.category_id !== undefined && !updates.payee) {
      const txn = db
        .prepare(`SELECT payee FROM transactions WHERE id = ? AND user_id = ?`)
        .get(id, DEFAULT_USER_ID) as { payee: string | null } | undefined;

      if (txn?.payee) {
        db.prepare(
          `UPDATE payees SET default_category_id = ? WHERE user_id = ? AND name = ?`
        ).run(updates.category_id, DEFAULT_USER_ID, txn.payee);
      }
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export async function deleteTransaction(id: string) {
  const db = getDb();

  db.transaction(() => {
    const txn = db
      .prepare(
        `SELECT id, account_id, amount, transfer_account_id, date, approved, created_at
           FROM transactions WHERE id = ? AND user_id = ?`
      )
      .get(id, DEFAULT_USER_ID) as
      | {
          id: string;
          account_id: string;
          amount: number;
          transfer_account_id: string | null;
          date: string;
          approved: number;
          created_at: string;
        }
      | undefined;

    if (!txn) return;

    applyToBalance(db, {
      account_id: txn.account_id,
      date: txn.date,
      amount: -Number(txn.amount),
      approved: txn.approved,
    });

    db.prepare(
      `DELETE FROM transactions WHERE id = ? AND user_id = ?`
    ).run(id, DEFAULT_USER_ID);

    // Transfer pair cascade — delete the sibling leg too. Broken mirror
    // (no sibling found) silently no-ops. See task 260518-fqy.
    if (txn.transfer_account_id !== null) {
      const sibling = findTransferSibling(db, txn);
      if (sibling) {
        applyToBalance(db, {
          account_id: sibling.account_id,
          date: sibling.date,
          amount: -Number(sibling.amount),
          approved: sibling.approved,
        });
        db.prepare(
          `DELETE FROM transactions WHERE id = ? AND user_id = ?`
        ).run(sibling.id, DEFAULT_USER_ID);
      }
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export type TransactionSnapshot = {
  id: string;
  account_id: string;
  date: string;
  payee: string | null;
  memo: string | null;
  amount: number;
  category_id: string | null;
  transfer_account_id: string | null;
  cleared: number;
  approved: number;
  is_split_parent: number;
  schedule_id: string | null;
  // Provenance carried through delete→undo→redo so a /quick row stays 'quick'
  // after restoration (migration 018 / SEED-014). NULL for pre-018 rows.
  source: TransactionSource | null;
  created_at: string;
  splits: { id: string; category_id: string; amount: number; memo: string | null; created_at: string }[];
};

/**
 * Delete a single transaction and (if it's one leg of a transfer pair) its
 * sibling leg, returning snapshots for both rows so undo can restore the
 * pair as a unit.
 *
 * Return shape (task 260518-fqy):
 *   []                    — primary id not found (no-op)
 *   [primary]             — primary deleted, no sibling
 *   [primary, sibling]    — full pair cascaded
 *
 * Caller pairs with `restoreTransactionSnapshots(snapshots)` to undo.
 */
export async function deleteTransactionWithSnapshot(
  id: string
): Promise<TransactionSnapshot[]> {
  const db = getDb();
  const snapshots: TransactionSnapshot[] = [];

  db.transaction(() => {
    const txn = db
      .prepare(
        `SELECT id, account_id, date, payee, memo, amount, category_id,
                transfer_account_id, cleared, approved, is_split_parent, schedule_id, source, created_at
         FROM transactions WHERE id = ? AND user_id = ?`
      )
      .get(id, DEFAULT_USER_ID) as Omit<TransactionSnapshot, "splits"> | undefined;

    if (!txn) return;

    const splits = db
      .prepare(
        `SELECT id, category_id, amount, memo, created_at
         FROM transaction_splits WHERE parent_transaction_id = ?`
      )
      .all(id) as { id: string; category_id: string; amount: number; memo: string | null; created_at: string }[];

    const primarySnapshot: TransactionSnapshot = {
      ...txn,
      amount: Number(txn.amount),
      splits: splits.map((s) => ({ ...s, amount: Number(s.amount) })),
    };
    snapshots.push(primarySnapshot);

    // A pending row's amount was never applied, so deleting it reverses
    // nothing — the gate in applyToBalance makes this a no-op.
    applyToBalance(db, {
      account_id: primarySnapshot.account_id,
      date: primarySnapshot.date,
      amount: -primarySnapshot.amount,
      approved: primarySnapshot.approved,
    });

    db.prepare(
      `DELETE FROM transactions WHERE id = ? AND user_id = ?`
    ).run(id, DEFAULT_USER_ID);

    // Transfer pair cascade — snapshot + delete the sibling. Broken mirror
    // (no sibling found) silently no-ops; caller sees a length-1 array.
    if (primarySnapshot.transfer_account_id !== null) {
      const siblingRef = findTransferSibling(db, {
        id: primarySnapshot.id,
        account_id: primarySnapshot.account_id,
        transfer_account_id: primarySnapshot.transfer_account_id,
        amount: primarySnapshot.amount,
        date: primarySnapshot.date,
        created_at: primarySnapshot.created_at,
      });

      if (siblingRef) {
        const siblingRow = db
          .prepare(
            `SELECT id, account_id, date, payee, memo, amount, category_id,
                    transfer_account_id, cleared, approved, is_split_parent, schedule_id, source, created_at
             FROM transactions WHERE id = ? AND user_id = ?`
          )
          .get(siblingRef.id, DEFAULT_USER_ID) as
          | Omit<TransactionSnapshot, "splits">
          | undefined;

        if (siblingRow) {
          const siblingSplits = db
            .prepare(
              `SELECT id, category_id, amount, memo, created_at
               FROM transaction_splits WHERE parent_transaction_id = ?`
            )
            .all(siblingRow.id) as { id: string; category_id: string; amount: number; memo: string | null; created_at: string }[];

          const siblingSnapshot: TransactionSnapshot = {
            ...siblingRow,
            amount: Number(siblingRow.amount),
            splits: siblingSplits.map((s) => ({ ...s, amount: Number(s.amount) })),
          };
          snapshots.push(siblingSnapshot);

          applyToBalance(db, {
            account_id: siblingSnapshot.account_id,
            date: siblingSnapshot.date,
            amount: -siblingSnapshot.amount,
            approved: siblingSnapshot.approved,
          });

          db.prepare(
            `DELETE FROM transactions WHERE id = ? AND user_id = ?`
          ).run(siblingSnapshot.id, DEFAULT_USER_ID);
        }
      }
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
  return snapshots;
}

export async function restoreTransactionSnapshot(snapshot: TransactionSnapshot): Promise<void> {
  const db = getDb();
  const timestamp = now();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (
         id, user_id, account_id, date, payee, memo, amount,
         category_id, transfer_account_id, cleared, approved, is_split_parent,
         schedule_id, source, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      snapshot.id,
      DEFAULT_USER_ID,
      snapshot.account_id,
      snapshot.date,
      snapshot.payee,
      snapshot.memo,
      snapshot.amount,
      snapshot.category_id,
      snapshot.transfer_account_id,
      snapshot.cleared,
      snapshot.approved,
      snapshot.is_split_parent,
      snapshot.schedule_id,
      snapshot.source,
      snapshot.created_at,
      timestamp
    );

    if (snapshot.splits.length > 0) {
      const stmt = db.prepare(
        `INSERT INTO transaction_splits (id, parent_transaction_id, category_id, amount, memo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const split of snapshot.splits) {
        stmt.run(split.id, snapshot.id, split.category_id, split.amount, split.memo, split.created_at, timestamp);
      }
    }

    // Restoring a pending row puts it back Pending — its amount stays held
    // out, exactly as the delete left it. Symmetric with the delete above;
    // both halves are no-ops rather than both being wrong in opposite
    // directions (2026-07-19-gate-balance-writes-on-approved).
    applyToBalance(db, {
      account_id: snapshot.account_id,
      date: snapshot.date,
      amount: snapshot.amount,
      approved: snapshot.approved,
    });
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export async function bulkDeleteTransactionsWithSnapshot(
  ids: string[]
): Promise<TransactionSnapshot[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const snapshots: TransactionSnapshot[] = [];

  db.transaction(() => {
    // Transfer pair cascade — expand `ids` with the sibling leg of any
    // selected transfer transaction. Dedupe via a Set so that selecting
    // BOTH legs of the same pair doesn't double-delete or double-reverse.
    // Broken mirror (no sibling found) silently no-ops. See task 260518-fqy.
    const inputPlaceholders = ids.map(() => "?").join(",");
    const transferRows = db
      .prepare(
        `SELECT id, account_id, transfer_account_id, amount, date, created_at
           FROM transactions
          WHERE id IN (${inputPlaceholders})
            AND user_id = ?
            AND transfer_account_id IS NOT NULL`
      )
      .all(...ids, DEFAULT_USER_ID) as {
        id: string;
        account_id: string;
        transfer_account_id: string | null;
        amount: number;
        date: string;
        created_at: string;
      }[];

    const expandedIds = new Set(ids);
    for (const row of transferRows) {
      const sibling = findTransferSibling(db, row);
      if (sibling) expandedIds.add(sibling.id);
    }
    const finalIds = [...expandedIds];
    const placeholders = finalIds.map(() => "?").join(",");

    const rows = db
      .prepare(
        `SELECT id, account_id, date, payee, memo, amount, category_id,
                transfer_account_id, cleared, approved, is_split_parent, schedule_id, source, created_at
         FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .all(...finalIds, DEFAULT_USER_ID) as Omit<TransactionSnapshot, "splits">[];

    if (rows.length === 0) return;

    const splitStmt = db.prepare(
      `SELECT id, category_id, amount, memo, created_at
       FROM transaction_splits WHERE parent_transaction_id = ?`
    );

    for (const row of rows) {
      const splits = splitStmt.all(row.id) as {
        id: string;
        category_id: string;
        amount: number;
        memo: string | null;
        created_at: string;
      }[];
      snapshots.push({
        ...row,
        amount: Number(row.amount),
        splits: splits.map((s) => ({ ...s, amount: Number(s.amount) })),
      });
    }

    for (const snap of snapshots) {
      applyToBalance(db, {
        account_id: snap.account_id,
        date: snap.date,
        amount: -snap.amount,
        approved: snap.approved,
      });
    }

    db.prepare(
      `DELETE FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
    ).run(...finalIds, DEFAULT_USER_ID);
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
  return snapshots;
}

export async function restoreTransactionSnapshots(
  snapshots: TransactionSnapshot[]
): Promise<void> {
  if (snapshots.length === 0) return;
  const db = getDb();
  const timestamp = now();

  db.transaction(() => {
    const insertTxn = db.prepare(
      `INSERT INTO transactions (
         id, user_id, account_id, date, payee, memo, amount,
         category_id, transfer_account_id, cleared, approved, is_split_parent,
         schedule_id, source, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertSplit = db.prepare(
      `INSERT INTO transaction_splits (id, parent_transaction_id, category_id, amount, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    for (const snap of snapshots) {
      insertTxn.run(
        snap.id,
        DEFAULT_USER_ID,
        snap.account_id,
        snap.date,
        snap.payee,
        snap.memo,
        snap.amount,
        snap.category_id,
        snap.transfer_account_id,
        snap.cleared,
        snap.approved,
        snap.is_split_parent,
        snap.schedule_id,
        snap.source,
        snap.created_at,
        timestamp
      );
      for (const split of snap.splits) {
        insertSplit.run(
          split.id,
          snap.id,
          split.category_id,
          split.amount,
          split.memo,
          split.created_at,
          timestamp
        );
      }
      applyToBalance(db, {
        account_id: snap.account_id,
        date: snap.date,
        amount: snap.amount,
        approved: snap.approved,
      });
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

// ---------------------------------------------------------------------------
// Atomic CSV import (with snapshot for undo)
// ---------------------------------------------------------------------------

export type BulkImportRow = {
  date: string;
  payee: string;
  memo?: string;
  amount: number;
  // Pre-resolved from a CSV Category column by the caller; payee-match and the
  // income fallback fill it in server-side when absent.
  category_id?: string;
};

/**
 * Import a batch of CSV rows for one account atomically. Every row is inserted
 * inside ONE `db.transaction()`, so a failure partway through (a bad account
 * FK, a locked DB) rolls the whole batch back instead of leaving the earlier
 * rows committed — the F5 gap the per-row `createTransaction` loop had, where a
 * mid-import throw stranded committed rows the user had to find and delete by
 * hand. Returns snapshots of the created rows so the caller can offer a single
 * Undo for the entire import (delete them) and Redo (restore them).
 *
 * Per-row resolution mirrors `createTransaction` exactly: a CSV category
 * (passed as `category_id`) wins, else an exact/fuzzy payee match supplies one,
 * else a positive amount falls back to the income category. Payees are upserted
 * as we go, so a payee learned from row 1 can categorize row 2 in the same
 * batch — the behavior the per-row loop had.
 */
export async function bulkImportTransactionsWithSnapshot(
  accountId: string,
  rows: BulkImportRow[]
): Promise<{
  snapshots: TransactionSnapshot[];
  imported: number;
  categorized: number;
}> {
  if (rows.length === 0) return { snapshots: [], imported: 0, categorized: 0 };
  const db = getDb();
  // Resolve once outside the transaction — it's a pure constant today, but
  // awaiting anything inside a better-sqlite3 transaction isn't allowed.
  const incomeCategoryId = await ensureIncomeCategory();

  const snapshots: TransactionSnapshot[] = [];
  let categorized = 0;

  const exactPayeeStmt = db.prepare(
    `SELECT default_category_id FROM payees WHERE user_id = ? AND name = ?`
  );
  const allPayeesStmt = db.prepare(
    `SELECT name, default_category_id FROM payees WHERE user_id = ?`
  );
  const insertStmt = db.prepare(
    `INSERT INTO transactions (id, user_id, date, payee, memo, amount, account_id, category_id, cleared, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const readStmt = db.prepare(
    `SELECT id, account_id, date, payee, memo, amount, category_id,
            transfer_account_id, cleared, approved, is_split_parent, schedule_id, source, created_at
     FROM transactions WHERE id = ? AND user_id = ?`
  );
  const payeeUpsertStmt = db.prepare(
    `INSERT INTO payees (id, user_id, name, default_category_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, name) DO UPDATE SET default_category_id = COALESCE(payees.default_category_id, excluded.default_category_id)`
  );

  db.transaction(() => {
    for (const row of rows) {
      let categoryId = row.category_id || null;
      let payeeName = row.payee;
      // Matches the wrapper's old counter: a CSV or payee-supplied category
      // counts as "auto-categorized"; the income fallback does not.
      let categorizedByRule = !!row.category_id;

      if (row.payee) {
        const exactPayee = exactPayeeStmt.get(DEFAULT_USER_ID, row.payee) as
          | { default_category_id: string | null }
          | undefined;
        if (exactPayee) {
          if (!categoryId && exactPayee.default_category_id) {
            categoryId = exactPayee.default_category_id;
            categorizedByRule = true;
          }
        } else {
          const allPayees = allPayeesStmt.all(DEFAULT_USER_ID) as {
            name: string;
            default_category_id: string | null;
          }[];
          const match = findBestPayeeMatch(row.payee, allPayees);
          if (match) {
            payeeName = match;
            if (!categoryId) {
              const matched = allPayees.find(
                (p) => p.name.toLowerCase() === match.toLowerCase()
              );
              if (matched?.default_category_id) {
                categoryId = matched.default_category_id;
                categorizedByRule = true;
              }
            }
          }
        }
      }

      if (row.amount > 0 && !categoryId) categoryId = incomeCategoryId;
      if (categorizedByRule) categorized++;

      const id = newId();
      const timestamp = now();
      insertStmt.run(
        id,
        DEFAULT_USER_ID,
        row.date,
        payeeName,
        row.memo || null,
        row.amount,
        accountId,
        categoryId,
        0, // import rows land uncleared, as the per-row loop set them
        "import",
        timestamp,
        timestamp
      );

      // Imported rows omit `approved` and take the schema default of 1 — a CSV
      // import is a posted statement, not a pending feed (that's import-txns).
      applyToBalance(db, {
        account_id: accountId,
        date: row.date,
        amount: row.amount,
        approved: true,
      });

      if (payeeName) {
        payeeUpsertStmt.run(newId(), DEFAULT_USER_ID, payeeName, categoryId);
      }

      // Read the row back so the snapshot carries the DB defaults (approved,
      // is_split_parent) accurately for a faithful redo.
      const inserted = readStmt.get(id, DEFAULT_USER_ID) as Omit<
        TransactionSnapshot,
        "splits"
      >;
      snapshots.push({
        ...inserted,
        amount: Number(inserted.amount),
        splits: [],
      });
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");

  return { snapshots, imported: snapshots.length, categorized };
}

// ---------------------------------------------------------------------------
// Bulk move-to-account (with snapshot for undo)
// ---------------------------------------------------------------------------

export type AccountMoveSnapshot = {
  newAccountId: string;
  rows: Array<{
    id: string;
    originalAccountId: string;
    amount: number;
    // 260603-bdb — the txn's date is captured so the undo path can gate
    // each balance write by the cutoff. In-memory only; no DB column.
    date: string;
    // Same reason, for the approval gate: a pending row changes accounts
    // without either balance moving, and the undo must not move them either.
    approved: number;
  }>;
};

export async function bulkMoveTransactionsToAccountWithSnapshot(
  ids: string[],
  newAccountId: string
): Promise<AccountMoveSnapshot> {
  if (ids.length === 0) return { newAccountId, rows: [] };
  const db = getDb();
  const timestamp = now();
  const snapshot: AccountMoveSnapshot = { newAccountId, rows: [] };

  db.transaction(() => {
    const placeholders = ids.map(() => "?").join(",");

    const existing = db
      .prepare(
        `SELECT id, account_id, amount, date, approved FROM transactions
         WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .all(...ids, DEFAULT_USER_ID) as {
      id: string;
      account_id: string;
      amount: number;
      date: string;
      approved: number;
    }[];

    if (existing.length === 0) return;

    for (const row of existing) {
      snapshot.rows.push({
        id: row.id,
        originalAccountId: row.account_id,
        amount: Number(row.amount),
        date: row.date,
        approved: row.approved,
      });
    }

    // Per-row balance adjustments — skip rows already on the destination.
    // Each reverse/apply leg is gated by the row's date (260603-bdb).
    for (const row of snapshot.rows) {
      if (row.originalAccountId === newAccountId) continue;
      applyToBalance(db, {
        account_id: row.originalAccountId,
        date: row.date,
        amount: -row.amount,
        approved: row.approved,
      });
      applyToBalance(db, {
        account_id: newAccountId,
        date: row.date,
        amount: row.amount,
        approved: row.approved,
      });
    }

    // Bulk update — idempotent for rows already on the destination
    db.prepare(
      `UPDATE transactions SET account_id = ?, updated_at = ?
       WHERE id IN (${placeholders}) AND user_id = ?`
    ).run(newAccountId, timestamp, ...ids, DEFAULT_USER_ID);
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");

  return snapshot;
}

export async function restoreAccountMoveSnapshot(
  snapshot: AccountMoveSnapshot
): Promise<void> {
  if (snapshot.rows.length === 0) return;
  const db = getDb();
  const timestamp = now();

  db.transaction(() => {
    const updateStmt = db.prepare(
      `UPDATE transactions SET account_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    );

    for (const row of snapshot.rows) {
      if (row.originalAccountId === snapshot.newAccountId) continue;
      // Reverse from the new account, apply to the original — each leg
      // gated by the row's date (260603-bdb).
      applyToBalance(db, {
        account_id: snapshot.newAccountId,
        date: row.date,
        amount: -row.amount,
        approved: row.approved,
      });
      applyToBalance(db, {
        account_id: row.originalAccountId,
        date: row.date,
        amount: row.amount,
        approved: row.approved,
      });
      updateStmt.run(row.originalAccountId, timestamp, row.id, DEFAULT_USER_ID);
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export type PayeeSnapshotRow = { id: string; payee: string | null };

// Batch payee rename. Returns the prior payee per id so the caller can wire
// a per-row undo. Also upserts the new name into the `payees` table so it
// shows up in autocomplete next time — matching `updateTransaction`'s
// best-effort upsert behavior (line ~619).
export async function bulkRenamePayeeWithSnapshot(
  ids: string[],
  newPayee: string
): Promise<PayeeSnapshotRow[]> {
  if (ids.length === 0) return [];
  const trimmed = newPayee.trim();
  if (trimmed.length === 0) return [];

  const db = getDb();
  const timestamp = now();
  const placeholders = ids.map(() => "?").join(",");

  let snapshots: PayeeSnapshotRow[] = [];

  db.transaction(() => {
    snapshots = db
      .prepare(
        `SELECT id, payee FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .all(...ids, DEFAULT_USER_ID) as PayeeSnapshotRow[];

    db.prepare(
      `UPDATE transactions SET payee = ?, updated_at = ?
       WHERE id IN (${placeholders}) AND user_id = ?`
    ).run(trimmed, timestamp, ...ids, DEFAULT_USER_ID);

    db.prepare(
      `INSERT INTO payees (id, user_id, name, default_category_id)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(user_id, name) DO NOTHING`
    ).run(newId(), DEFAULT_USER_ID, trimmed);
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");

  return snapshots;
}

export async function restorePayeeSnapshots(
  snapshots: PayeeSnapshotRow[]
): Promise<void> {
  if (snapshots.length === 0) return;
  const db = getDb();
  const timestamp = now();

  db.transaction(() => {
    const stmt = db.prepare(
      `UPDATE transactions SET payee = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    );
    for (const row of snapshots) {
      stmt.run(row.payee, timestamp, row.id, DEFAULT_USER_ID);
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export type PendingPostSnapshotRow = {
  id: string;
  account_id: string;
  date: string;
  amount: number;
};

// Post (approve) pending rows: flip approved 0->1 AND apply each row's held
// amount to current_balance (cutoff-gated via applyToBalance). Pending rows are
// inserted with their amount deliberately held OUT of the balance
// (import-txns build-sql.mjs — an unposted line must not move the reconciled
// balance), so posting is where a promoted line finally moves it. This mirrors
// the skill's promote.sh exactly. Idempotent: only rows currently approved=0
// are touched, so a mixed selection posts just the pending rows and a redo
// (after undo flips them back to 0) re-posts cleanly. Returns the rows actually
// posted so the caller can wire undo.
export async function postPendingTransactionsWithSnapshot(
  ids: string[]
): Promise<PendingPostSnapshotRow[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const timestamp = now();
  const placeholders = ids.map(() => "?").join(",");

  let posted: PendingPostSnapshotRow[] = [];

  db.transaction(() => {
    posted = db
      .prepare(
        `SELECT id, account_id, date, amount FROM transactions
         WHERE id IN (${placeholders}) AND user_id = ? AND approved = 0`
      )
      .all(...ids, DEFAULT_USER_ID) as PendingPostSnapshotRow[];

    if (posted.length === 0) return;

    // Apply each held amount as its own gated delta — same per-row shape the
    // rest of this file uses. Raw amount (no intermediate rounding), matching
    // createTransaction; display rounds via roundCents downstream.
    for (const row of posted) {
      applyPostingToBalance(db, {
        account_id: row.account_id,
        date: row.date,
        amount: Number(row.amount),
      });
    }

    const postedIds = posted.map((r) => r.id);
    const ph = postedIds.map(() => "?").join(",");
    db.prepare(
      `UPDATE transactions SET approved = 1, updated_at = ?
       WHERE id IN (${ph}) AND user_id = ?`
    ).run(timestamp, ...postedIds, DEFAULT_USER_ID);
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");

  return posted;
}

// Undo posting: flip approved 1->0 and reverse each held amount back out of
// current_balance (cutoff-gated), restoring the pending-held-out invariant
// exactly. Only rows captured in the snapshot are touched.
export async function unpostPendingTransactions(
  snapshot: PendingPostSnapshotRow[]
): Promise<void> {
  if (snapshot.length === 0) return;
  const db = getDb();
  const timestamp = now();

  db.transaction(() => {
    const stmt = db.prepare(
      `UPDATE transactions SET approved = 0, updated_at = ?
       WHERE id = ? AND user_id = ?`
    );
    for (const row of snapshot) {
      applyPostingToBalance(db, {
        account_id: row.account_id,
        date: row.date,
        amount: -Number(row.amount),
      });
      stmt.run(timestamp, row.id, DEFAULT_USER_ID);
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

// Columns whose value decides how much of a row sits in
// `accounts.current_balance`: the amount itself, the account holding it, the
// date the cutoff gate reads, and the approval flag that holds a pending row's
// money out. This is a raw UPDATE with no balance write at all, so setting any
// of them here would silently drift the balance — flipping `approved` is the
// sharp one: the row would read as posted with its amount never applied.
//
// Refusing is the point (same shape as migration 029's RESTRICT): a caller
// that needs one of these has a gated action to use —
// `postPendingTransactionsWithSnapshot` for approved,
// `updateTransaction` / `bulkMoveTransactionsToAccountWithSnapshot` for the
// rest. Today's callers only set `category_id` and `cleared`.
const BALANCE_BEARING_COLUMNS = ["amount", "account_id", "date", "approved"];

export async function bulkUpdateTransactions(
  ids: string[],
  updates: Record<string, unknown>
) {
  if (ids.length === 0) return;
  const db = getDb();
  const timestamp = now();

  const setClauses: string[] = [];
  const setValues: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (BALANCE_BEARING_COLUMNS.includes(key)) {
      throw new Error(
        `bulkUpdateTransactions cannot set "${key}" — it moves money. Use the gated action instead (see BALANCE_BEARING_COLUMNS).`
      );
    }
    setClauses.push(`${key} = ?`);
    setValues.push(value);
  }
  setClauses.push("updated_at = ?");
  setValues.push(timestamp);

  const placeholders = ids.map(() => "?").join(",");

  db.prepare(
    `UPDATE transactions SET ${setClauses.join(", ")} WHERE id IN (${placeholders}) AND user_id = ?`
  ).run(...setValues, ...ids, DEFAULT_USER_ID);

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export async function bulkDeleteTransactions(ids: string[]) {
  if (ids.length === 0) return;
  const db = getDb();

  db.transaction(() => {
    const placeholders = ids.map(() => "?").join(",");

    // Reverse balances — gated by each txn's date (260603-bdb).
    const txns = db
      .prepare(
        `SELECT amount, account_id, date, approved FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .all(...ids, DEFAULT_USER_ID) as {
        amount: number;
        account_id: string;
        date: string;
        approved: number;
      }[];

    for (const txn of txns) {
      applyToBalance(db, {
        account_id: txn.account_id,
        date: txn.date,
        amount: -Number(txn.amount),
        approved: txn.approved,
      });
    }

    db.prepare(
      `DELETE FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
    ).run(...ids, DEFAULT_USER_ID);
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

// A duplicate is an exact copy of the original — same date, same approved and
// cleared flags, same splits. Only the id is new.
//
// Previously this forced `date = today` and `approved = 0`, which put every
// copy in the Pending section (the schema defaults approved to 1, and this was
// the only insert in the file that opted out) and moved it into whatever month
// happened to be current. It also ignored transaction_splits and hardcoded
// is_split_parent = 0, silently flattening a split into one uncategorized row
// carrying the full amount.
//
// The copy moves the balance only when BOTH gates in applyToBalance say so:
//
//   - the cutoff gate — copying a pre-cutoff historical row no-ops the
//     balance, exactly as the original did;
//   - the approval gate — a pending (approved = 0) row is deliberately held
//     OUT of current_balance until it is posted (see
//     postPendingTransactionsWithSnapshot). Copying a pending row and applying
//     its amount anyway would move the balance for a row still displayed as
//     Pending, and then postPendingTransactions would apply the same amount a
//     second time on approve — double-counting the copy.
//
// Callers pass non-transfer ids only (see transactions-client) — duplicating
// one leg of a pair would orphan it.
export async function duplicateTransactions(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const timestamp = now();
  const newIds: string[] = [];

  db.transaction(() => {
    const placeholders = ids.map(() => "?").join(",");
    const originals = db
      .prepare(
        `SELECT * FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .all(...ids, DEFAULT_USER_ID) as Record<string, unknown>[];

    const selectSplits = db.prepare(
      `SELECT * FROM transaction_splits WHERE parent_transaction_id = ?`
    );
    const insertSplit = db.prepare(
      `INSERT INTO transaction_splits (id, parent_transaction_id, category_id, amount, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertTxn = db.prepare(
      `INSERT INTO transactions (id, user_id, account_id, date, payee, memo, amount, category_id, transfer_account_id, cleared, approved, is_split_parent, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'desktop', ?, ?)`
    );

    for (const orig of originals) {
      const dupId = newId();
      insertTxn.run(
        dupId,
        DEFAULT_USER_ID,
        orig.account_id,
        orig.date,
        orig.payee,
        orig.memo,
        orig.amount,
        orig.category_id,
        orig.transfer_account_id,
        orig.cleared,
        orig.approved,
        orig.is_split_parent,
        timestamp,
        timestamp
      );
      newIds.push(dupId);

      if (orig.is_split_parent) {
        const splits = selectSplits.all(orig.id as string) as Record<
          string,
          unknown
        >[];
        for (const s of splits) {
          insertSplit.run(
            newId(),
            dupId,
            s.category_id,
            s.amount,
            s.memo,
            timestamp,
            timestamp
          );
        }
      }

      // Pending copies stay held out — approving them is what moves the money.
      applyToBalance(db, {
        account_id: orig.account_id as string,
        date: orig.date as string,
        amount: Number(orig.amount),
        approved: Number(orig.approved),
      });
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
  return newIds;
}

export async function getAccountsAndCategories() {
  const db = getDb();

  const accounts = mapRows<{
    id: string;
    name: string;
    type: string;
    is_budget_account: boolean;
  }>(
    db
      .prepare(
        `SELECT id, name, type, is_budget_account FROM accounts
         WHERE user_id = ? AND archived = 0
         ORDER BY sort_order`
      )
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );

  const categories = db
    .prepare(
      `SELECT id, name, category_group_id FROM categories
       WHERE user_id = ? AND archived = 0
       ORDER BY sort_order`
    )
    .all(DEFAULT_USER_ID) as { id: string; name: string; category_group_id: string }[];

  const categoryGroups = mapRows<{
    id: string;
    name: string;
    is_income: boolean;
    is_system: boolean;
  }>(
    db
      .prepare(
        `SELECT id, name, is_income, is_system FROM category_groups
         WHERE user_id = ?
         ORDER BY sort_order`
      )
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );

  const earliestRow = db
    .prepare(`SELECT MIN(date) AS min_date FROM transactions WHERE user_id = ?`)
    .get(DEFAULT_USER_ID) as { min_date: string | null } | undefined;
  const earliestTransactionYear =
    earliestRow?.min_date && /^\d{4}/.test(earliestRow.min_date)
      ? Number(earliestRow.min_date.slice(0, 4))
      : new Date().getFullYear();

  return { accounts, categories, categoryGroups, earliestTransactionYear };
}

export async function ensureDefaultAccount(): Promise<string> {
  const db = getDb();

  const existing = db
    .prepare(
      `SELECT id FROM accounts WHERE user_id = ? AND archived = 0 LIMIT 1`
    )
    .get(DEFAULT_USER_ID) as { id: string } | undefined;

  if (existing) return existing.id;

  const id = newId();
  const timestamp = now();

  db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, is_budget_account, current_balance, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, DEFAULT_USER_ID, "Cash", "checking", 1, 0, 0, 0, timestamp, timestamp);

  revalidatePath("/budget");
  return id;
}

export async function getPayees(): Promise<
  { id: string; name: string; default_category_id: string | null }[]
> {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, name, default_category_id FROM payees
       WHERE user_id = ?
       ORDER BY name`
    )
    .all(DEFAULT_USER_ID) as { id: string; name: string; default_category_id: string | null }[];
}

// Result-shape return (instead of throwing) for the known duplicate-name case
// so the client gets the real message — Next.js scrubs server-action throws in
// production and surfaces a generic "Server Components render" error overlay.
export type UpdatePayeeResult =
  | { ok: true }
  | { ok: false; error: "duplicate_name"; conflictPayeeId: string | null; conflictName: string };

export async function updatePayee(
  id: string,
  updates: { name?: string; default_category_id?: string | null }
): Promise<UpdatePayeeResult> {
  const db = getDb();

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    params.push(updates.name);
  }
  if (updates.default_category_id !== undefined) {
    setClauses.push("default_category_id = ?");
    params.push(updates.default_category_id);
  }

  if (setClauses.length === 0) return { ok: true };

  // Look up the current name so we can propagate a rename to existing
  // transactions, which store the payee as a denormalized string.
  const existing = db
    .prepare(`SELECT name FROM payees WHERE id = ? AND user_id = ?`)
    .get(id, DEFAULT_USER_ID) as { name: string } | undefined;

  const isRename =
    updates.name !== undefined &&
    existing !== undefined &&
    updates.name !== existing.name;

  // Pre-check the unique conflict so we can return a structured result with
  // the conflicting payee's id (needed by the "merge instead?" flow).
  if (isRename) {
    const conflict = db
      .prepare(
        `SELECT id FROM payees WHERE user_id = ? AND name = ? AND id != ?`
      )
      .get(DEFAULT_USER_ID, updates.name!, id) as { id: string } | undefined;
    if (conflict) {
      return {
        ok: false,
        error: "duplicate_name",
        conflictPayeeId: conflict.id,
        conflictName: updates.name!,
      };
    }
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE payees SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`
    ).run(...params, id, DEFAULT_USER_ID);

    if (isRename) {
      db.prepare(
        `UPDATE transactions SET payee = ?, updated_at = ?
         WHERE payee = ? AND user_id = ?`
      ).run(updates.name, now(), existing!.name, DEFAULT_USER_ID);
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
  return { ok: true };
}

export async function deletePayee(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM payees WHERE id = ? AND user_id = ?`).run(
    id,
    DEFAULT_USER_ID
  );
  revalidatePath("/transactions");
}

export async function deletePayees(ids: string[]) {
  if (ids.length === 0) return;

  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM payees WHERE id IN (${placeholders}) AND user_id = ?`
  ).run(...ids, DEFAULT_USER_ID);
  revalidatePath("/transactions");
}

// ---------------------------------------------------------------------------
// SEED-022: merge payees
//
// Collapse one or more "loser" payees into a "winner", rewriting every
// transaction that referenced a loser's name to the winner's name and deleting
// the loser payee rows. Payee is a denormalized STRING on transactions, so the
// merge is purely a string rewrite + row delete — money (current_balance,
// applyToBalance) is never touched. The winner keeps its own
// default_category_id; loser categories are dropped (winner wins).
//
// The *WithSnapshot variant captures enough to round-trip the merge for
// in-session undo (the snapshot is session-only client state — the standard
// useUndoRedo pattern, no persistence across refresh).
// ---------------------------------------------------------------------------

type PayeeRow = { id: string; name: string; default_category_id: string | null };

export type MergePayeesSnapshot = {
  loserPayees: PayeeRow[];
  rewrittenTransactions: { transactionId: string; originalPayee: string }[];
};

// Resolve the winner name + the set of distinct loser rows to merge, defensively
// excluding the winner from the loser list. Returns null when there's nothing to
// do (winner missing, or no losers remain after filtering).
function resolveMerge(
  db: ReturnType<typeof getDb>,
  loserIds: string[],
  winnerId: string
): { winnerName: string; loserRows: PayeeRow[] } | null {
  const winner = db
    .prepare(`SELECT name FROM payees WHERE id = ? AND user_id = ?`)
    .get(winnerId, DEFAULT_USER_ID) as { name: string } | undefined;
  if (!winner) return null;

  const ids = [...new Set(loserIds)].filter((id) => id !== winnerId);
  if (ids.length === 0) return null;

  const placeholders = ids.map(() => "?").join(",");
  const loserRows = db
    .prepare(
      `SELECT id, name, default_category_id FROM payees
       WHERE id IN (${placeholders}) AND user_id = ?`
    )
    .all(...ids, DEFAULT_USER_ID) as PayeeRow[];
  if (loserRows.length === 0) return null;

  return { winnerName: winner.name, loserRows };
}

export async function mergePayees(loserIds: string[], winnerId: string) {
  const db = getDb();
  const resolved = resolveMerge(db, loserIds, winnerId);
  if (!resolved) return;
  const { winnerName, loserRows } = resolved;

  const loserNames = loserRows.map((r) => r.name);
  const loserRowIds = loserRows.map((r) => r.id);
  const namePlaceholders = loserNames.map(() => "?").join(",");
  const idPlaceholders = loserRowIds.map(() => "?").join(",");

  db.transaction(() => {
    db.prepare(
      `UPDATE transactions SET payee = ?, updated_at = ?
       WHERE payee IN (${namePlaceholders}) AND user_id = ?`
    ).run(winnerName, now(), ...loserNames, DEFAULT_USER_ID);

    db.prepare(
      `DELETE FROM payees WHERE id IN (${idPlaceholders}) AND user_id = ?`
    ).run(...loserRowIds, DEFAULT_USER_ID);
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export async function mergePayeesWithSnapshot(
  loserIds: string[],
  winnerId: string
): Promise<MergePayeesSnapshot> {
  const db = getDb();
  const resolved = resolveMerge(db, loserIds, winnerId);
  if (!resolved) {
    return { loserPayees: [], rewrittenTransactions: [] };
  }
  const { winnerName, loserRows } = resolved;

  const loserNames = loserRows.map((r) => r.name);
  const loserRowIds = loserRows.map((r) => r.id);
  const namePlaceholders = loserNames.map(() => "?").join(",");
  const idPlaceholders = loserRowIds.map(() => "?").join(",");

  const snapshot = db.transaction(() => {
    // Capture which transactions are about to be rewritten BEFORE the UPDATE so
    // the read reflects the pre-merge payee strings.
    const rewrittenTransactions = (
      db
        .prepare(
          `SELECT id, payee FROM transactions
           WHERE payee IN (${namePlaceholders}) AND user_id = ?`
        )
        .all(...loserNames, DEFAULT_USER_ID) as { id: string; payee: string }[]
    ).map((r) => ({ transactionId: r.id, originalPayee: r.payee }));

    db.prepare(
      `UPDATE transactions SET payee = ?, updated_at = ?
       WHERE payee IN (${namePlaceholders}) AND user_id = ?`
    ).run(winnerName, now(), ...loserNames, DEFAULT_USER_ID);

    db.prepare(
      `DELETE FROM payees WHERE id IN (${idPlaceholders}) AND user_id = ?`
    ).run(...loserRowIds, DEFAULT_USER_ID);

    return {
      loserPayees: loserRows,
      rewrittenTransactions,
    } satisfies MergePayeesSnapshot;
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
  return snapshot;
}

export async function restoreMergePayeesSnapshot(
  snapshot: MergePayeesSnapshot
): Promise<void> {
  const db = getDb();

  db.transaction(() => {
    for (const payee of snapshot.loserPayees) {
      db.prepare(
        `INSERT INTO payees (id, user_id, name, default_category_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        payee.id,
        DEFAULT_USER_ID,
        payee.name,
        payee.default_category_id,
        now(),
        now()
      );
    }

    for (const { transactionId, originalPayee } of snapshot.rewrittenTransactions) {
      db.prepare(
        `UPDATE transactions SET payee = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).run(originalPayee, now(), transactionId, DEFAULT_USER_ID);
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");
}

/**
 * The single inflow sink. Any positive-amount transaction that lacks a
 * user-chosen category lands here, and the budget engine sums it into Ready
 * to Assign. The category is seeded by migration 008 and is guaranteed to
 * exist for every DB at schema version >= 8 — the prior version of this
 * function created an "Income / Salary" pair on first use, but that's
 * obsolete now that we have a dedicated system category. Migration 010
 * cleans up any legacy auto-created groups.
 *
 * Kept as a function (not just an import of the constant) so existing
 * call sites and tests don't have to change.
 */
export async function ensureIncomeCategory(): Promise<string> {
  return READY_TO_ASSIGN_CATEGORY_ID;
}

export async function findDuplicates(
  accountId: string,
  transactions: { date: string; payee: string; amount: number }[]
): Promise<number[]> {
  // Match on (date, amount) only. The CSV payee is the raw bank description
  // ("KING SOOPERS #0062") but createTransaction normalizes it on insert
  // ("King Soopers"), so an exact payee match misses almost every re-import.
  //
  // That makes this a HINT, not a verdict: a genuine repeat charge (two $3.80
  // sodas bought the same day) is indistinguishable from a real duplicate here.
  // The dialog therefore flags these and leaves them checked — it must never
  // auto-deselect on this signal, because the error only runs one way. Dropping
  // a real charge silently biases every balance optimistic; importing a real
  // duplicate is visible and one Cmd+Z away.
  const db = getDb();
  const duplicates: number[] = [];

  const stmt = db.prepare(
    `SELECT COUNT(*) as count FROM transactions
     WHERE user_id = ? AND account_id = ? AND date = ? AND amount = ?`
  );

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    const result = stmt.get(DEFAULT_USER_ID, accountId, t.date, t.amount) as { count: number };
    if (result.count > 0) {
      duplicates.push(i);
    }
  }

  return duplicates;
}

// ---------------------------------------------------------------------------
// Split transaction operations
// ---------------------------------------------------------------------------

export async function getSplitsForTransaction(
  transactionId: string
): Promise<TransactionSplitWithCategory[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ts.*, c.name AS category_name
       FROM transaction_splits ts
       LEFT JOIN categories c ON c.id = ts.category_id
       WHERE ts.parent_transaction_id = ?
       ORDER BY ts.created_at`
    )
    .all(transactionId) as (Record<string, unknown> & { category_name: string | null })[];

  return rows.map((r) => ({
    id: r.id as string,
    parent_transaction_id: r.parent_transaction_id as string,
    category_id: (r.category_id as string) ?? null,
    amount: Number(r.amount),
    memo: (r.memo as string) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    category_name: r.category_name ?? null,
  }));
}

export type SplitInput = {
  category_id: string | null;
  amount: number;
  memo?: string;
};

/**
 * Belt for the split-allocation-loss bug: a split set must sum to its parent
 * transaction's amount. The client gate (commitEdit) already refuses to commit
 * an unbalanced split, but this makes it impossible for ANY call site — now or
 * later — to silently persist an under-allocated set, turning invisible data
 * corruption into a loud failure. Compared in integer cents to avoid float
 * drift (mirrors createQuickSplitTransaction's sum check). Callers must land
 * any parent-amount change BEFORE saving splits so this validates against the
 * intended total, not a stale one.
 */
function assertSplitsBalanceParent(
  db: ReturnType<typeof getDb>,
  transactionId: string,
  splits: SplitInput[]
) {
  const parent = db
    .prepare(`SELECT amount FROM transactions WHERE id = ? AND user_id = ?`)
    .get(transactionId, DEFAULT_USER_ID) as { amount: number } | undefined;
  if (!parent) return;
  const sumCents = splits.reduce((acc, s) => acc + Math.round(s.amount * 100), 0);
  const parentCents = Math.round(Number(parent.amount) * 100);
  if (sumCents !== parentCents) {
    throw new Error(
      `Split allocation (${sumCents / 100}) does not equal the transaction total (${parentCents / 100})`
    );
  }
}

export async function saveSplits(
  transactionId: string,
  splits: SplitInput[]
) {
  const db = getDb();
  const timestamp = now();
  assertSplitsBalanceParent(db, transactionId, splits);

  db.transaction(() => {
    // Set parent flags
    db.prepare(
      `UPDATE transactions SET is_split_parent = 1, category_id = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(timestamp, transactionId, DEFAULT_USER_ID);

    // Replace existing splits
    db.prepare(
      `DELETE FROM transaction_splits WHERE parent_transaction_id = ?`
    ).run(transactionId);

    // Insert new splits
    const stmt = db.prepare(
      `INSERT INTO transaction_splits (id, parent_transaction_id, category_id, amount, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const split of splits) {
      stmt.run(newId(), transactionId, split.category_id, split.amount, split.memo || null, timestamp, timestamp);
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
}

export async function removeSplits(
  transactionId: string,
  categoryId: string | null
) {
  const db = getDb();
  const timestamp = now();

  db.transaction(() => {
    db.prepare(
      `DELETE FROM transaction_splits WHERE parent_transaction_id = ?`
    ).run(transactionId);

    db.prepare(
      `UPDATE transactions SET is_split_parent = 0, category_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(categoryId, timestamp, transactionId, DEFAULT_USER_ID);
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
}

// ---------------------------------------------------------------------------
// Split undo/redo support
// ---------------------------------------------------------------------------

export type SplitSnapshot = {
  wasSplitParent: boolean;
  previousCategoryId: string | null;
  previousSplits: SplitInput[];
};

function captureSplitSnapshot(db: ReturnType<typeof getDb>, transactionId: string): SplitSnapshot {
  const parent = db
    .prepare(`SELECT is_split_parent, category_id FROM transactions WHERE id = ? AND user_id = ?`)
    .get(transactionId, DEFAULT_USER_ID) as { is_split_parent: number; category_id: string | null } | undefined;

  const existingSplits = db
    .prepare(`SELECT category_id, amount, memo FROM transaction_splits WHERE parent_transaction_id = ? ORDER BY created_at`)
    .all(transactionId) as { category_id: string | null; amount: number; memo: string | null }[];

  return {
    wasSplitParent: !!parent?.is_split_parent,
    previousCategoryId: parent?.category_id ?? null,
    previousSplits: existingSplits.map((s) => ({
      category_id: s.category_id,
      amount: Number(s.amount),
      memo: s.memo ?? undefined,
    })),
  };
}

export async function saveSplitsWithSnapshot(
  transactionId: string,
  splits: SplitInput[]
): Promise<SplitSnapshot> {
  const db = getDb();
  const timestamp = now();
  assertSplitsBalanceParent(db, transactionId, splits);
  const snapshot = captureSplitSnapshot(db, transactionId);

  db.transaction(() => {
    db.prepare(
      `UPDATE transactions SET is_split_parent = 1, category_id = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(timestamp, transactionId, DEFAULT_USER_ID);

    db.prepare(
      `DELETE FROM transaction_splits WHERE parent_transaction_id = ?`
    ).run(transactionId);

    const stmt = db.prepare(
      `INSERT INTO transaction_splits (id, parent_transaction_id, category_id, amount, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const split of splits) {
      stmt.run(newId(), transactionId, split.category_id, split.amount, split.memo || null, timestamp, timestamp);
    }
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  return snapshot;
}

export async function removeSplitsWithSnapshot(
  transactionId: string,
  categoryId: string | null
): Promise<SplitSnapshot> {
  const db = getDb();
  const timestamp = now();
  const snapshot = captureSplitSnapshot(db, transactionId);

  db.transaction(() => {
    db.prepare(
      `DELETE FROM transaction_splits WHERE parent_transaction_id = ?`
    ).run(transactionId);

    db.prepare(
      `UPDATE transactions SET is_split_parent = 0, category_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(categoryId, timestamp, transactionId, DEFAULT_USER_ID);
  })();

  revalidatePath("/transactions");
  revalidatePath("/budget");
  return snapshot;
}

export async function restoreSplitSnapshot(
  transactionId: string,
  snapshot: SplitSnapshot
) {
  if (snapshot.wasSplitParent) {
    await saveSplits(transactionId, snapshot.previousSplits);
  } else {
    await removeSplits(transactionId, snapshot.previousCategoryId);
  }
}

// ---------------------------------------------------------------------------
// Mobile quick-add (/quick) support
// ---------------------------------------------------------------------------

export async function getQuickAddData() {
  const { accounts, categories, categoryGroups } = await getAccountsAndCategories();

  const incomeGroupIds = new Set(
    categoryGroups.filter((g) => g.is_income).map((g) => g.id)
  );
  const incomeCategoryIds = new Set(
    categories.filter((c) => incomeGroupIds.has(c.category_group_id)).map((c) => c.id)
  );
  // System categories (Balance adjustment, Category not needed, Ready to
  // assign) live in is_system groups. They are seeded by migrations and used
  // internally by budget/balance machinery, but should never surface as
  // user-facing quick-add tiles. Defensively guarded across all three
  // priority-chain steps below.
  const systemGroupIds = new Set(
    categoryGroups.filter((g) => g.is_system).map((g) => g.id)
  );
  const systemCategoryIds = new Set(
    categories.filter((c) => systemGroupIds.has(c.category_group_id)).map((c) => c.id)
  );

  const db = getDb();

  // Pinned categories take priority. Manual user choice; sort by sort_order
  // so the budget-page ordering carries through to the mobile tile slots.
  const pinnedRows = db
    .prepare(
      `SELECT c.id, c.category_group_id, c.sort_order
         FROM categories c
        WHERE c.user_id = ? AND c.pinned_quick = 1 AND c.archived = 0
        ORDER BY c.sort_order ASC`
    )
    .all(DEFAULT_USER_ID) as {
    id: string;
    category_group_id: string;
    sort_order: number;
  }[];

  // Usage over the last 60 days fills the remaining slots when fewer than
  // 3 categories are pinned per bucket. 60d window matches a 2-month rolling
  // view of typical spend without skewing toward all-time history.
  const recentUsage = db
    .prepare(
      `SELECT category_id, COUNT(*) as n
         FROM transactions
        WHERE user_id = ?
          AND category_id IS NOT NULL
          AND date >= date('now', '-60 day')
        GROUP BY category_id
        ORDER BY n DESC
        LIMIT 24`
    )
    .all(DEFAULT_USER_ID) as { category_id: string; n: number }[];

  function buildBucket(isIncome: boolean): string[] {
    const out: string[] = [];
    // 1. Pinned categories first (user-curated). The budget UI does not let
    //    users pin a system category today, but guard defensively so a
    //    direct-DB pin (or a future UI regression) can't leak into tiles.
    for (const p of pinnedRows) {
      if (out.length >= 3) break;
      if (systemGroupIds.has(p.category_group_id)) continue;
      const inBucket = isIncome
        ? incomeGroupIds.has(p.category_group_id)
        : !incomeGroupIds.has(p.category_group_id);
      if (inBucket && !out.includes(p.id)) out.push(p.id);
    }
    // 2. Recent-usage frequency (last 60 days). System categories shouldn't
    //    appear here in practice (no UI path writes is_system categories),
    //    but skip them for symmetry with the other steps.
    if (out.length < 3) {
      for (const r of recentUsage) {
        if (out.length >= 3) break;
        if (systemCategoryIds.has(r.category_id)) continue;
        const isIncomeCat = incomeCategoryIds.has(r.category_id);
        if (isIncomeCat !== isIncome) continue;
        if (!out.includes(r.category_id)) out.push(r.category_id);
      }
    }
    // 3. Pad with any remaining bucket categories (fresh DBs / first-run
    //    users). System categories MUST be filtered here — without this
    //    guard, fresh installs leak "Balance adjustment" / "Category not
    //    needed" into the expense bucket and "Ready to assign" into the
    //    income bucket.
    if (out.length < 3) {
      for (const c of categories) {
        if (out.length >= 3) break;
        if (systemGroupIds.has(c.category_group_id)) continue;
        const inBucket = isIncome
          ? incomeGroupIds.has(c.category_group_id)
          : !incomeGroupIds.has(c.category_group_id);
        if (!inBucket) continue;
        if (!out.includes(c.id)) out.push(c.id);
      }
    }
    return out;
  }

  const topCategoryIds = buildBucket(false);
  const topIncomeCategoryIds = buildBucket(true);

  // Recent quick-adds — the last 5 transactions submitted from /quick (payee
  // empty). For split parents, surface the first split's category as the
  // display category. Sourcing this from the server (rather than localStorage)
  // means deletes/renames elsewhere are reflected on next render and a hard
  // refresh never flashes stale rows.
  // Recent transactions for the /quick "Recent" list. Originally filtered by
  // payee='' to scope to quick-adds, but now that the quick form captures
  // payees that filter would hide the user's most recent quick submissions.
  // Show the last five transactions regardless of source — payee + category
  // subtitle is enough for the user to recognize them, and a desktop-entered
  // row in the list is itself useful confirmation. Transfers are surfaced
  // too (one row per pair: the outflow side, amount < 0) so a /quick-logged
  // cash withdrawal still appears in Recent.
  const recentRows = db
    .prepare(
      `SELECT t.id, t.payee, t.memo, t.amount, t.category_id, t.account_id,
              t.is_split_parent, t.transfer_account_id, t.created_at
         FROM transactions t
        WHERE t.user_id = ?
          AND (t.transfer_account_id IS NULL OR t.amount < 0)
        ORDER BY t.created_at DESC
        LIMIT 5`
    )
    .all(DEFAULT_USER_ID) as {
    id: string;
    payee: string;
    memo: string | null;
    amount: number;
    category_id: string | null;
    account_id: string;
    is_split_parent: number;
    transfer_account_id: string | null;
    created_at: string;
  }[];

  // Pull every split row for any split parents in the recent set so the
  // client can render "Groceries + Dining out" instead of just the first one.
  const splitParentIds = recentRows
    .filter((r) => r.is_split_parent)
    .map((r) => r.id);
  // `amount` is selected alongside `category_id` so the edit sheet can seed
  // the real per-line allocation. Without it the sheet fabricated an even
  // split and silently wrote that back over the user's real one on any save
  // (a payee-only edit turned $80/$20 into $50/$50).
  const splitsByParent = new Map<
    string,
    { categoryId: string; amount: number }[]
  >();
  if (splitParentIds.length > 0) {
    const placeholders = splitParentIds.map(() => "?").join(",");
    const splitRows = db
      .prepare(
        `SELECT parent_transaction_id, category_id, amount
           FROM transaction_splits
          WHERE parent_transaction_id IN (${placeholders})
          ORDER BY created_at ASC`
      )
      .all(...splitParentIds) as {
      parent_transaction_id: string;
      category_id: string | null;
      amount: number;
    }[];
    for (const s of splitRows) {
      if (!s.category_id) continue;
      const list = splitsByParent.get(s.parent_transaction_id) ?? [];
      list.push({ categoryId: s.category_id, amount: Number(s.amount) });
      splitsByParent.set(s.parent_transaction_id, list);
    }
  }

  // Payees for the form's autocomplete datalist. Just names — the server's
  // existing payee-learning path handles default-category lookups, and the
  // form passes a category explicitly so it doesn't depend on that lookup.
  const payeeRows = db
    .prepare(`SELECT name FROM payees WHERE user_id = ? ORDER BY name`)
    .all(DEFAULT_USER_ID) as { name: string }[];
  const payees = payeeRows.map((p) => p.name);

  const recentQuickAdds = recentRows.map((r) => {
    const parentSplits = r.is_split_parent
      ? splitsByParent.get(r.id) ?? []
      : [];
    // categoryIds: [] = uncategorized; [id] = single; [id, id, ...] = split.
    const categoryIds = r.is_split_parent
      ? parentSplits.map((s) => s.categoryId)
      : r.category_id
        ? [r.category_id]
        : [];
    // Magnitudes aligned index-for-index with categoryIds. Empty for
    // non-splits. The edit sheet seeds its inputs from these instead of
    // inventing an even distribution.
    const splitAmounts = parentSplits.map((s) => Math.abs(s.amount));
    const signedAmount = Number(r.amount);
    return {
      transactionId: r.id,
      payee: r.payee,
      memo: r.memo,
      // Display absolute value; the form uses mode to convey sign on save and
      // the Recent list shows magnitude consistently with the desktop view.
      amount: Math.abs(signedAmount),
      // Signed value (negative=expense, positive=income) lets the edit sheet
      // recover the original mode without a second round-trip.
      signedAmount,
      categoryIds,
      splitAmounts,
      accountId: r.account_id,
      isSplitParent: !!r.is_split_parent,
      // Present only for transfer outflow rows; carries the destination
      // account id so the Recent list can render "<from> → <to>".
      transferToAccountId: r.transfer_account_id ?? undefined,
      createdAt: Date.parse(r.created_at),
    };
  });

  // Current-month available per category for the picker sheets. Computed via
  // the real budget engine (transfer-plan precedent) — cumulative available
  // includes prior-month overspending handling that a narrow SQL sum would
  // fork. Income/system categories never appear in engine groups, so the map
  // simply lacks them and the picker renders no badge.
  const budgetMonth = computeBudgetMonth(await getBudgetData(getMonthKey()));
  const availableByCategory: Record<string, number> = {};
  // Hidden groups/categories are budget-page presentation state — their rows
  // still show in the /quick picker, so include them in the map.
  for (const g of [...budgetMonth.groups, ...budgetMonth.hiddenGroups]) {
    for (const c of g.categories) availableByCategory[c.id] = c.available;
  }
  for (const c of budgetMonth.hiddenCategories) {
    availableByCategory[c.id] = c.available;
  }

  return {
    accounts,
    categories,
    categoryGroups,
    topCategoryIds,
    topIncomeCategoryIds,
    recentQuickAdds,
    payees,
    availableByCategory,
  };
}

export async function createQuickTransaction(input: {
  amount: number;
  account_id: string;
  category_id: string;
  payee?: string;
  memo?: string;
}) {
  const date = new Date().toISOString().slice(0, 10);
  const result = await createTransaction({
    date,
    // Empty payee skips createTransaction's payee learning/lookup. When the
    // user typed one, it falls through the existing INSERT ... ON CONFLICT
    // path so the payee record (and default_category_id) is recorded.
    payee: (input.payee ?? "").trim(),
    amount: input.amount,
    account_id: input.account_id,
    category_id: input.category_id,
    // Empty/undefined collapses to NULL inside createTransaction
    // (`input.memo || null` at line 378).
    memo: input.memo,
    cleared: false,
    source: "quick",
  });
  // Refresh the server-rendered /quick Recent list after the round-trip.
  revalidatePath("/quick");
  return result;
}

/**
 * Result shape for /quick split-parity validation. Caller-correctable input
 * errors return a structured `{ ok: false, ... }` rather than throwing —
 * Next.js scrubs server-action throws in production, which would otherwise
 * hide the mismatch detail behind a generic toast. DB errors still throw
 * (see `UpdatePayeeResult` near line 1582 for the same pattern).
 */
export type QuickSplitResult =
  | { ok: true; parent: Awaited<ReturnType<typeof createTransaction>> }
  | { ok: false; error: "too_few_splits" }
  | { ok: false; error: "sum_mismatch"; got: number; expected: number };

export type QuickUpdateResult =
  | { ok: true }
  | { ok: false; error: "sum_mismatch"; got: number; expected: number };

/**
 * Create a transaction split across multiple categories with caller-specified
 * per-line amounts. `total_amount` is the signed parent (negative=expense,
 * positive=income); each split amount must carry the same sign and the
 * sum-of-splits must equal `total_amount` to the cent. >= 2 splits required.
 *
 * Validation errors return `{ ok: false, error }` (see QuickSplitResult).
 */
export async function createQuickSplitTransaction(input: {
  total_amount: number;
  account_id: string;
  splits: { category_id: string; amount: number }[];
  payee?: string;
  memo?: string;
}): Promise<QuickSplitResult> {
  if (input.splits.length < 2) {
    return { ok: false, error: "too_few_splits" };
  }
  const totalCents = Math.round(input.total_amount * 100);
  const sumCents = input.splits.reduce(
    (acc, s) => acc + Math.round(s.amount * 100),
    0
  );
  if (sumCents !== totalCents) {
    return {
      ok: false,
      error: "sum_mismatch",
      got: sumCents / 100,
      expected: totalCents / 100,
    };
  }
  const date = new Date().toISOString().slice(0, 10);
  // Step 1: create the parent transaction with no category (will be promoted
  // to a split parent in step 2). Memo lives on the parent only — per-split
  // memo input is deferred (see plan deferred section).
  const parent = await createTransaction({
    date,
    payee: (input.payee ?? "").trim(),
    amount: input.total_amount,
    account_id: input.account_id,
    memo: input.memo,
    cleared: false,
    source: "quick",
  });

  await saveSplits(parent.id, input.splits);
  revalidatePath("/quick");
  return { ok: true, parent };
}

/**
 * Create a transfer pair from /quick. Thin wrapper around
 * `createTransferPairWithSnapshot` that defaults the date to today and
 * additionally revalidates `/quick` (the wrapped action already revalidates
 * `/`). Fire-and-forget like `createQuickTransaction` — /quick has no
 * toolbar undo stack today, so we deliberately don't return into a
 * `useUndoRedo` hook from the mobile form.
 */
export async function createQuickTransfer(input: {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date?: string;
  memo?: string;
}): Promise<TransferPairSnapshot> {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const snapshot = await createTransferPairWithSnapshot({
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amount: input.amount,
    date,
    memo: input.memo,
    // Both legs of the pair are stamped 'quick' so the Recent list + the
    // /transactions Payee-cell phone icon correctly attribute mobile
    // transfers to /quick.
    source: "quick",
  });
  revalidatePath("/quick");
  return snapshot;
}

/**
 * Edit a transaction from /quick. Delegates to the existing
 * `updateTransaction` / `saveSplits` / `removeSplits` actions so balance
 * reconciliation, payee learning, and transactional integrity are inherited.
 *
 * - `splits` of length >= 2 → promote to split parent (sum-of-splits must
 *   equal the signed total, mirroring `createQuickSplitTransaction`).
 * - `splits` omitted / length < 2 with `wasSplitParent` → demote: write
 *   `category_id` on the parent and clear `transaction_splits`.
 * - Otherwise a plain single-category edit.
 */
export async function updateQuickTransaction(input: {
  id: string;
  amount: number;
  account_id: string;
  category_id: string | null;
  splits?: { category_id: string; amount: number }[];
  payee?: string;
  // undefined = no-op; null or "" = clear; string = set.
  memo?: string | null;
  wasSplitParent: boolean;
}): Promise<QuickUpdateResult> {
  const trimmedPayee = (input.payee ?? "").trim();
  const isSplit = !!input.splits && input.splits.length >= 2;

  if (isSplit) {
    const splits = input.splits!;
    const totalCents = Math.round(input.amount * 100);
    const sumCents = splits.reduce(
      (acc, s) => acc + Math.round(s.amount * 100),
      0
    );
    if (sumCents !== totalCents) {
      return {
        ok: false,
        error: "sum_mismatch",
        got: sumCents / 100,
        expected: totalCents / 100,
      };
    }
    // Update parent fields first (balance + account + payee). Skip
    // `category_id` so the existing NULL/about-to-be-NULL parent category is
    // preserved; `saveSplits` clears it explicitly anyway.
    await updateTransaction(input.id, {
      amount: input.amount,
      account_id: input.account_id,
      payee: trimmedPayee,
      ...(input.memo !== undefined ? { memo: input.memo } : {}),
    });
    await saveSplits(input.id, splits);
  } else {
    await updateTransaction(input.id, {
      amount: input.amount,
      account_id: input.account_id,
      category_id: input.category_id,
      payee: trimmedPayee,
      ...(input.memo !== undefined ? { memo: input.memo } : {}),
    });
    if (input.wasSplitParent) {
      // Demote back to a single-category transaction: clear the split rows
      // and set the parent's category_id.
      await removeSplits(input.id, input.category_id);
    }
  }

  revalidatePath("/quick");
  return { ok: true };
}

export async function deleteQuickTransaction(id: string) {
  await deleteTransaction(id);
  revalidatePath("/quick");
}
