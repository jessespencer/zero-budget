-- @no-transaction
--
-- Add 'cash' to the accounts.type CHECK constraint.
--
-- SQLite can't ALTER TABLE ... DROP CONSTRAINT, so the only way to widen a
-- CHECK list is the rename/copy/drop dance. That dance must happen with
-- foreign-key enforcement disabled — otherwise the DROP TABLE invalidates
-- the FK references from transactions, categories.allocation_account_id,
-- net_worth_snapshots, and transfer_plan_actuals and the COMMIT fails.
--
-- `PRAGMA foreign_keys = OFF` is a no-op inside an open transaction, so this
-- migration uses the `-- @no-transaction` hint at the top of the file. The
-- runner skips its implicit `db.transaction()` wrap and lets the SQL below
-- manage its own BEGIN/COMMIT around the dance — which is the only pattern
-- SQLite officially supports for this case.
--
-- The CHECK list places 'cash' between 'checking' and 'savings' to match the
-- UI ordering in the Add account dialog. Every column, default, and column
-- order is preserved bit-for-bit from the live schema (001 + 005 columns).
-- The idx_accounts_user index AND the idx_accounts_single_primary partial
-- unique index (added in 006_unique_primary_account.sql) are recreated.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE accounts_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'checking', 'cash', 'savings', 'credit_card', 'investment',
    'retirement', 'real_estate', 'vehicle', 'other'
  )),
  institution TEXT,
  current_balance REAL NOT NULL DEFAULT 0,
  is_budget_account INTEGER NOT NULL DEFAULT 1,
  is_debt INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  plaid_item_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_primary INTEGER NOT NULL DEFAULT 0
);

INSERT INTO accounts_new (
  id, user_id, name, type, institution, current_balance,
  is_budget_account, is_debt, sort_order, archived, plaid_item_id,
  created_at, updated_at, is_primary
)
SELECT
  id, user_id, name, type, institution, current_balance,
  is_budget_account, is_debt, sort_order, archived, plaid_item_id,
  created_at, updated_at, is_primary
FROM accounts;

DROP TABLE accounts;

ALTER TABLE accounts_new RENAME TO accounts;

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_single_primary
  ON accounts (is_primary) WHERE is_primary = 1;

COMMIT;

-- Sanity that the FK references from dependent tables all still resolve to
-- a row in the new accounts table. Runs OUTSIDE the transaction so it sees
-- the committed state.
PRAGMA foreign_key_check;

PRAGMA foreign_keys = ON;
