"use server";

import { getDb, DEFAULT_USER_ID } from "@/lib/db";
import { newId, now, mapRows, roundCents } from "@/lib/db-utils";
// `now` and `roundCents` are used throughout; roundCents intentionally NOT
// applied to the archive sweep (money stays REAL — see archive actions below).
import { revalidatePath } from "next/cache";
import { prevMonth } from "@/lib/format";
import { computeBudgetMonth } from "@/lib/budget-engine";
import { computeCategoryUnderfunded } from "@/lib/target-utils";
import { getBudgetStartMonth, setSetting } from "@/lib/app-settings";
import {
  ONBOARDING_DISMISSED_KEY,
  ONBOARDING_TRANSFER_PLAN_SEEN_KEY,
} from "@/lib/onboarding";
import type { BudgetInput } from "@/lib/budget-engine";
import type {
  CategoryGroup,
  Category,
  CategoryWithBudget,
  MonthlyBudget,
  Transaction,
  TransactionSplit,
  Target,
} from "@/lib/types";

export async function getBudgetData(month: string): Promise<BudgetInput> {
  const db = getDb();

  // Calculate month end for transaction filtering
  const monthDate = new Date(month + "T00:00:00");
  const monthEnd = new Date(monthDate);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setDate(0);
  const monthEndStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;

  const categoryGroups = mapRows<CategoryGroup>(
    db.prepare("SELECT * FROM category_groups WHERE user_id = ? ORDER BY sort_order").all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );
  const categories = mapRows<Category>(
    db.prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order").all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );
  // Fetch ALL months (not just <= current). The engine needs future-month
  // assigned rows to compute `futureAssigned` — a positive month's Ready to
  // Assign drains toward zero by money already assigned in later months
  // (single pool). Every other consumer of monthlyBudgets guards on month
  // internally (<= monthStr, === monthStr, <= prevMonthStr), so the extra
  // future rows are inert for them.
  const monthlyBudgets = mapRows<MonthlyBudget>(
    db.prepare("SELECT * FROM monthly_budgets WHERE user_id = ?").all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );
  const transactions = mapRows<Transaction>(
    db.prepare("SELECT * FROM transactions WHERE user_id = ? AND date <= ?").all(DEFAULT_USER_ID, monthEndStr) as Record<string, unknown>[]
  );
  const splits = mapRows<TransactionSplit>(
    db.prepare("SELECT * FROM transaction_splits").all() as Record<string, unknown>[]
  );
  const targets = mapRows<Target>(
    db.prepare("SELECT * FROM targets WHERE user_id = ?").all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );

  // Optional user-entered income forecast for this month. No row → null (unset).
  const forecastRow = db
    .prepare(
      "SELECT expected_income FROM monthly_income_forecast WHERE user_id = ? AND month = ?"
    )
    .get(DEFAULT_USER_ID, month) as { expected_income: number } | undefined;

  return {
    month,
    categoryGroups,
    categories,
    monthlyBudgets,
    transactions,
    splits,
    targets,
    budgetStartMonth: getBudgetStartMonth(),
    expectedIncome: forecastRow ? forecastRow.expected_income : null,
  };
}

/**
 * Upsert (or clear) the expected-income forecast for a month. Pass `null` to
 * remove the forecast entirely — the panel then falls back to recorded income.
 * Simple old/new-value undo lives on the caller (expected-income-input.tsx);
 * no snapshot variant needed for a single scalar.
 */
export async function updateExpectedIncome(
  month: string,
  amount: number | null
) {
  const db = getDb();

  if (amount === null) {
    db.prepare(
      "DELETE FROM monthly_income_forecast WHERE user_id = ? AND month = ?"
    ).run(DEFAULT_USER_ID, month);
  } else {
    db.prepare(
      `INSERT INTO monthly_income_forecast (id, user_id, month, expected_income)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, month)
       DO UPDATE SET expected_income = excluded.expected_income, updated_at = ?`
    ).run(newId(), DEFAULT_USER_ID, month, roundCents(amount), now());
  }

  revalidatePath("/budget");
}

export async function updateAssigned(
  categoryId: string,
  month: string,
  amount: number
) {
  const db = getDb();

  db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  ).run(newId(), DEFAULT_USER_ID, categoryId, month, roundCents(amount));

  revalidatePath("/budget");
}

// ── Category Group CRUD ──────────────────────────────────────────────

export async function addCategoryGroup(name: string, id?: string) {
  const db = getDb();

  const minRow = db
    .prepare(
      "SELECT sort_order FROM category_groups WHERE user_id = ? AND is_system = 0 ORDER BY sort_order ASC LIMIT 1"
    )
    .get(DEFAULT_USER_ID) as { sort_order: number } | undefined;

  // Caller may supply a stable id so undo/redo can recreate the same row.
  const groupId = id ?? newId();
  db.prepare(
    `INSERT OR IGNORE INTO category_groups (id, user_id, name, sort_order, is_income)
     VALUES (?, ?, ?, ?, ?)`
  ).run(groupId, DEFAULT_USER_ID, name, (minRow?.sort_order ?? 1) - 1, 0);

  revalidatePath("/budget");
  return groupId;
}

export async function renameCategoryGroup(groupId: string, name: string) {
  const db = getDb();

  db.prepare(
    "UPDATE category_groups SET name = ? WHERE id = ? AND user_id = ?"
  ).run(name, groupId, DEFAULT_USER_ID);

  revalidatePath("/budget");
}

export async function deleteCategoryGroup(groupId: string) {
  const db = getDb();

  db.transaction(() => {
    // Deleting a group cascades to its categories, so the same assign-history
    // rule applies to every child.
    const childIds = (
      db
        .prepare(
          "SELECT id FROM categories WHERE category_group_id = ? AND user_id = ?"
        )
        .all(groupId, DEFAULT_USER_ID) as { id: string }[]
    ).map((r) => r.id);

    assertNoAssignHistory(childIds);
    clearEmptyAssignRows(childIds);

    db.prepare(
      "DELETE FROM category_groups WHERE id = ? AND user_id = ?"
    ).run(groupId, DEFAULT_USER_ID);
  })();

  revalidatePath("/budget");
}

export async function reorderCategoryGroup(
  groupId: string,
  direction: "up" | "down"
) {
  const db = getDb();

  const groups = db
    .prepare(
      "SELECT id, sort_order FROM category_groups WHERE user_id = ? ORDER BY sort_order"
    )
    .all(DEFAULT_USER_ID) as { id: string; sort_order: number }[];

  if (!groups) return;

  const idx = groups.findIndex((g) => g.id === groupId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= groups.length) return;

  const a = groups[idx];
  const b = groups[swapIdx];

  db.transaction(() => {
    db.prepare("UPDATE category_groups SET sort_order = ? WHERE id = ?").run(
      b.sort_order,
      a.id
    );
    db.prepare("UPDATE category_groups SET sort_order = ? WHERE id = ?").run(
      a.sort_order,
      b.id
    );
  })();

  revalidatePath("/budget");
}

// ── Category CRUD ────────────────────────────────────────────────────

