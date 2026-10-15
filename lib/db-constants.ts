// Reserved category-group + category UUIDs used as sentinel/system identifiers.
//
// These constants are extracted from lib/db.ts so they can be imported by
// client components (which "use client" — pulling lib/db.ts pulls
// better-sqlite3, which webpack can't bundle for the browser). Keep this file
// import-free: it must remain safe to import from any environment.

export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";
export const SYSTEM_CATEGORY_GROUP_ID = "ba1a7c00-0000-4000-8000-000000000001";
export const BALANCE_ADJUSTMENT_CATEGORY_ID = "ba1a7c00-0000-4000-8000-000000000002";
export const INFLOW_CATEGORY_GROUP_ID = "ba1a7c00-0000-4000-8000-000000000003";
export const READY_TO_ASSIGN_CATEGORY_ID = "ba1a7c00-0000-4000-8000-000000000004";
export const STARTING_BALANCE_CATEGORY_GROUP_ID = "ba1a7c00-0000-4000-8000-000000000005";
export const STARTING_BALANCE_CATEGORY_ID = "ba1a7c00-0000-4000-8000-000000000006";
