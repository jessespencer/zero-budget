-- Adds a boolean flag for "Pin to mobile quick-add" — used by the /quick
-- route to fill the top-3 tile grid. App logic caps at 3 pins per income
-- bucket (3 expense + 3 income); unfilled slots are filled by 60-day usage
-- frequency (see getQuickAddData in app/(app)/transactions/actions.ts).
--
-- Default 0 (unpinned) — existing categories light up the auto-frequency
-- path until the user opts a category in via the Category settings dialog.

ALTER TABLE categories
ADD COLUMN pinned_quick INTEGER NOT NULL DEFAULT 0;