export async function addCategory(groupId: string, name: string, id?: string) {
  const db = getDb();

  const minRow = db
    .prepare(
      "SELECT sort_order FROM categories WHERE category_group_id = ? ORDER BY sort_order ASC LIMIT 1"
    )
    .get(groupId) as { sort_order: number } | undefined;

  // Caller may supply a stable id so undo/redo can recreate the same row.
  const categoryId = id ?? newId();
  db.prepare(
    `INSERT OR IGNORE INTO categories (id, user_id, category_group_id, name, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  ).run(categoryId, DEFAULT_USER_ID, groupId, name, (minRow?.sort_order ?? 1) - 1);

  revalidatePath("/budget");
  return categoryId;
}

export async function renameCategory(categoryId: string, name: string) {
  const db = getDb();

  db.prepare(
    "UPDATE categories SET name = ? WHERE id = ? AND user_id = ?"
  ).run(name, categoryId, DEFAULT_USER_ID);

  revalidatePath("/budget");
}

// ── Assign-history guard (see migration 029) ─────────────────────────
//
// `monthly_budgets.category_id` is ON DELETE RESTRICT, so removing a category
// that still has assign rows now fails at the database rather than silently
// erasing the history and inflating Ready to Assign. These two helpers are how
// the delete paths stay on the right side of that: refuse when the history
// holds money, and clear the rows that don't.
//
// A row with `assigned = 0` contributes nothing to the engine's all-months
// `totalAssigned` sum, so dropping it moves no money — that's the ordinary
// "assigned $50, then undid it" residue, and it must not block undoing an add.
// Neither helper filters by user_id: any surviving row would trip the FK, so
// what matters is that every row for these categories is accounted for.
//
// The throw below is log-only in practice. Both callers are undo `backward`
// functions (undo "Add category" / "Add group"), and `useUndoRedo`'s onError
// in budget-table swaps in a generic toast because Next redacts server-action
// error text in production. Write it for whoever reads the server log, not for
// the user — they get "Nothing changed."

function assertNoAssignHistory(categoryIds: string[]): void {
  if (categoryIds.length === 0) return;
  const db = getDb();

  const funded = db
    .prepare(
      `SELECT DISTINCT c.name AS name
         FROM monthly_budgets b
         JOIN categories c ON c.id = b.category_id
        WHERE b.category_id IN (${inClause(categoryIds.length)})
          AND b.assigned <> 0`
    )
    .all(...categoryIds) as { name: string }[];

  if (funded.length > 0) {
    throw new Error(
      `Cannot delete ${funded.map((r) => r.name).join(", ")} — ` +
        `it has budget history that would be lost. Use the category's own ` +
        `delete menu item (bulkDeleteCategoriesWithSnapshot), which asks ` +
        `where the money and transactions go and merges the history there.`
    );
  }
}

function clearEmptyAssignRows(categoryIds: string[]): void {
  if (categoryIds.length === 0) return;
  const db = getDb();

  db.prepare(
    `DELETE FROM monthly_budgets WHERE category_id IN (${inClause(categoryIds.length)})`
  ).run(...categoryIds);
}

export async function deleteCategory(categoryId: string) {
  const db = getDb();

  db.transaction(() => {
    assertNoAssignHistory([categoryId]);
    clearEmptyAssignRows([categoryId]);

    db.prepare(
      "DELETE FROM categories WHERE id = ? AND user_id = ?"
    ).run(categoryId, DEFAULT_USER_ID);
  })();

  revalidatePath("/budget");
}

// ── Bulk Category/Group Deletion (with snapshot for undo) ────────────

export type CategoryDeletionSnapshot = {
  groups: CategoryGroup[];
  categories: Category[];
  monthlyBudgets: MonthlyBudget[];
  targets: Target[];
  transactionCategoryIds: { id: string; categoryId: string | null }[];
  splitCategoryIds: { id: string; categoryId: string | null }[];
  payeeDefaults: { id: string; defaultCategoryId: string | null }[];
  // The category the budget history was merged into, if any. Restore subtracts
  // the merged amounts back out of it; the amounts themselves are already in
  // `monthlyBudgets`, which is what was merged.
  reassignedTo: string | null;
};

type BulkDeleteCategoriesInput = {
  categoryIds: string[];
  groupIds: string[];
  reassignToCategoryId: string | null;
};

function inClause(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

export async function getCategoryDeletionImpact(
  categoryIds: string[],
  groupIds: string[] = []
): Promise<{
  transactionCount: number;
  splitCount: number;
  categoryCount: number;
  // Months of assign history across the selection. Non-zero means a delete
  // without a reassignment target is refused — the history has nowhere to go
  // and dropping it would inflate Ready to Assign. Callers use this to make
  // the reassign picker required rather than letting the user hit the error.
  budgetHistoryCount: number;
}> {
  if (categoryIds.length === 0 && groupIds.length === 0) {
    return {
      transactionCount: 0,
      splitCount: 0,
      categoryCount: 0,
      budgetHistoryCount: 0,
    };
  }

  const db = getDb();
  const allIds = new Set(categoryIds);

  // Expand groupIds to their child categories
  if (groupIds.length > 0) {
    const childRows = db
      .prepare(
        `SELECT id FROM categories WHERE category_group_id IN (${inClause(groupIds.length)}) AND user_id = ?`
      )
      .all(...groupIds, DEFAULT_USER_ID) as { id: string }[];
    for (const row of childRows) allIds.add(row.id);
  }

  if (allIds.size === 0) {
    return {
      transactionCount: 0,
      splitCount: 0,
      categoryCount: 0,
      budgetHistoryCount: 0,
    };
  }

  const ids = Array.from(allIds);
  const txRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions WHERE category_id IN (${inClause(ids.length)}) AND user_id = ?`
    )
    .get(...ids, DEFAULT_USER_ID) as { n: number };
  const splitRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM transaction_splits WHERE category_id IN (${inClause(ids.length)})`
    )
    .get(...ids) as { n: number };

  const budgetRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM monthly_budgets WHERE category_id IN (${inClause(ids.length)}) AND user_id = ?`
    )
    .get(...ids, DEFAULT_USER_ID) as { n: number };

  return {
    transactionCount: txRow.n,
    splitCount: splitRow.n,
    categoryCount: ids.length,
    budgetHistoryCount: budgetRow.n,
  };
}

export async function bulkDeleteCategoriesWithSnapshot(
  input: BulkDeleteCategoriesInput
): Promise<CategoryDeletionSnapshot> {
  const { reassignToCategoryId } = input;
  // Filter system groups out — never delete the "Inflow/Ready to assign" group.
  const db = getDb();

  const groupIdsSafe = input.groupIds.length
    ? (db
        .prepare(
          `SELECT id FROM category_groups WHERE id IN (${inClause(input.groupIds.length)}) AND user_id = ? AND is_system = 0`
        )
        .all(...input.groupIds, DEFAULT_USER_ID) as { id: string }[]).map((r) => r.id)
    : [];

  const snapshot = db.transaction(() => {
    // Expand: child categories of groups being deleted
    const cascadingChildIds = groupIdsSafe.length
      ? (db
          .prepare(
            `SELECT id FROM categories WHERE category_group_id IN (${inClause(groupIdsSafe.length)}) AND user_id = ?`
          )
          .all(...groupIdsSafe, DEFAULT_USER_ID) as { id: string }[]).map((r) => r.id)
      : [];

    const allCategoryIds = Array.from(new Set([...input.categoryIds, ...cascadingChildIds]));

    // Guard: never reassign INTO a category that is being deleted.
    const reassignTarget =
      reassignToCategoryId && !allCategoryIds.includes(reassignToCategoryId)
        ? reassignToCategoryId
        : null;

    // ── Snapshot ──
    const groups: CategoryGroup[] = groupIdsSafe.length
      ? mapRows<CategoryGroup>(
          db
            .prepare(
              `SELECT * FROM category_groups WHERE id IN (${inClause(groupIdsSafe.length)}) AND user_id = ?`
            )
            .all(...groupIdsSafe, DEFAULT_USER_ID) as Record<string, unknown>[]
        )
      : [];

    const categories: Category[] = allCategoryIds.length
      ? mapRows<Category>(
          db
            .prepare(
              `SELECT * FROM categories WHERE id IN (${inClause(allCategoryIds.length)}) AND user_id = ?`
            )
            .all(...allCategoryIds, DEFAULT_USER_ID) as Record<string, unknown>[]
        )
      : [];

    const monthlyBudgets: MonthlyBudget[] = allCategoryIds.length
      ? mapRows<MonthlyBudget>(
          db
            .prepare(
              `SELECT * FROM monthly_budgets WHERE category_id IN (${inClause(allCategoryIds.length)}) AND user_id = ?`
            )
            .all(...allCategoryIds, DEFAULT_USER_ID) as Record<string, unknown>[]
        )
      : [];

    const targets: Target[] = allCategoryIds.length
      ? mapRows<Target>(
          db
            .prepare(
              `SELECT * FROM targets WHERE category_id IN (${inClause(allCategoryIds.length)}) AND user_id = ?`
            )
            .all(...allCategoryIds, DEFAULT_USER_ID) as Record<string, unknown>[]
        )
      : [];

    const transactionCategoryIds = allCategoryIds.length
      ? (db
          .prepare(
            `SELECT id, category_id FROM transactions WHERE category_id IN (${inClause(allCategoryIds.length)}) AND user_id = ?`
          )
          .all(...allCategoryIds, DEFAULT_USER_ID) as { id: string; category_id: string | null }[]).map(
          (r) => ({ id: r.id, categoryId: r.category_id })
        )
      : [];

    const splitCategoryIds = allCategoryIds.length
      ? (db
          .prepare(
            `SELECT id, category_id FROM transaction_splits WHERE category_id IN (${inClause(allCategoryIds.length)})`
          )
          .all(...allCategoryIds) as { id: string; category_id: string | null }[]).map(
          (r) => ({ id: r.id, categoryId: r.category_id })
        )
      : [];

    const payeeDefaults = allCategoryIds.length
      ? (db
          .prepare(
            `SELECT id, default_category_id FROM payees WHERE default_category_id IN (${inClause(allCategoryIds.length)}) AND user_id = ?`
          )
          .all(...allCategoryIds, DEFAULT_USER_ID) as { id: string; default_category_id: string | null }[]).map(
          (r) => ({ id: r.id, defaultCategoryId: r.default_category_id })
        )
      : [];

    // ── Reassign ──
    if (reassignTarget && allCategoryIds.length > 0) {
      const timestamp = now();
      db.prepare(
        `UPDATE transactions SET category_id = ?, updated_at = ? WHERE category_id IN (${inClause(allCategoryIds.length)}) AND user_id = ?`
      ).run(reassignTarget, timestamp, ...allCategoryIds, DEFAULT_USER_ID);
      db.prepare(
        `UPDATE transaction_splits SET category_id = ?, updated_at = ? WHERE category_id IN (${inClause(allCategoryIds.length)})`
      ).run(reassignTarget, timestamp, ...allCategoryIds);
      // Note: payees.default_category_id is intentionally NOT reassigned —
      // FK SET NULL preserves the user's payee→category default semantics.

      // Move the budget history too, or the money math breaks.
      //
      // The delete below drops every assign row these categories ever had —
      // via the explicit DELETE in the "Delete" block (it rode the FK cascade
      // until migration 029 changed it to RESTRICT; same effect either way,
      // which is why the merge here is what actually protects the money). The
      // budget engine derives Ready to Assign from `totalIncome −
      // totalAssigned`, summing assigned over ALL months — so losing those
      // rows makes it look like the money was never assigned and hands it back
      // as available. The error is the category's lifetime spending: the
      // balance genuinely should return, the part already spent should not.
      //
      // Merging the rows into the reassignment target keeps totalAssigned
      // exactly whole, which is the same thing the transactions above are
      // doing — the envelope is being merged, not discarded.
      const mergeBudget = db.prepare(
        `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(category_id, month) DO UPDATE SET
           assigned = assigned + excluded.assigned,
           updated_at = excluded.updated_at`
      );
      for (const b of monthlyBudgets) {
        mergeBudget.run(
          newId(),
          b.user_id,
          reassignTarget,
          b.month,
          b.assigned,
          timestamp,
          timestamp
        );
      }
    }

    // ── Guard ──
    // Without a reassignment target there is nowhere for the budget history to
    // go, and the cascade below would erase it — inflating Ready to Assign by
    // the category's lifetime spending, silently. Refuse instead. Categories
    // with no assign history (the "created it by mistake" case) delete freely.
    if (!reassignTarget && monthlyBudgets.length > 0) {
      const names = categories
        .filter((c) => monthlyBudgets.some((b) => b.category_id === c.id))
        .map((c) => c.name)
        .join(", ");
      throw new Error(
        `Cannot delete ${names} without choosing where its transactions go — ` +
          `it has budget history that would be lost.`
      );
    }

    // ── Delete ──
    if (allCategoryIds.length > 0) {
      // The budget rows have to go explicitly now. This used to ride the FK
      // cascade, but `monthly_budgets.category_id` is ON DELETE RESTRICT as of
      // migration 029, so the category delete below would fail with them still
      // present. By this point they are safe to drop: either they were merged
      // into `reassignTarget` above (the amounts live on there now), or the
      // guard proved there were none.
      db.prepare(
        `DELETE FROM monthly_budgets WHERE category_id IN (${inClause(allCategoryIds.length)})`
      ).run(...allCategoryIds);

      db.prepare(
        `DELETE FROM categories WHERE id IN (${inClause(allCategoryIds.length)}) AND user_id = ?`
      ).run(...allCategoryIds, DEFAULT_USER_ID);
    }
    if (groupIdsSafe.length > 0) {
      db.prepare(
        `DELETE FROM category_groups WHERE id IN (${inClause(groupIdsSafe.length)}) AND user_id = ?`
      ).run(...groupIdsSafe, DEFAULT_USER_ID);
    }

    return {
      groups,
      categories,
      monthlyBudgets,
      targets,
      transactionCategoryIds,
      splitCategoryIds,
      payeeDefaults,
      reassignedTo: reassignTarget,
    } satisfies CategoryDeletionSnapshot;
  })();

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/transfer-plan");
  return snapshot;
}

