-- @no-transaction
--
-- Change monthly_budgets.category_id from ON DELETE CASCADE to ON DELETE
-- RESTRICT, so deleting a category can no longer silently erase its assign
-- history.
--
-- Why this is a money bug and not a data-hygiene nicety: the budget engine
-- derives Ready to Assign from `totalIncome − totalAssigned`, summing
-- `assigned` over ALL months. Cascading those rows away makes it look like the
-- money was never assigned, so the engine hands it back as available — inflated
-- by the category's lifetime *spending* (the balance itself legitimately
-- returns; the spent part does not). Measured at +$330 on the test fixture and
-- up to $94.5k on a real everyday category.
--
-- `bulkDeleteCategoriesWithSnapshot` already guards this in code — it merges
-- the budget rows into the reassignment target and refuses a delete that would
-- drop history. But the guard sat in one code path while the schema allowed the
-- loss from any of them: `deleteCategory` and `deleteCategoryGroup` both issued
-- bare DELETEs. RESTRICT makes the whole class impossible rather than fixing
-- instances — an unguarded delete now fails loudly with `FOREIGN KEY constraint
-- failed` instead of quietly inventing money.
--
-- Every delete path that legitimately removes a category now clears its
-- monthly_budgets rows first (after merging them somewhere, when they hold
-- money). See `app/(app)/budget/actions.ts`.
--
-- SQLite can't ALTER COLUMN to change a FK action, so the table is recreated —
-- same rename/copy/drop dance as migrations 012 and 014, which carry the fuller
-- writeup of why @no-transaction + PRAGMA foreign_keys = OFF is necessary.
--
-- Column order, defaults, and the UNIQUE (category_id, month) constraint are
-- preserved bit-for-bit from migration 001. DROP TABLE also drops the table's
-- indexes, so both are recreated below.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE monthly_budgets_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  month TEXT NOT NULL,
  assigned REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (category_id, month)
);

INSERT INTO monthly_budgets_new (
  id, user_id, category_id, month, assigned, created_at, updated_at
)
SELECT
  id, user_id, category_id, month, assigned, created_at, updated_at
FROM monthly_budgets;

DROP TABLE monthly_budgets;

ALTER TABLE monthly_budgets_new RENAME TO monthly_budgets;

CREATE INDEX IF NOT EXISTS idx_monthly_budgets_month ON monthly_budgets(month);
CREATE INDEX IF NOT EXISTS idx_monthly_budgets_category ON monthly_budgets(category_id);

COMMIT;

-- Diagnostic ONLY — it cannot fail this migration. foreign_key_check returns
-- violations as rows rather than raising, and the runner executes via exec(),
-- which discards result rows. It is here for a human running this file by hand
-- in the sqlite3 CLI; nothing automated reads it.
--
-- Deliberately not upgraded into a real assert (the temp-table CHECK trick
-- would do it). An abort here fires AFTER the COMMIT above, so it would leave
-- the table swapped but the migration unrecorded — a worse state than it
-- catches. And it can only catch pre-existing orphans: the copy is 1:1 from a
-- table that already had a FK to the same parent, and an orphan under RESTRICT
-- is inert until someone deletes a category that doesn't exist. Verified zero
-- orphans on the prod DB before shipping.
--
-- Runs outside the transaction so it sees the committed state.
PRAGMA foreign_key_check;

PRAGMA foreign_keys = ON;
