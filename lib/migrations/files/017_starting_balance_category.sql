-- Reserve a "Category not needed" category in a new System group so credit-card
-- starting-balance transactions can self-identify as "no envelope applies"
-- instead of masquerading as Uncategorized (NULL → yellow Uncategorized badge,
-- which was the k43 contract). The new category is rendered in the
-- transactions table as a neutral "Category not needed" pill in BOTH display
-- and edit modes; it is filtered out of every category picker (transactions
-- inline editor, transaction dialog, schedule dialog, selection toolbar,
-- /quick add form, manage-payees dialog) and the budget table (lib/budget-engine.ts
-- already excludes is_system groups).
--
-- This migration also BACKFILLS legacy credit-card starting transactions that
-- shipped under k43 with category_id = NULL — flipping them over to the new
-- constant so they render with the neutral pill post-migration. The predicate
-- is intentionally narrow (NULL + payee='Starting balance' + is_debt account)
-- so user-NULL'd transactions on a debt account aren't accidentally captured.

-- sort_order is 2147483645 (one below Inflow's 2147483646) so the System
-- group sorts just before Inflow at the bottom of category_groups. is_system=1
-- keeps it out of the budget table render and the category-picker filters.
INSERT INTO category_groups (id, user_id, name, sort_order, is_income, is_system, created_at, updated_at)
VALUES (
  'ba1a7c00-0000-4000-8000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'System',
  2147483645,
  0, 1,
  datetime('now'), datetime('now')
);

INSERT INTO categories (id, category_group_id, user_id, name, sort_order, archived, created_at, updated_at)
VALUES (
  'ba1a7c00-0000-4000-8000-000000000006',
  'ba1a7c00-0000-4000-8000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'Category not needed',
  0, 0,
  datetime('now'), datetime('now')
);

-- Backfill legacy credit-card starting transactions. Narrow predicate: only
-- rows that are simultaneously category_id IS NULL, payee = 'Starting balance',
-- and live on an is_debt account. A user-deleted category that happens to
-- match the first two predicates on a non-debt account is left alone.
UPDATE transactions
SET category_id = 'ba1a7c00-0000-4000-8000-000000000006',
    updated_at = datetime('now')
WHERE category_id IS NULL
  AND payee = 'Starting balance'
  AND account_id IN (SELECT id FROM accounts WHERE is_debt = 1);
