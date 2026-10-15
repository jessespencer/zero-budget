-- Historical snapshot entries — preserve the original structure of the
-- hand-maintained Savings + Expenses budget spreadsheets (2016–2025).
--
-- Decoupled from `categories`, `monthly_budgets`, `transactions`. The
-- spreadsheet's row name IS the identity. No FK to current envelopes, no
-- mapping decisions, no merge collisions.
--
-- Three data layers, by design:
--   1. Current Zero envelopes (`categories` + `monthly_budgets` post-cutoff)
--      — how budgeting works today.
--   2. Transactions (`transactions`) — granular spend records spanning all
--      time, power across-history spending-trend visualizations.
--   3. Historical snapshots (THIS TABLE) — preserved spreadsheet structure
--      year-by-year, the story of how money was organized over time.
--
-- `amount` is NET per cell — sum of all signed operands in the original
-- formula. Matches the cell's evaluated value and aggregates to the
-- spreadsheet's column-P year total.
--
-- `group_name` is nullable: Savings spreadsheet has no group concept; some
-- Expenses years have explicit group headers (Insurance / Sinking Funds /
-- Subscriptions) and some don't. NULL = ungrouped.

CREATE TABLE historical_snapshot_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('savings', 'expenses')),
  group_name TEXT,
  category_name TEXT NOT NULL,
  month TEXT NOT NULL,
  amount REAL NOT NULL,
  raw_formula TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, category_name, month)
);

CREATE INDEX idx_hse_source_month ON historical_snapshot_entries (source, month);
CREATE INDEX idx_hse_source_year ON historical_snapshot_entries (source, substr(month, 1, 4));
