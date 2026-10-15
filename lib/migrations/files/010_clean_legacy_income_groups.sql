-- Clean up legacy non-system income groups (e.g. an "Income" group with a
-- "Salary" category) auto-created by an earlier version of
-- ensureIncomeCategory before the seeded "Inflow / Ready to assign" sink
-- existed (migration 008).
--
-- Design intent (post-008): every inflow lands in the single system "Ready
-- to assign" category. If a user wants to assign a paycheck directly to a
-- budget category (e.g. Vacation), they pick that category at transaction
-- entry — no need for a separate Salary / Bonus / Other-income hierarchy.
--
-- Note: the `addCategoryGroup` server action hard-codes is_income = 0, so
-- non-system income groups can only have come from the auto-creation path.
-- Cleaning them up is safe.

-- 1. Reroute transactions that pointed at any non-system income category
--    into Ready to assign so no inflow is silently lost.
UPDATE transactions
SET category_id = 'ba1a7c00-0000-4000-8000-000000000004'
WHERE category_id IN (
  SELECT c.id FROM categories c
  JOIN category_groups cg ON cg.id = c.category_group_id
  WHERE cg.is_income = 1 AND cg.is_system = 0
);

-- 2. Reroute payee defaults likewise.
UPDATE payees
SET default_category_id = 'ba1a7c00-0000-4000-8000-000000000004'
WHERE default_category_id IN (
  SELECT c.id FROM categories c
  JOIN category_groups cg ON cg.id = c.category_group_id
  WHERE cg.is_income = 1 AND cg.is_system = 0
);

-- 3. Reroute monthly_budgets rows that referenced non-system income
--    categories. The income-group categories don't get user-assigned
--    budgets in the first place (income flows TO Ready to Assign, not
--    INTO categories), but a defensive UPDATE keeps any malformed rows
--    from blocking step 4's DELETE via FK.
DELETE FROM monthly_budgets
WHERE category_id IN (
  SELECT c.id FROM categories c
  JOIN category_groups cg ON cg.id = c.category_group_id
  WHERE cg.is_income = 1 AND cg.is_system = 0
);

-- 4. Drop the categories themselves.
DELETE FROM categories
WHERE category_group_id IN (
  SELECT id FROM category_groups
  WHERE is_income = 1 AND is_system = 0
);

-- 5. Drop the now-empty groups.
DELETE FROM category_groups
WHERE is_income = 1 AND is_system = 0;
