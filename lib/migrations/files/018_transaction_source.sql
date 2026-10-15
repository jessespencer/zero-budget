-- Add a `source` provenance flag to transactions. Nullable; existing rows keep
-- NULL (honest backfill — see SEED-014). New writes stamp one of three values:
--   'quick'   — added from the mobile /quick PWA (createQuickTransaction,
--               createQuickSplitTransaction, createQuickTransfer).
--   'desktop' — every other in-app write (manual desktop add, schedules,
--               account balance adjustments, reconcile, starting balance,
--               duplicates, transfer plan).
--   'import'  — CSV importer (csv-import-wrapper.tsx).
--
-- No index: low cardinality, only used for UI rendering today. Add later if a
-- toolbar filter ever ships (deferred per SEED-014).

ALTER TABLE transactions ADD COLUMN source TEXT CHECK (source IN ('quick','desktop','import'));
