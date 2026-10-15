-- Enforce at most one primary account via partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_single_primary
ON accounts (is_primary) WHERE is_primary = 1;
