-- SEED-021 follow-up (quick task 260527-f0h): hide/unhide entire category groups.
-- Adds an archived flag to category_groups, mirroring categories.archived.
-- mapRow/mapRows already convert the "archived" field for every row type, so no
-- db-utils change is needed once CategoryGroup gains `archived: boolean`.
ALTER TABLE category_groups ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
