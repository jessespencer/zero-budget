-- Fresh-install defaults for the first-run setup checklist (SEED-001).
--
-- 1. Migration 019 seeded `budget_start_month = '2026-05-01'` — the original
--    install's cutover date — into every database, brand-new ones included. A
--    database with no accounts and no transactions has no history to protect,
--    so it starts budgeting in the month it was created instead.
--
-- 2. The setup checklist is for empty installs. Any database that already has
--    an account is past setup, so it's marked dismissed and never shows the
--    checklist. Fresh databases get no row, which means "not dismissed".
--
-- Both statements are guarded on the data, not on a flag, so re-running this
-- file against either kind of database changes nothing further.

UPDATE app_settings
SET value = strftime('%Y-%m-01', 'now', 'localtime'),
    updated_at = datetime('now')
WHERE key = 'budget_start_month'
  AND NOT EXISTS (SELECT 1 FROM accounts)
  AND NOT EXISTS (SELECT 1 FROM transactions);

INSERT OR IGNORE INTO app_settings (key, value)
SELECT 'onboarding_dismissed', '1'
WHERE EXISTS (SELECT 1 FROM accounts);
