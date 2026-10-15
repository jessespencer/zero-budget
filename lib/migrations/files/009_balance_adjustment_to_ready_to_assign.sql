-- Migrate the legacy "Balance adjustment" category (System group, non-income)
-- into the new "Ready to assign" sink (Inflow group, is_income = 1).
--
-- Before this change, applyBalanceAdjustment posted into the legacy System
-- category, which did NOT count toward Ready to Assign. That meant manual
-- balance corrections silently DIDN'T fund the budget — confusing in YNAB-
-- style envelope budgeting, where any money entering an account from outside
-- the system should be assignable.
--
-- This migration:
-- 1. Reroutes any historical balance-adjustment transactions to the new
--    Ready to assign category so they retroactively count as inflow.
-- 2. Reroutes any payees that defaulted to the legacy category.
-- 3. Archives the legacy category so it no longer surfaces in pickers
--    (kept as a row for historical reference; FK references resolved by
--    step 1 are now pointing elsewhere anyway).

UPDATE transactions
SET category_id = 'ba1a7c00-0000-4000-8000-000000000004'
WHERE category_id = 'ba1a7c00-0000-4000-8000-000000000002';

UPDATE payees
SET default_category_id = 'ba1a7c00-0000-4000-8000-000000000004'
WHERE default_category_id = 'ba1a7c00-0000-4000-8000-000000000002';

UPDATE categories
SET archived = 1, updated_at = datetime('now')
WHERE id = 'ba1a7c00-0000-4000-8000-000000000002';
