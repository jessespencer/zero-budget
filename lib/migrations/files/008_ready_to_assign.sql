-- Seed an "Inflow" category group + "Ready to assign" category as the default
-- landing for system-generated income (starting balance, balance adjustments,
-- and any future flows that put money "into the budget" without a user-named
-- source).
--
-- The group is marked is_income = 1 (sums into totalIncome / Ready to Assign)
-- AND is_system = 1 so it stays out of the regular budget table render
-- (lib/budget-engine.ts filter `!is_income && !is_system`) and out of the
-- sort-order shuffling for user-created groups (app/(app)/budget/actions.ts).
--
-- The category is still surfaced by income pickers (transaction-dialog.tsx and
-- schedule-dialog.tsx flatMap any is_income group's categories — no is_system
-- exclusion there) so users can pick "Ready to assign" when entering a manual
-- inflow.

-- sort_order is 2147483646 (one below System's MAX_INT) so the Inflow group
-- never collides with user-reordered sort_order values (which start at 0 and
-- count up). is_system = 1 keeps it out of the rendered budget table anyway,
-- but using a sentinel avoids any ORDER BY ambiguity in tests and queries.
INSERT INTO category_groups (id, user_id, name, sort_order, is_income, is_system, created_at, updated_at)
VALUES (
  'ba1a7c00-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'Inflow',
  2147483646,
  1, 1,
  datetime('now'), datetime('now')
);

INSERT INTO categories (id, category_group_id, user_id, name, sort_order, archived, created_at, updated_at)
VALUES (
  'ba1a7c00-0000-4000-8000-000000000004',
  'ba1a7c00-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'Ready to assign',
  0, 0,
  datetime('now'), datetime('now')
);
