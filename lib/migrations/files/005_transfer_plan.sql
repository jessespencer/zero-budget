-- Transfer plan schema additions

-- Add allocation_account_id and is_buffer to categories (SCHM-01, SCHM-02)
ALTER TABLE categories ADD COLUMN allocation_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN is_buffer INTEGER NOT NULL DEFAULT 0;

-- Add is_primary to accounts (SCHM-03)
ALTER TABLE accounts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;

-- Add is_system to category_groups (D-13)
ALTER TABLE category_groups ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

-- Auto-detect primary account: first non-archived checking account by sort_order (D-09)
UPDATE accounts SET is_primary = 1
WHERE id = (
  SELECT id FROM accounts
  WHERE type = 'checking' AND archived = 0
  ORDER BY sort_order ASC
  LIMIT 1
);

-- Create system category group for internal categories (D-12)
INSERT INTO category_groups (id, user_id, name, sort_order, is_income, is_system, created_at, updated_at)
VALUES (
  'ba1a7c00-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'System',
  2147483647,
  0, 1,
  datetime('now'), datetime('now')
);

-- Create balance adjustment category in system group (D-06, D-12)
INSERT INTO categories (id, category_group_id, user_id, name, sort_order, archived, created_at, updated_at)
VALUES (
  'ba1a7c00-0000-4000-8000-000000000002',
  'ba1a7c00-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'Balance adjustment',
  0, 0,
  datetime('now'), datetime('now')
);
