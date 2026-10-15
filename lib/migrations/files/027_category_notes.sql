-- Free-form notes on a category (descriptions, reminders, random context).
-- Surfaced in the budget category detail panel's "Notes" tab.
ALTER TABLE categories ADD COLUMN notes TEXT NOT NULL DEFAULT '';
