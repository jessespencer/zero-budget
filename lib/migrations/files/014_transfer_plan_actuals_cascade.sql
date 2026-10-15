-- @no-transaction
--
-- Add ON DELETE CASCADE to transfer_plan_actuals.account_id.
--
-- Migration 007 created transfer_plan_actuals with `account_id TEXT NOT NULL
-- REFERENCES accounts(id)` — no ON DELETE clause, which SQLite treats as
-- NO ACTION. That meant deleting any account with a row in this table
-- (everyone who ever saved an actual balance on the Transfer plan page) blew
-- up the deleteAccount server action with `FOREIGN KEY constraint failed`,
-- which propagated out as an uncaught error and crashed to the global error
-- boundary instead of redirecting to /dashboard. Every other FK to
-- accounts(id) in the schema is CASCADE or SET NULL — this one was the
-- outlier.
--
-- SQLite can't ALTER COLUMN to change a FK action, so we recreate the table.
-- Same rename/copy/drop dance as migration 012 (which has a fuller writeup of
-- why the @no-transaction + PRAGMA foreign_keys = OFF pattern is necessary).
--
-- Column order, defaults, and the UNIQUE (user_id, month, account_id)
-- constraint are preserved bit-for-bit from migration 007.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE transfer_plan_actuals_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actual_balance REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, month, account_id)
);

INSERT INTO transfer_plan_actuals_new (
  id, user_id, month, account_id, actual_balance, created_at, updated_at
)
SELECT
  id, user_id, month, account_id, actual_balance, created_at, updated_at
FROM transfer_plan_actuals;

DROP TABLE transfer_plan_actuals;

ALTER TABLE transfer_plan_actuals_new RENAME TO transfer_plan_actuals;

COMMIT;

-- Sanity that the FK references resolve. Runs OUTSIDE the transaction so it
-- sees the committed state.
PRAGMA foreign_key_check;

PRAGMA foreign_keys = ON;