export type CategoryRestoreResult = {
  ok: boolean;
  missingGroups: number;
  missingCategories: number;
};

// Returns what actually came back, because the inserts below can't tell you.
//
// Every insert here is `OR IGNORE` so that restoring twice doesn't blow up on
// a primary-key collision. But ON CONFLICT covers UNIQUE, NOT NULL, CHECK and
// PRIMARY KEY — so any of those failing skips the row with no error at all,
// and the restore would otherwise report success over a category that never
// came back. Foreign-key violations are NOT covered by ON CONFLICT: those
// throw and roll the whole transaction back, which is equally invisible unless
// the caller catches it (see useCategoryRestore).
//
// So verify the end state rather than trusting the writes: check that every id
// the snapshot expected is actually present. Presence (not `.changes`) is the
// right test — a legitimate repeat restore finds the rows already there, which
// is success, while a suppressed constraint failure leaves them missing.
export async function restoreCategoryDeletionSnapshot(
  snapshot: CategoryDeletionSnapshot
): Promise<CategoryRestoreResult> {
  const db = getDb();

  db.transaction(() => {
    // Restore groups first so categories' FK is satisfied
    const insertGroup = db.prepare(
      `INSERT OR IGNORE INTO category_groups (id, user_id, name, sort_order, is_income, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const g of snapshot.groups) {
      insertGroup.run(
        g.id,
        g.user_id,
        g.name,
        g.sort_order,
        g.is_income ? 1 : 0,
        g.is_system ? 1 : 0,
        g.created_at,
        g.updated_at
      );
    }

    const insertCategory = db.prepare(
      `INSERT OR IGNORE INTO categories (id, category_group_id, user_id, name, sort_order, archived, allocation_account_id, is_buffer, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of snapshot.categories) {
      insertCategory.run(
        c.id,
        c.category_group_id,
        c.user_id,
        c.name,
        c.sort_order,
        c.archived ? 1 : 0,
        c.allocation_account_id,
        c.is_buffer ? 1 : 0,
        c.created_at,
        c.updated_at
      );
    }

    // Take the merged history back out of the reassignment target BEFORE
    // re-inserting the originals, or the same dollars exist twice and Ready to
    // Assign drops by the merged amount. Not `OR IGNORE`-able: this is an
    // arithmetic reversal of the merge in bulkDeleteCategoriesWithSnapshot, and
    // it only holds because that merge added exactly these amounts.
    if (snapshot.reassignedTo) {
      const unmerge = db.prepare(
        `UPDATE monthly_budgets SET assigned = assigned - ?, updated_at = ?
         WHERE category_id = ? AND month = ? AND user_id = ?`
      );
      const timestamp = now();
      for (const b of snapshot.monthlyBudgets) {
        unmerge.run(
          b.assigned,
          timestamp,
          snapshot.reassignedTo,
          b.month,
          b.user_id
        );
      }
    }

    const insertBudget = db.prepare(
      `INSERT OR IGNORE INTO monthly_budgets (id, user_id, category_id, month, assigned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const b of snapshot.monthlyBudgets) {
      insertBudget.run(
        b.id,
        b.user_id,
        b.category_id,
        b.month,
        b.assigned,
        b.created_at,
        b.updated_at
      );
    }

    const insertTarget = db.prepare(
      `INSERT OR IGNORE INTO targets (id, user_id, category_id, type, frequency, target_amount, target_date, monthly_contribution, priority, recurring, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const t of snapshot.targets) {
      insertTarget.run(
        t.id,
        t.user_id,
        t.category_id,
        t.type,
        t.frequency,
        t.target_amount,
        t.target_date,
        t.monthly_contribution,
        t.priority,
        t.recurring ? 1 : 0,
        t.created_at,
        t.updated_at
      );
    }

    // Restore transaction/split/payee category pointers
    const updateTxn = db.prepare(
      `UPDATE transactions SET category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    );
    const timestamp = now();
    for (const t of snapshot.transactionCategoryIds) {
      updateTxn.run(t.categoryId, timestamp, t.id, DEFAULT_USER_ID);
    }

    const updateSplit = db.prepare(
      `UPDATE transaction_splits SET category_id = ?, updated_at = ? WHERE id = ?`
    );
    for (const s of snapshot.splitCategoryIds) {
      updateSplit.run(s.categoryId, timestamp, s.id);
    }

    const updatePayee = db.prepare(
      `UPDATE payees SET default_category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    );
    for (const p of snapshot.payeeDefaults) {
      updatePayee.run(p.defaultCategoryId, timestamp, p.id, DEFAULT_USER_ID);
    }
  })();

  const countPresent = (table: "category_groups" | "categories", ids: string[]) => {
    if (ids.length === 0) return 0;
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE id IN (${inClause(ids.length)}) AND user_id = ?`
      )
      .get(...ids, DEFAULT_USER_ID) as { n: number };
    return row.n;
  };

  const groupIds = snapshot.groups.map((g) => g.id);
  const categoryIds = snapshot.categories.map((c) => c.id);
  const missingGroups = groupIds.length - countPresent("category_groups", groupIds);
  const missingCategories =
    categoryIds.length - countPresent("categories", categoryIds);

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/transfer-plan");

  return {
    ok: missingGroups === 0 && missingCategories === 0,
    missingGroups,
    missingCategories,
  };
}

export async function reorderCategory(
  categoryId: string,
  groupId: string,
  direction: "up" | "down"
) {
  const db = getDb();

  const categories = db
    .prepare(
      "SELECT id, sort_order FROM categories WHERE category_group_id = ? AND user_id = ? ORDER BY sort_order"
    )
    .all(groupId, DEFAULT_USER_ID) as { id: string; sort_order: number }[];

  if (!categories) return;

  const idx = categories.findIndex((c) => c.id === categoryId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= categories.length) return;

  const a = categories[idx];
  const b = categories[swapIdx];

  db.transaction(() => {
    db.prepare("UPDATE categories SET sort_order = ? WHERE id = ?").run(
      b.sort_order,
      a.id
    );
    db.prepare("UPDATE categories SET sort_order = ? WHERE id = ?").run(
      a.sort_order,
      b.id
    );
  })();

  revalidatePath("/budget");
}

export async function reorderCategoryGroups(orderedGroupIds: string[]) {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE category_groups SET sort_order = ? WHERE id = ? AND user_id = ?"
  );
  db.transaction(() => {
    orderedGroupIds.forEach((id, idx) => {
      stmt.run(idx, id, DEFAULT_USER_ID);
    });
  })();
  revalidatePath("/budget");
}

export async function reorderCategoriesInGroup(
  groupId: string,
  orderedCategoryIds: string[]
) {
  const db = getDb();

  const stmt = db.prepare(
    "UPDATE categories SET sort_order = ? WHERE id = ? AND user_id = ?"
  );

  db.transaction(() => {
    orderedCategoryIds.forEach((id, idx) => {
      stmt.run(idx, id, DEFAULT_USER_ID);
    });
  })();

  revalidatePath("/budget");
}

export async function moveCategoryToGroup(
  categoryId: string,
  newGroupId: string,
  newSortOrder?: number
): Promise<{ oldGroupId: string; oldSortOrder: number }> {
  const db = getDb();

  const current = db
    .prepare("SELECT category_group_id, sort_order FROM categories WHERE id = ?")
    .get(categoryId) as
    | { category_group_id: string; sort_order: number }
    | undefined;
  if (!current) throw new Error("Category not found");

  let sortOrder = newSortOrder;
  if (sortOrder === undefined) {
    const maxRow = db
      .prepare(
        "SELECT sort_order FROM categories WHERE category_group_id = ? ORDER BY sort_order DESC LIMIT 1"
      )
      .get(newGroupId) as { sort_order: number } | undefined;
    sortOrder = (maxRow?.sort_order ?? -1) + 1;
  }

  db.prepare(
    "UPDATE categories SET category_group_id = ?, sort_order = ? WHERE id = ? AND user_id = ?"
  ).run(newGroupId, sortOrder, categoryId, DEFAULT_USER_ID);

  revalidatePath("/budget");
  return {
    oldGroupId: current.category_group_id,
    oldSortOrder: current.sort_order,
  };
}

// ──────────────────────────────────────────────────────────────
// Target CRUD
// ──────────────────────────────────────────────────────────────

export type TargetInput = {
  type: "monthly_funding" | "savings_balance" | "target_by_date" | "spending";
  frequency: "weekly" | "monthly" | "yearly" | "custom";
  target_amount: number;
  target_date?: string | null;
  monthly_contribution?: number | null;
  recurring: boolean;
};

export async function createTarget(
  categoryId: string,
  data: TargetInput
): Promise<string> {
  const db = getDb();

  const id = newId();
  db.prepare(
    `INSERT INTO targets (id, user_id, category_id, type, frequency, target_amount, target_date, monthly_contribution, recurring)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    DEFAULT_USER_ID,
    categoryId,
    data.type,
    data.frequency,
    data.target_amount,
    data.target_date ?? null,
    data.monthly_contribution ?? null,
    data.recurring ? 1 : 0
  );

  revalidatePath("/budget");
  return id;
}

export async function updateTarget(
  targetId: string,
  data: Partial<TargetInput>
): Promise<void> {
  const db = getDb();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.type !== undefined) {
    fields.push("type = ?");
    values.push(data.type);
  }
  if (data.frequency !== undefined) {
    fields.push("frequency = ?");
    values.push(data.frequency);
  }
  if (data.target_amount !== undefined) {
    fields.push("target_amount = ?");
    values.push(data.target_amount);
  }
  if (data.target_date !== undefined) {
    fields.push("target_date = ?");
    values.push(data.target_date ?? null);
  }
  if (data.monthly_contribution !== undefined) {
    fields.push("monthly_contribution = ?");
    values.push(data.monthly_contribution ?? null);
  }
  if (data.recurring !== undefined) {
    fields.push("recurring = ?");
    values.push(data.recurring ? 1 : 0);
  }

  fields.push("updated_at = ?");
  values.push(now());

  values.push(targetId, DEFAULT_USER_ID);

  db.prepare(
    `UPDATE targets SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`
  ).run(...values);

  revalidatePath("/budget");
}

// The whole target row, captured before deletion so an undo can put every
// field back — amount, type, frequency, date, recurring/priority — not just
// re-create a blank goal. Deleting a target is destructive with no on-screen
// number to show it, so its call site pairs this with an Undo toast rather
// than a confirm (system-visibility rule).
export type TargetSnapshot = {
  id: string;
  category_id: string;
  type: string;
  frequency: string | null;
  target_amount: number;
  target_date: string | null;
  monthly_contribution: number | null;
  priority: number | null;
  // Stored 0/1 — carried verbatim so undo restores the recurring flag, not the
  // column default. Dropping it silently un-repeated a yearly/refill target.
  recurring: number;
  created_at: string;
  updated_at: string;
};

export async function deleteTargetWithSnapshot(
  targetId: string
): Promise<TargetSnapshot | null> {
  const db = getDb();

  const row = db
    .prepare(
      `SELECT id, category_id, type, frequency, target_amount, target_date,
              monthly_contribution, priority, recurring, created_at, updated_at
       FROM targets WHERE id = ? AND user_id = ?`
    )
    .get(targetId, DEFAULT_USER_ID) as TargetSnapshot | undefined;

  if (!row) return null;

  db.prepare("DELETE FROM targets WHERE id = ? AND user_id = ?").run(
    targetId,
    DEFAULT_USER_ID
  );

  revalidatePath("/budget");
  return row;
}

export async function restoreTarget(snapshot: TargetSnapshot): Promise<void> {
  const db = getDb();

  // Re-insert the exact row, preserving id and timestamps. ON CONFLICT keeps
  // undo idempotent if the row somehow still exists (e.g. a double-fire).
  db.prepare(
    `INSERT INTO targets (id, user_id, category_id, type, frequency, target_amount,
                          target_date, monthly_contribution, priority, recurring, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type = excluded.type,
       frequency = excluded.frequency,
       target_amount = excluded.target_amount,
       target_date = excluded.target_date,
       monthly_contribution = excluded.monthly_contribution,
       priority = excluded.priority,
       recurring = excluded.recurring,
       updated_at = excluded.updated_at`
  ).run(
    snapshot.id,
    DEFAULT_USER_ID,
    snapshot.category_id,
    snapshot.type,
    snapshot.frequency,
    snapshot.target_amount,
    snapshot.target_date,
    snapshot.monthly_contribution,
    snapshot.priority,
    snapshot.recurring,
    snapshot.created_at,
    snapshot.updated_at
  );

  revalidatePath("/budget");
}

// ── Auto-Assign Actions ─────────────────────────────────────────────

export async function copyLastMonthBudget(month: string) {
  const db = getDb();

  const prev = prevMonth(month);

  const prevBudgets = db
    .prepare(
      "SELECT category_id, assigned FROM monthly_budgets WHERE month = ? AND user_id = ?"
    )
    .all(prev, DEFAULT_USER_ID) as { category_id: string; assigned: number }[];

  if (!prevBudgets || prevBudgets.length === 0) return;

  const stmt = db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  );

  db.transaction(() => {
    for (const row of prevBudgets) {
      stmt.run(newId(), DEFAULT_USER_ID, row.category_id, month, row.assigned);
    }
  })();

  revalidatePath("/budget");
}

