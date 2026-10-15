-- Phase 8: introduce tracked_assets (manually-tracked non-budget holdings)
-- and tracked_asset_history (point-in-time values for the chart line).
--
-- Also drops the old `net_worth_snapshots` table — Phase 8 replaces the
-- monthly-snapshot model with a derived series computed from transactions +
-- tracked_asset_history at read time. There are no production-critical
-- snapshots to preserve (user is mid-dogfooding; clean break is the lock-in
-- in 08-SPEC.md Requirement 2).
--
-- This migration does NOT need the `-- @no-transaction` hint: it only DROPs
-- net_worth_snapshots (no inbound FK references; it referenced accounts(id),
-- not the reverse) and CREATEs two new tables with their own indexes. The
-- default transactional wrap from `runner.ts` is correct here.
--
-- `asset_type` CHECK matches `accounts.type` MINUS the cash-account subset
-- (checking / cash / savings / credit_card). The order mirrors the canonical
-- group order in 08-SPEC.md Requirement 7 (investments → retirement → real
-- estate → crypto → vehicle → other).
--
-- `archived INTEGER` matches the boolean-as-INT convention used throughout
-- the schema (see lib/db-utils.ts BOOLEAN_FIELDS — `archived` is already in
-- the set, so mapRow will auto-convert these rows without any code change).

DROP TABLE IF EXISTS net_worth_snapshots;

CREATE TABLE IF NOT EXISTS tracked_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('investment','retirement','real_estate','crypto','vehicle','other')),
  current_value REAL NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracked_asset_history (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES tracked_assets(id) ON DELETE CASCADE,
  value REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tracked_assets_user ON tracked_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_asset_history_asset_recorded ON tracked_asset_history(asset_id, recorded_at);
