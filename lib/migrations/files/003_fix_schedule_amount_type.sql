-- Fix scheduled_transactions.amount column type from INTEGER to REAL
-- SQLite cannot ALTER COLUMN, so we recreate the table

CREATE TABLE scheduled_transactions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payee TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  memo TEXT,
  frequency TEXT NOT NULL,
  interval INTEGER DEFAULT 1,
  start_date TEXT NOT NULL,
  end_date TEXT,
  day_of_month INTEGER,
  day_of_week INTEGER,
  skip_weekend TEXT,
  next_date TEXT NOT NULL,
  posts_transaction INTEGER DEFAULT 1,
  completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO scheduled_transactions_new SELECT * FROM scheduled_transactions;

DROP TABLE scheduled_transactions;

ALTER TABLE scheduled_transactions_new RENAME TO scheduled_transactions;

CREATE INDEX idx_scheduled_transactions_user ON scheduled_transactions(user_id);
CREATE INDEX idx_scheduled_transactions_next ON scheduled_transactions(next_date);