// ── Category Settings (account assignment + buffer) ─────────────────

export type CategorySettingsSnapshot = {
  categoryId: string;
  previousAllocationAccountId: string | null;
  previousIsBuffer: boolean;
  previousPinnedQuick: boolean;
};

const MAX_PINNED_PER_BUCKET = 3;

// Throws if turning a pin ON would exceed the per-bucket cap (3 expense, 3 income).
// Returns silently when pinning off, when already pinned, or when under the cap.
function assertPinCapacity(
  db: ReturnType<typeof getDb>,
  categoryId: string,
  wantPinned: boolean
) {
  if (!wantPinned) return;
  const row = db
    .prepare(
      `SELECT c.pinned_quick, cg.is_income
         FROM categories c
         JOIN category_groups cg ON cg.id = c.category_group_id
        WHERE c.id = ? AND c.user_id = ?`
    )
    .get(categoryId, DEFAULT_USER_ID) as
    | { pinned_quick: number; is_income: number }
    | undefined;
  if (!row) throw new Error(`Category ${categoryId} not found`);
  if (row.pinned_quick === 1) return; // already pinned — no-op
  const bucketIsIncome = row.is_income === 1 ? 1 : 0;
  const count = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM categories c
         JOIN category_groups cg ON cg.id = c.category_group_id
        WHERE c.user_id = ? AND c.pinned_quick = 1 AND cg.is_income = ?`
    )
    .get(DEFAULT_USER_ID, bucketIsIncome) as { n: number };
  if (count.n >= MAX_PINNED_PER_BUCKET) {
    throw new Error(
      `Only ${MAX_PINNED_PER_BUCKET} categories can be pinned to mobile quick-add per bucket. Unpin another first.`
    );
  }
}

export async function updateCategorySettings(
  categoryId: string,
  allocationAccountId: string | null,
  isBuffer: boolean,
  pinnedQuick: boolean
) {
  const db = getDb();
  assertPinCapacity(db, categoryId, pinnedQuick);
  const timestamp = now();
  db.prepare(
    `UPDATE categories SET allocation_account_id = ?, is_buffer = ?, pinned_quick = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(allocationAccountId, isBuffer ? 1 : 0, pinnedQuick ? 1 : 0, timestamp, categoryId, DEFAULT_USER_ID);
  revalidatePath("/budget");
  revalidatePath("/transfer-plan");
  revalidatePath("/quick");
}

