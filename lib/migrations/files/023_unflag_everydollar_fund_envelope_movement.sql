-- The historical importer (SEED-016 Phase 4) flagged EveryDollar `type=fund`
-- rows as is_envelope_movement = 1 under the assumption they recorded
-- Dave-Ramsey-style sinking-fund allocations rather than real outflows.
--
-- The actual EveryDollar data contradicts that assumption: nearly every
-- `fund` row carries a real merchant and is signed as an outflow.
-- EveryDollar's `fund` type is just "outflow from a sinking-fund envelope" —
-- the transaction IS the spending event, not an internal envelope move.
--
-- Net effect of the wrong flag: the dashboard Expenses tab and the Audit
-- tab both default-hide is_envelope_movement = 1 rows, so almost all of a
-- sinking-fund category's spending was invisible to spending analytics —
-- and the same pattern repeated across every sinking-fund-style category.
--
-- Fix: clear the flag for all EveryDollar-imported rows. The flag column
-- stays in the schema for legitimate future use (Zero-native budget
-- reassignment plumbing), but no row currently in the DB needs it set.
--
-- import-expenses.mjs is updated in the same commit to stop writing 1 for
-- fund rows going forward.

UPDATE transactions
SET is_envelope_movement = 0
WHERE import_source = 'everydollar' AND is_envelope_movement = 1;
