-- Scheduled transactions: recurring bills, income, and one-time future transactions
CREATE TABLE scheduled_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payee TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
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

CREATE INDEX idx_scheduled_transactions_user ON scheduled_transactions(user_id);
CREATE INDEX idx_scheduled_transactions_next ON scheduled_transactions(next_date);

-- Link posted transactions back to their schedule for paid-status detection
ALTER TABLE transactions ADD COLUMN schedule_id TEXT REFERENCES scheduled_transactions(id) ON DELETE SET NULL;
