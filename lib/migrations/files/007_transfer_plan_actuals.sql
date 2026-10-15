CREATE TABLE transfer_plan_actuals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  actual_balance REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, month, account_id)
);
