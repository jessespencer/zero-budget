-- Per-month expected-income forecast for the budget overview panel's
-- "Cost to be me" card. This is a user-entered target/forecast — one scalar
-- per month — and is distinct from recorded income (which the engine sums from
-- income-category transactions). The ABSENCE of a row means "no forecast set":
-- the panel then falls back to showing recorded income. Storing a forecast of
-- $0 is a real, distinct state (a row with expected_income = 0).
--
-- Keyed by (user_id, month) — the first per-month-only table in the schema;
-- everything else hangs off a category. Money is REAL app-wide (see db-utils).
CREATE TABLE IF NOT EXISTS monthly_income_forecast (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  expected_income REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, month)
);
