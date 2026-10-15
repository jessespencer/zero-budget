-- Single-row-per-key app settings table. Generic key/value store for singleton
-- configuration that doesn't fit on an existing entity row.
--
-- First key: `budget_start_month` (SEED-016 historical import, Phase 2). The
-- budget engine ignores transactions and assignments dated before this cutoff
-- so pre-cutoff historical data feeds reports/charts without polluting
-- envelope math (available, RTA, overspending cascade).
--
-- Default = 2026-05-01 because the Pi DB baseline started May 1, 2026; first
-- real Zero transactions were entered then. Anything earlier is imported
-- history, not active budget.

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO app_settings (key, value) VALUES ('budget_start_month', '2026-05-01');
