import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { runMigrations } from "./migrations/runner";
import { seedSampleData } from "./sample-data.mjs";

// In-app Demo mode: a switch in Settings that makes the whole app show the
// sample household (lib/sample-data.mjs) instead of your budget, so you can
// screen-share or record from your normal install. Your real database is
// never written while it's on.
//
// How: getDb() (lib/db.ts) asks getDemoModeDb() first. While demo mode is on
// it returns a connection to a sample database built fresh when the mode was
// switched on; otherwise null, and getDb() returns the real one.
//
// The switch is one setting in the REAL database — an expiry time — so it's
// app-wide, not per browser: every device sees the demo while it's on. That
// is why it expires on its own (DEMO_MODE_HOURS) and why the banner says
// changes are discarded.
//
// Not to be confused with the public demo server (`npm run demo`,
// lib/demo.ts), which gives each visitor a private sandbox and never opens a
// real database at all. The two don't combine: the switch is unavailable there.

export const DEMO_MODE_SETTING = "demo_mode_expires_at";
export const DEMO_MODE_HOURS = 4;

type DemoModeState = {
  /** The real connection this state was read from. A different one (another
   *  test, a reopened DB) means re-reading the setting. */
  realDb: Database.Database;
  expiresAt: number | null;
  sampleDb: Database.Database | null;
};

declare const globalThis: { __zero_demo_mode?: DemoModeState };

/** Where the sample database lives: a `demo/` folder beside the real file,
 *  named after it so two installs sharing a folder don't collide. */
export function demoModeDbPath(realDbPath: string): string {
  const base = path.basename(realDbPath).replace(/\.db$/, "");
  return path.join(path.dirname(realDbPath), "demo", `${base}-demo.db`);
}

function readExpiry(realDb: Database.Database): number | null {
  const row = realDb
    .prepare<[string], { value: string }>("SELECT value FROM app_settings WHERE key = ?")
    .get(DEMO_MODE_SETTING);
  const ms = row ? Date.parse(row.value) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function state(realDb: Database.Database): DemoModeState {
  const current = globalThis.__zero_demo_mode;
  if (current && current.realDb === realDb) return current;
  current?.sampleDb?.close();
  const fresh: DemoModeState = { realDb, expiresAt: readExpiry(realDb), sampleDb: null };
  globalThis.__zero_demo_mode = fresh;
  return fresh;
}

function closeSample(s: DemoModeState): void {
  try {
    s.sampleDb?.close();
  } catch {
    // Already closed
  }
  s.sampleDb = null;
}

function removeFiles(file: string): void {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
}

/** When demo mode ends, or null when it's off (or already expired). */
export function demoModeExpiresAt(
  realDb: Database.Database,
  realDbPath: string,
  now: number = Date.now()
): number | null {
  const s = state(realDb);
  if (s.expiresAt === null || s.expiresAt <= now) return null;
  // A missing sample file (deleted by hand) means off — never fall through to
  // a half-state where the banner says demo but writes hit the real budget.
  if (!s.sampleDb && !fs.existsSync(demoModeDbPath(realDbPath))) return null;
  return s.expiresAt;
}

/** The sample connection while demo mode is on; null when off. */
export function getDemoModeDb(
  realDb: Database.Database,
  realDbPath: string,
  now: number = Date.now()
): Database.Database | null {
  const s = state(realDb);
  if (demoModeExpiresAt(realDb, realDbPath, now) === null) {
    if (s.sampleDb) closeSample(s);
    return null;
  }
  if (!s.sampleDb) {
    const db = new Database(demoModeDbPath(realDbPath));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    s.sampleDb = db;
  }
  return s.sampleDb;
}

/** Build a fresh sample database and switch demo mode on. */
export function enableDemoMode(
  realDb: Database.Database,
  realDbPath: string,
  now: number = Date.now()
): number {
  const file = demoModeDbPath(realDbPath);
  const building = `${file}.building`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  removeFiles(building);

  const db = new Database(building);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db, building);
    seedSampleData(db);
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }

  const s = state(realDb);
  closeSample(s);
  removeFiles(file);
  fs.renameSync(building, file);
  removeFiles(building);

  const expiresAt = now + DEMO_MODE_HOURS * 60 * 60 * 1000;
  realDb
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(DEMO_MODE_SETTING, new Date(expiresAt).toISOString());
  s.expiresAt = expiresAt;
  return expiresAt;
}

/** Switch demo mode off and delete the sample database. */
export function disableDemoMode(realDb: Database.Database, realDbPath: string): void {
  realDb.prepare("DELETE FROM app_settings WHERE key = ?").run(DEMO_MODE_SETTING);
  const s = state(realDb);
  s.expiresAt = null;
  closeSample(s);
  removeFiles(demoModeDbPath(realDbPath));
}