export async function updateCategorySettingsWithSnapshot(
  categoryId: string,
  allocationAccountId: string | null,
  isBuffer: boolean,
  pinnedQuick: boolean
): Promise<CategorySettingsSnapshot> {
  const db = getDb();
  const snapshot = db.transaction(() => {
    const current = db.prepare(
      "SELECT allocation_account_id, is_buffer, pinned_quick FROM categories WHERE id = ? AND user_id = ?"
    ).get(categoryId, DEFAULT_USER_ID) as
      | { allocation_account_id: string | null; is_buffer: number; pinned_quick: number }
      | undefined;
    if (!current) throw new Error(`Category ${categoryId} not found`);
    assertPinCapacity(db, categoryId, pinnedQuick);
    const snap: CategorySettingsSnapshot = {
      categoryId,
      previousAllocationAccountId: current.allocation_account_id,
      previousIsBuffer: current.is_buffer === 1,
      previousPinnedQuick: current.pinned_quick === 1,
    };
    const timestamp = now();
    db.prepare(
      `UPDATE categories SET allocation_account_id = ?, is_buffer = ?, pinned_quick = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).run(allocationAccountId, isBuffer ? 1 : 0, pinnedQuick ? 1 : 0, timestamp, categoryId, DEFAULT_USER_ID);
    return snap;
  })();
  revalidatePath("/budget");
  revalidatePath("/transfer-plan");
  revalidatePath("/quick");
  return snapshot;
}

export async function restoreCategorySettings(snapshot: CategorySettingsSnapshot) {
  const db = getDb();
  const timestamp = now();
  db.prepare(
    `UPDATE categories SET allocation_account_id = ?, is_buffer = ?, pinned_quick = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(
    snapshot.previousAllocationAccountId,
    snapshot.previousIsBuffer ? 1 : 0,
    snapshot.previousPinnedQuick ? 1 : 0,
    timestamp,
    snapshot.categoryId,
    DEFAULT_USER_ID
  );
  revalidatePath("/budget");
  revalidatePath("/transfer-plan");
  revalidatePath("/quick");
}

// Free-form category notes. Saved on blur from the detail panel's Notes tab.
// Snapshot returns the previous text so the edit is undoable like everything
// else in the panel.
export async function updateCategoryNotesWithSnapshot(
  categoryId: string,
  notes: string
): Promise<{ previous: string }> {
  const db = getDb();
  const row = db.prepare(
    "SELECT notes FROM categories WHERE id = ? AND user_id = ?"
  ).get(categoryId, DEFAULT_USER_ID) as { notes: string } | undefined;
  if (!row) throw new Error(`Category ${categoryId} not found`);
  db.prepare(
    "UPDATE categories SET notes = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(notes, now(), categoryId, DEFAULT_USER_ID);
  revalidatePath("/budget");
  return { previous: row.notes };
}

export async function restoreCategoryNotes(categoryId: string, notes: string) {
  const db = getDb();
  db.prepare(
    "UPDATE categories SET notes = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(notes, now(), categoryId, DEFAULT_USER_ID);
  revalidatePath("/budget");
}

// Bulk reassignment of allocation_account_id across many categories.
// is_buffer is intentionally NOT touched here — single-row dialog still owns
// that toggle. Snapshots still capture is_buffer so the restore path produces
// a perfect undo even if a future feature widens the bulk write.
export async function bulkUpdateCategorySettings(
  categoryIds: string[],
  allocationAccountId: string | null
): Promise<void> {
  if (categoryIds.length === 0) return;
  const db = getDb();
  const timestamp = now();
  const stmt = db.prepare(
    `UPDATE categories SET allocation_account_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  );
  db.transaction(() => {
    for (const id of categoryIds) {
      stmt.run(allocationAccountId, timestamp, id, DEFAULT_USER_ID);
    }
  })();
  revalidatePath("/budget");
  revalidatePath("/transfer-plan");
}

export async function bulkUpdateCategorySettingsWithSnapshot(
  categoryIds: string[],
  allocationAccountId: string | null
): Promise<CategorySettingsSnapshot[]> {
  if (categoryIds.length === 0) return [];
  const db = getDb();
  const timestamp = now();
  const selectStmt = db.prepare(
    "SELECT allocation_account_id, is_buffer, pinned_quick FROM categories WHERE id = ? AND user_id = ?"
  );
  const updateStmt = db.prepare(
    `UPDATE categories SET allocation_account_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  );
  const snapshots = db.transaction(() => {
    const out: CategorySettingsSnapshot[] = [];
    for (const id of categoryIds) {
      const current = selectStmt.get(id, DEFAULT_USER_ID) as
        | { allocation_account_id: string | null; is_buffer: number; pinned_quick: number }
        | undefined;
      if (!current) throw new Error(`Category ${id} not found`);
      out.push({
        categoryId: id,
        previousAllocationAccountId: current.allocation_account_id,
        previousIsBuffer: current.is_buffer === 1,
        previousPinnedQuick: current.pinned_quick === 1,
      });
      updateStmt.run(allocationAccountId, timestamp, id, DEFAULT_USER_ID);
    }
    return out;
  })();
  revalidatePath("/budget");
  revalidatePath("/transfer-plan");
  return snapshots;
}

export async function restoreCategorySettingsBatch(
  snapshots: CategorySettingsSnapshot[]
): Promise<void> {
  if (snapshots.length === 0) return;
  const db = getDb();
  const timestamp = now();
  const stmt = db.prepare(
    `UPDATE categories SET allocation_account_id = ?, is_buffer = ?, pinned_quick = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  );
  db.transaction(() => {
    for (const s of snapshots) {
      stmt.run(
        s.previousAllocationAccountId,
        s.previousIsBuffer ? 1 : 0,
        s.previousPinnedQuick ? 1 : 0,
        timestamp,
        s.categoryId,
        DEFAULT_USER_ID
      );
    }
  })();
  revalidatePath("/budget");
  revalidatePath("/transfer-plan");
  revalidatePath("/quick");
}

// ── Auto-Assign Actions ─────────────────────────────────────────────

type AssignedSnapshot = { category_id: string; assigned: number }[];

export async function restoreAssignedSnapshot(
  month: string,
  snapshot: AssignedSnapshot
) {
  const db = getDb();

  const stmt = db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  );

  db.transaction(() => {
    for (const row of snapshot) {
      stmt.run(newId(), DEFAULT_USER_ID, row.category_id, month, row.assigned);
    }
  })();

  revalidatePath("/budget");
}

export type CopyLastMonthMode = "replace" | "fill-empty";

export type CopyLastMonthPreview = {
  /** Categories with an assignment this month that the copy would change. */
  overwriteCount: number;
  /** Sum of this month's assigned across those categories (what "replace" loses). */
  overwriteAssigned: number;
  /** Categories with nothing assigned this month that last month would fill. */
  fillCount: number;
};

// Pairs each category assigned last month with its current-month assigned,
// compared at cent precision (`assigned` is REAL — see roundCents).
function copyLastMonthRows(month: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT prev.category_id AS category_id,
              prev.assigned AS prev_assigned,
              COALESCE(cur.assigned, 0) AS cur_assigned
         FROM monthly_budgets prev
         LEFT JOIN monthly_budgets cur
           ON cur.category_id = prev.category_id
          AND cur.month = ? AND cur.user_id = prev.user_id
        WHERE prev.month = ? AND prev.user_id = ?`
    )
    .all(month, prevMonth(month), DEFAULT_USER_ID) as {
    category_id: string;
    prev_assigned: number;
    cur_assigned: number;
  }[];
}

const cents = (n: number) => Math.round(n * 100);

/**
 * What "Copy last month's budget" would do, so the UI can warn before it
 * overwrites work already assigned this month. Read-only.
 */
export async function getCopyLastMonthPreview(
  month: string
): Promise<CopyLastMonthPreview> {
  let overwriteCount = 0;
  let overwriteAssigned = 0;
  let fillCount = 0;
  for (const r of copyLastMonthRows(month)) {
    const cur = cents(r.cur_assigned);
    const prev = cents(r.prev_assigned);
    if (cur !== 0 && cur !== prev) {
      overwriteCount++;
      overwriteAssigned += r.cur_assigned;
    } else if (cur === 0 && prev !== 0) {
      fillCount++;
    }
  }
  return { overwriteCount, overwriteAssigned: roundCents(overwriteAssigned), fillCount };
}

/**
 * Copies last month's assigned amounts into `month`.
 * - "replace" (default): every category assigned last month gets that amount,
 *   overwriting whatever is assigned this month.
 * - "fill-empty": only categories with nothing assigned this month are touched,
 *   so work already done mid-month is kept.
 * Returns the prior values of every category it wrote (for undo), or null when
 * there was nothing to write.
 */
export async function copyLastMonthBudgetWithSnapshot(
  month: string,
  mode: CopyLastMonthMode = "replace"
) {
  const db = getDb();

  const rows = copyLastMonthRows(month).filter(
    (r) => mode === "replace" || cents(r.cur_assigned) === 0
  );
  if (rows.length === 0) return null;
  // Nothing would change in fill-empty mode when every candidate was $0 last
  // month too — report that as a no-op rather than an empty "copy".
  if (mode === "fill-empty" && rows.every((r) => cents(r.prev_assigned) === 0)) {
    return null;
  }

  const snapshot: AssignedSnapshot = rows.map((r) => ({
    category_id: r.category_id,
    assigned: r.cur_assigned,
  }));

  const stmt = db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  );

  db.transaction(() => {
    for (const r of rows) {
      stmt.run(newId(), DEFAULT_USER_ID, r.category_id, month, r.prev_assigned);
    }
  })();

  revalidatePath("/budget");
  return snapshot;
}

// Core for the bulk "Fund underfunded" action. `amountFor` returns how much to
// add to a category this month. Walks the budget and upserts `assigned + amount`,
// returning a snapshot for undo.
async function bulkAssignWithSnapshot(
  month: string,
  amountFor: (cat: CategoryWithBudget) => number,
) {
  const db = getDb();

  const budgetData = await getBudgetData(month);
  const budget = computeBudgetMonth(budgetData);

  const upserts: { category_id: string; assigned: number }[] = [];
  const snapshot: AssignedSnapshot = [];

  for (const group of budget.groups) {
    if (group.is_income) continue;
    for (const cat of group.categories) {
      const amount = amountFor(cat);
      if (amount <= 0) continue;
      snapshot.push({ category_id: cat.id, assigned: cat.assigned });
      upserts.push({
        category_id: cat.id,
        assigned: cat.assigned + amount,
      });
    }
  }

  if (upserts.length === 0) return null;

  const stmt = db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  );

  db.transaction(() => {
    for (const row of upserts) {
      stmt.run(newId(), DEFAULT_USER_ID, row.category_id, month, row.assigned);
    }
  })();

  revalidatePath("/budget");
  return snapshot;
}

export async function fundUnderfundedWithSnapshot(month: string) {
  return bulkAssignWithSnapshot(month, computeCategoryUnderfunded);
}

export type FundUnderfundedPreviewRow = {
  category_id: string;
  category_name: string;
  group_id: string;
  group_name: string;
  amount: number;
};

async function getBulkAssignPreview(
  month: string,
  amountFor: (cat: CategoryWithBudget) => number,
): Promise<FundUnderfundedPreviewRow[]> {
  const budgetData = await getBudgetData(month);
  const budget = computeBudgetMonth(budgetData);

  const rows: FundUnderfundedPreviewRow[] = [];
  for (const group of budget.groups) {
    if (group.is_income) continue;
    for (const cat of group.categories) {
      const amount = amountFor(cat);
      if (amount <= 0) continue;
      rows.push({
        category_id: cat.id,
        category_name: cat.name,
        group_id: group.id,
        group_name: group.name,
        amount,
      });
    }
  }
  return rows;
}

export async function getFundUnderfundedPreview(
  month: string,
): Promise<FundUnderfundedPreviewRow[]> {
  return getBulkAssignPreview(month, computeCategoryUnderfunded);
}

// ── Per-Category Auto-Assign ────────────────────────────────────────
//
// Auto-assign suggestion metrics (assigned/spent last month + trailing
// averages) are now precomputed by the budget engine and threaded down as
// `category.autoAssign`, so the panel renders them instantly with no per-click
// round-trip. See `computeBudgetMonth` in lib/budget-engine.ts.

export async function setCategoryAssignedWithSnapshot(
  categoryId: string,
  month: string,
  newAssigned: number
): Promise<{ previous: number }> {
  const db = getDb();

  const row = db
    .prepare(
      "SELECT assigned FROM monthly_budgets WHERE user_id = ? AND category_id = ? AND month = ?"
    )
    .get(DEFAULT_USER_ID, categoryId, month) as { assigned: number } | undefined;
  const previous = row?.assigned ?? 0;

  db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  ).run(newId(), DEFAULT_USER_ID, categoryId, month, newAssigned);

  revalidatePath("/budget");
  return { previous };
}

// ── Move Money Between Categories (popover) ──────────────
//
// Reallocates `amount` of THIS month's assigned dollars from one visible
// category to another visible category — or back to Ready to Assign. RTA is a
// virtual destination (no stored row): money flows back via the budget
// engine's `total_income - total_assigned` math, so when the destination is
// "RTA" we ONLY decrement the source row. Mirrors setCategoryAssignedWithSnapshot's
// upsert shape but operates on up to two rows inside a single db.transaction()
// so a partial failure can't leave the source decremented without the
// destination incremented.
//
// Money stays REAL per CLAUDE.md: roundCents only at the storage boundary,
// matching updateAssigned.

export type MoveMoneySnapshot = {
  month: string;
  sourceCategoryId: string;
  destCategoryId: string | "RTA";
  previousSourceAssigned: number;
  previousDestAssigned: number | null;
};

export async function moveMoneyBetweenCategoriesWithSnapshot(args: {
  sourceCategoryId: string;
  destCategoryId: string | "RTA";
  amount: number;
  month: string;
}): Promise<MoveMoneySnapshot> {
  const { sourceCategoryId, destCategoryId, amount, month } = args;

  if (sourceCategoryId === destCategoryId) {
    throw new Error("Source and destination categories must be different");
  }
  if (!Number.isFinite(amount)) {
    throw new Error("Move amount must be a finite number");
  }

  const db = getDb();

  const sourceRow = db
    .prepare(
      "SELECT assigned FROM monthly_budgets WHERE user_id = ? AND category_id = ? AND month = ?"
    )
    .get(DEFAULT_USER_ID, sourceCategoryId, month) as
    | { assigned: number }
    | undefined;
  const previousSourceAssigned = sourceRow?.assigned ?? 0;

  let previousDestAssigned: number | null = null;
  if (destCategoryId !== "RTA") {
    const destRow = db
      .prepare(
        "SELECT assigned FROM monthly_budgets WHERE user_id = ? AND category_id = ? AND month = ?"
      )
      .get(DEFAULT_USER_ID, destCategoryId, month) as
      | { assigned: number }
      | undefined;
    previousDestAssigned = destRow?.assigned ?? 0;
  }

  const upsert = db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  );

  db.transaction(() => {
    upsert.run(
      newId(),
      DEFAULT_USER_ID,
      sourceCategoryId,
      month,
      roundCents(previousSourceAssigned - amount)
    );
    if (destCategoryId !== "RTA") {
      upsert.run(
        newId(),
        DEFAULT_USER_ID,
        destCategoryId,
        month,
        roundCents((previousDestAssigned ?? 0) + amount)
      );
    }
  })();

  revalidatePath("/budget");

  return {
    month,
    sourceCategoryId,
    destCategoryId,
    previousSourceAssigned,
    previousDestAssigned,
  };
}

export async function restoreMoveMoneySnapshot(
  snapshot: MoveMoneySnapshot
): Promise<void> {
  const db = getDb();

  const upsert = db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  );

  db.transaction(() => {
    upsert.run(
      newId(),
      DEFAULT_USER_ID,
      snapshot.sourceCategoryId,
      snapshot.month,
      snapshot.previousSourceAssigned
    );
    if (
      snapshot.destCategoryId !== "RTA" &&
      snapshot.previousDestAssigned !== null
    ) {
      upsert.run(
        newId(),
        DEFAULT_USER_ID,
        snapshot.destCategoryId,
        snapshot.month,
        snapshot.previousDestAssigned
      );
    }
  })();

  revalidatePath("/budget");
}

