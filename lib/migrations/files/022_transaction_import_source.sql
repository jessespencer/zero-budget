-- Add columns to transactions that preserve the source-of-truth grouping at
-- import time, enabling the dashboard Audit tab's "View by EveryDollar / YNAB
-- original" lens (Phase 9.1 follow-up to SEED-017 Phase 1).
--
-- Naming note: the existing `source` column already means "where the txn was
-- entered" (quick / desktop / import). `import_source` is distinct: it
-- identifies WHICH importer wrote the row (everydollar / ynab) and is only
-- populated for rows where source = 'import'.

ALTER TABLE transactions ADD COLUMN import_source TEXT
  CHECK (import_source IN ('everydollar', 'ynab') OR import_source IS NULL);

ALTER TABLE transactions ADD COLUMN source_group TEXT;
ALTER TABLE transactions ADD COLUMN source_category TEXT;

CREATE INDEX idx_transactions_import_source ON transactions(import_source);
CREATE INDEX idx_transactions_source_category ON transactions(source_category);
