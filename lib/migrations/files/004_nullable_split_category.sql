-- Allow splits to exist without a category so users can save partial work
-- and return to categorize later.
-- SQLite does not support ALTER COLUMN, so we recreate the table.

CREATE TABLE transaction_splits_new (
  id TEXT PRIMARY KEY,
  parent_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO transaction_splits_new SELECT * FROM transaction_splits;
DROP TABLE transaction_splits;
ALTER TABLE transaction_splits_new RENAME TO transaction_splits;