// ── Category Archive / Unarchive (hide / unhide) ────────────────────
//
// NO migration is needed: the categories.archived INTEGER column has existed
// since 001_initial.sql. These actions mirror the account-side
// closeAccountWithSnapshot/reopenAccount flag flips (accounts/[id]/actions.ts),
// plus a
// balance sweep + snapshot so hide/unhide participate in the budget undo/redo
// stack.
//
// Hiding sweeps the category's CURRENT available balance (clamped >= 0) back to
// Ready to Assign by LOWERING the hide-month's assigned by exactly that amount.
// The swept value is read from the budget engine (computeBudgetMonth) so it
// matches the available displayed in the grid to the cent — same cutoff /
// split / income / system / starting-balance filters with zero drift risk.
// Money stays REAL per CLAUDE.md: the raw float newAssigned is written via the
// raw upsert SQL below, never rounded.

export type CategoryArchiveSnapshot = {
  categoryId: string;
  month: string;
  // The hide-month's assigned value BEFORE the sweep (0 if no row existed).
  previousAssigned: number;
};

export type CategoryUnarchiveSnapshot = {
  categoryId: string;
};

// Shared sweep used by BOTH the category-level archive and the group-level
// archive cascade. It does ONLY the sweep — it NEVER sets categories.archived.
// Must be called from inside an open db.transaction(). Reads the category's
// CURRENT available from the passed budget (derived engine state — do NOT
// hand-roll the cumulative math), lowers the hide-month assigned by
// max(0, available), and upserts the raw-float newAssigned (no roundCents —
// money stays REAL). Returns the snapshot record for undo.
function sweepCategoryToRTA(
  db: ReturnType<typeof getDb>,
  budget: ReturnType<typeof computeBudgetMonth>,
  categoryId: string,
  month: string
): CategoryArchiveSnapshot {
  let available = 0;
  for (const group of budget.groups) {
    const cat = group.categories.find((c) => c.id === categoryId);
    if (cat) {
      available = cat.available;
      break;
    }
  }

  const row = db
    .prepare(
      "SELECT assigned FROM monthly_budgets WHERE user_id = ? AND category_id = ? AND month = ?"
    )
    .get(DEFAULT_USER_ID, categoryId, month) as { assigned: number } | undefined;
  const previousAssigned = row?.assigned ?? 0;

  // Sweep the available balance (clamped >= 0) by lowering the hide-month
  // assigned. newAssigned may legitimately go negative when available came from
  // prior months — the engine sums it correctly. Overspent (negative available)
  // → sweepAmount 0 → assigned unchanged. Raw float, no rounding.
  const sweepAmount = Math.max(0, available);
  const newAssigned = previousAssigned - sweepAmount;

  db.prepare(
    `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
  ).run(newId(), DEFAULT_USER_ID, categoryId, month, newAssigned);

  return { categoryId, month, previousAssigned } satisfies CategoryArchiveSnapshot;
}

export async function archiveCategoryWithSnapshot(
  categoryId: string,
  month: string
): Promise<CategoryArchiveSnapshot> {
  const db = getDb();

  // Read the category's CURRENT available from the engine (derived state). The
  // category is still unarchived at read time, so it lives in budget.groups[].
  const budget = computeBudgetMonth(await getBudgetData(month));

  const snapshot = db.transaction(() => {
    // This category-level action keeps its OWN archived flip; the shared helper
    // does only the sweep.
    db.prepare(
      "UPDATE categories SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(now(), categoryId, DEFAULT_USER_ID);

    return sweepCategoryToRTA(db, budget, categoryId, month);
  })();

  revalidatePath("/budget");
  revalidatePath("/");
  return snapshot;
}

export async function restoreArchiveCategorySnapshot(
  snapshot: CategoryArchiveSnapshot
): Promise<void> {
  const db = getDb();

  db.transaction(() => {
    db.prepare(
      "UPDATE categories SET archived = 0, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(now(), snapshot.categoryId, DEFAULT_USER_ID);

    db.prepare(
      `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
    ).run(
      newId(),
      DEFAULT_USER_ID,
      snapshot.categoryId,
      snapshot.month,
      snapshot.previousAssigned
    );
  })();

  revalidatePath("/budget");
  revalidatePath("/");
}

