import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations } from "./migrations/runner";
import { isDemoMode } from "./demo-config";
import { getDemoDb } from "./demo";
import { getDemoModeDb } from "./demo-mode";

// Re-export reserved-id constants from a side-effect-free module so client
// components can pull `STARTING_BALANCE_CATEGORY_ID` (etc.) by reaching into
// @/lib/db-constants directly without dragging better-sqlite3 into the
// browser bundle. We keep these re-exports here so existing server-side
// callers can continue importing from @/lib/db.
export {
  DEFAULT_USER_ID,
  SYSTEM_CATEGORY_GROUP_ID,
  BALANCE_ADJUSTMENT_CATEGORY_ID,
  INFLOW_CATEGORY_GROUP_ID,
  READY_TO_ASSIGN_CATEGORY_ID,
  STARTING_BALANCE_CATEGORY_GROUP_ID,
  STARTING_BALANCE_CATEGORY_ID,
} from "./db-constants";

declare const globalThis: { __zero_db?: Database.Database };

export function resolveDbPath(): string {
  return process.env.ZERO_DB_PATH ?? path.join(process.cwd(), "data", "zero.db");
}

/**
 * The database every query should use. Under `npm run demo` that's the
 * visitor's sandbox (lib/demo.ts); while the in-app Demo mode is on, the
 * sample database (lib/demo-mode.ts); otherwise the real one.
 */
export function getDb(): Database.Database {
  if (isDemoMode()) return getDemoDb();
  const real = getRealDb();
  return getDemoModeDb(real, resolveDbPath()) ?? real;
}

/**
 * The user's own database, even while Demo mode is on. Only for code that
 * manages Demo mode itself — everything else goes through getDb().
 */
export function getRealDb(): Database.Database {
  if (globalThis.__zero_db) return globalThis.__zero_db;

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db, dbPath);

  console.log("[zero] database:", dbPath);

  globalThis.__zero_db = db;
  return db;
}
