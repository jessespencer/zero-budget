-- Quick task 260603-bdb — gate accounts.current_balance by budget cutoff.
--
-- WHY: Until now every raw `UPDATE accounts SET current_balance = current_balance ± ?`
-- site (createTransaction, deleteTransaction, updateTransaction, restoreSnapshot, etc.)
-- moved the displayed balance regardless of the transaction's date. Historical
-- imports (SEED-016) dated before `app_settings.budget_start_month` leaked
-- into the live balance — a card showed thousands off because legacy
-- pre-cutoff activity still added to current_balance even though the engine, RTA, and
-- reports already ignored those dates.
--
-- This migration is the ONE-SHOT snap: rebuild every account's current_balance
-- as `COALESCE(SUM(amount), 0) WHERE date >= budget_start_month`. The runtime
-- gate ships alongside in `lib/balance.ts` (applyToBalance helper) so future
-- mutations preserve the invariant.
--
-- Depends on migration 019 (app_settings table + `budget_start_month` seed
-- row). The cutoff is READ from app_settings — DO NOT hardcode the date here.
-- A future cutoff change (updating the app_settings row + re-applying this SQL
-- manually) would re-snap balances to the new boundary.
--
-- The migration runner wraps this in db.transaction() automatically, so the
-- UPDATE either commits fully or rolls back cleanly (no @no-transaction
-- directive needed). The auto-backup taken before applying migrations means
-- the prior state is recoverable from `*.pre-migration-v25.backup`.

UPDATE accounts
SET
  current_balance = COALESCE(
    (
      SELECT SUM(t.amount)
      FROM transactions t
      WHERE t.account_id = accounts.id
        AND t.date >= (
          SELECT value FROM app_settings WHERE key = 'budget_start_month'
        )
    ),
    0
  ),
  updated_at = datetime('now');