export async function unarchiveCategoryWithSnapshot(
  categoryId: string
): Promise<CategoryUnarchiveSnapshot> {
  const db = getDb();

  // Flag-only flip — money was already swept on hide and stays in RTA until the
  // user re-assigns. Restores to the category's own category_group_id (no group
  // reassignment).
  db.prepare(
    "UPDATE categories SET archived = 0, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(now(), categoryId, DEFAULT_USER_ID);

  revalidatePath("/budget");
  revalidatePath("/");
  return { categoryId };
}

export async function restoreUnarchiveCategorySnapshot(
  snapshot: CategoryUnarchiveSnapshot
): Promise<void> {
  const db = getDb();

  db.prepare(
    "UPDATE categories SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(now(), snapshot.categoryId, DEFAULT_USER_ID);

  revalidatePath("/budget");
  revalidatePath("/");
}

// ── Group Archive / Unarchive (hide / unhide entire group) ──────────
//
// SEED-021 follow-up (260527-f0h). Mirrors the category-level actions at the
// GROUP level.
//
// HIDE flips category_groups.archived=1 and NEVER writes a child's own archived
// flag — a child vanishes from the active grid because its GROUP is filtered out
// by the engine. Hiding cascades the same per-category available sweep as
// archiveCategoryWithSnapshot across every CURRENTLY-VISIBLE child (the engine
// already filters budget.groups[group].categories to archived=0 children), records
// exactly that set in the snapshot, and never touches an already-hidden child.
//
// UNHIDE brings back the WHOLE group + ALL its categories, including ones that were
// individually hidden before the group was hidden (deliberate — 260527-f0h follow-up).
// It clears archived on those children too and records them so undo restores the
// exact prior state. Money stays REAL throughout; unhide never restores swept money.

export type GroupArchiveSnapshot = {
  groupId: string;
  // The categories swept as part of this group-hide (those visible at hide time),
  // each with its hide-month assigned BEFORE the sweep. Undo/restore replays
  // exactly this set; prior individual hides are not in it.
  sweptCategories: CategoryArchiveSnapshot[];
};

export type GroupUnarchiveSnapshot = {
  groupId: string;
  // The categories this unhide flipped back to visible — i.e. children that were
  // archived=1 at unhide time (individually hidden before the group was hidden).
  // Unhiding a group brings back the ENTIRE group + all its categories; undo
  // re-hides exactly this set so prior individual hides are restored on redo-of-hide.
  reHiddenCategoryIds: string[];
};

export async function archiveGroupWithSnapshot(
  groupId: string,
  month: string
): Promise<GroupArchiveSnapshot> {
  const db = getDb();

  // Read the budget once. The group is still active at read time, so its visible
  // children live in budget.groups[].categories (engine filters archived=0).
  const budget = computeBudgetMonth(await getBudgetData(month));
  const group = budget.groups.find((g) => g.id === groupId);
  const visibleChildren = group ? group.categories : [];

  const snapshot = db.transaction(() => {
    db.prepare(
      "UPDATE category_groups SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(now(), groupId, DEFAULT_USER_ID);

    // Sweep each visible child. NEVER touch any child's archived flag.
    const sweptCategories: CategoryArchiveSnapshot[] = [];
    for (const cat of visibleChildren) {
      sweptCategories.push(sweepCategoryToRTA(db, budget, cat.id, month));
    }

    return { groupId, sweptCategories } satisfies GroupArchiveSnapshot;
  })();

  revalidatePath("/budget");
  revalidatePath("/");
  return snapshot;
}

export async function restoreArchiveGroupSnapshot(
  snapshot: GroupArchiveSnapshot
): Promise<void> {
  const db = getDb();

  db.transaction(() => {
    db.prepare(
      "UPDATE category_groups SET archived = 0, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(now(), snapshot.groupId, DEFAULT_USER_ID);

    // Restore each swept child's hide-month assigned. Does NOT touch any child's
    // archived flag (group ops never do).
    for (const entry of snapshot.sweptCategories) {
      db.prepare(
        `INSERT INTO monthly_budgets (id, user_id, category_id, month, assigned)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(category_id, month) DO UPDATE SET assigned = excluded.assigned`
      ).run(
        newId(),
        DEFAULT_USER_ID,
        entry.categoryId,
        entry.month,
        entry.previousAssigned
      );
    }
  })();

  revalidatePath("/budget");
  revalidatePath("/");
}

export async function unarchiveGroupWithSnapshot(
  groupId: string
): Promise<GroupUnarchiveSnapshot> {
  const db = getDb();

  // Unhiding a group brings back the WHOLE group + ALL its categories — including
  // any that were individually hidden before the group was hidden. Money stays in
  // RTA (swept at hide time, never restored on unhide, symmetric with the
  // category-level unarchive). We record the children we flip back from archived=1
  // so undo can re-hide exactly them and restore the prior state.
  const snapshot = db.transaction(() => {
    const reHidden = (
      db
        .prepare(
          "SELECT id FROM categories WHERE category_group_id = ? AND user_id = ? AND archived = 1"
        )
        .all(groupId, DEFAULT_USER_ID) as { id: string }[]
    ).map((r) => r.id);

    db.prepare(
      "UPDATE category_groups SET archived = 0, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(now(), groupId, DEFAULT_USER_ID);

    if (reHidden.length > 0) {
      db.prepare(
        `UPDATE categories SET archived = 0, updated_at = ?
         WHERE category_group_id = ? AND user_id = ? AND archived = 1`
      ).run(now(), groupId, DEFAULT_USER_ID);
    }

    return { groupId, reHiddenCategoryIds: reHidden } satisfies GroupUnarchiveSnapshot;
  })();

  revalidatePath("/budget");
  revalidatePath("/");
  return snapshot;
}

export async function restoreUnarchiveGroupSnapshot(
  snapshot: GroupUnarchiveSnapshot
): Promise<void> {
  const db = getDb();

  // Re-hide the group and re-apply the individual hides that the unhide cleared,
  // restoring the exact prior state. No balance change (money already in RTA).
  db.transaction(() => {
    db.prepare(
      "UPDATE category_groups SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(now(), snapshot.groupId, DEFAULT_USER_ID);

    for (const categoryId of snapshot.reHiddenCategoryIds) {
      db.prepare(
        "UPDATE categories SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?"
      ).run(now(), categoryId, DEFAULT_USER_ID);
    }
  })();

  revalidatePath("/budget");
  revalidatePath("/");
}

// ── First-run setup checklist (SEED-001) ─────────────────────────────

// A neutral starting point a new user renames or deletes freely — common
// spending, not anyone's actual budget.
const STARTER_CATEGORIES: { group: string; categories: string[] }[] = [
  {
    group: "Bills",
    categories: ["Rent or mortgage", "Utilities", "Phone and internet", "Insurance", "Subscriptions"],
  },
  {
    group: "Everyday",
    categories: ["Groceries", "Dining out", "Transportation", "Household", "Personal care"],
  },
  {
    group: "Savings goals",
    categories: ["Emergency fund", "Vacation", "Gifts", "Car repairs"],
  },
];

export type StarterCategoriesResult = { ok: true } | { ok: false; reason: "has_categories" };

export async function addStarterCategories(): Promise<StarterCategoriesResult> {
  const db = getDb();

  // Only for a budget with no spending categories yet — a double click, or a
  // stale checklist in a second tab, must not stack a second copy.
  const existing = db
    .prepare(
      `SELECT 1 FROM categories c
       JOIN category_groups g ON g.id = c.category_group_id
       WHERE c.user_id = ? AND g.is_system = 0 AND g.is_income = 0
       LIMIT 1`
    )
    .get(DEFAULT_USER_ID);
  if (existing) return { ok: false, reason: "has_categories" };

  const insertGroup = db.prepare(
    `INSERT INTO category_groups (id, user_id, name, sort_order, is_income)
     VALUES (?, ?, ?, ?, 0)`
  );
  const insertCategory = db.prepare(
    `INSERT INTO categories (id, user_id, category_group_id, name, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    STARTER_CATEGORIES.forEach(({ group, categories }, groupIndex) => {
      const groupId = newId();
      insertGroup.run(groupId, DEFAULT_USER_ID, group, groupIndex);
      categories.forEach((name, categoryIndex) => {
        insertCategory.run(newId(), DEFAULT_USER_ID, groupId, name, categoryIndex);
      });
    });
  })();

  revalidatePath("/budget");
  return { ok: true };
}

export async function dismissOnboarding(): Promise<void> {
  setSetting(ONBOARDING_DISMISSED_KEY, "1");
  revalidatePath("/budget");
}

export async function markOnboardingTransferPlanSeen(): Promise<void> {
  setSetting(ONBOARDING_TRANSFER_PLAN_SEEN_KEY, "1");
  revalidatePath("/budget");
}
