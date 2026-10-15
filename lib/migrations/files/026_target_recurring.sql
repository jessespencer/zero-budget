-- Quick task 260615-x10: "Repeat every year" recurrence for Yearly targets.
-- Opt-in flag that makes a target_by_date target recur: its effective deadline
-- rolls forward by whole years once the anchor passes, and progress measures
-- against the current envelope balance (available) instead of cumulative_assigned
-- so the sinking fund refills after being spent each cycle.
-- mapRow/mapRows convert this 0/1 INTEGER to boolean once `recurring` joins the
-- BOOLEAN_FIELDS set in lib/db-utils.ts.
ALTER TABLE targets ADD COLUMN recurring INTEGER NOT NULL DEFAULT 0;
