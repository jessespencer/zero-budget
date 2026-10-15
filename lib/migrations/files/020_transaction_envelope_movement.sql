-- Flag a transaction as an envelope-movement allocation rather than a real
-- cash outflow. Set on EveryDollar `fund` rows during historical import
-- (SEED-016 Phase 4): those rows recorded money moving between Dave-Ramsey-
-- style sinking funds, not real spending. Excluding them from spending
-- analytics avoids double-counting (once when allocated to "Truck" fund,
-- again when the truck is actually purchased).
--
-- All existing transactions are real movements, so the default is 0. Only
-- the historical importer flips this to 1.

ALTER TABLE transactions ADD COLUMN is_envelope_movement INTEGER NOT NULL DEFAULT 0;
