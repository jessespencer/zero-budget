import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";
import { getDb } from "@/lib/db";
import {
  DEMO_MODE_HOURS,
  DEMO_MODE_SETTING,
  demoModeDbPath,
  demoModeExpiresAt,
  disableDemoMode,
  enableDemoMode,
  getDemoModeDb,
} from "@/lib/demo-mode";

const HOUR = 60 * 60 * 1000;

let dir: string;
let realPath: string;
let real: Database.Database;
const savedEnv = { ...process.env };

const accountNames = (db: Database.Database) =>
  (db.prepare("SELECT name FROM accounts ORDER BY name").all() as { name: string }[]).map((r) => r.name);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zero-demo-mode-"));
  realPath = path.join(dir, "zero.db");
  process.env.ZERO_DB_PATH = realPath;
  real = createTestDb();
  real
    .prepare("INSERT INTO accounts (id, user_id, name, type) VALUES ('real-acct', '00000000-0000-0000-0000-000000000000', 'My real checking', 'checking')")
    .run();
  setTestDb(real);
});

afterEach(() => {
  disableDemoMode(real, realPath);
  clearTestDb();
  real.close();
  process.env = { ...savedEnv };
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("demo mode", () => {
  it("is off until switched on", () => {
    expect(demoModeExpiresAt(real, realPath)).toBeNull();
    expect(getDb()).toBe(real);
  });

  it("routes every query to a freshly seeded sample database while on", () => {
    enableDemoMode(real, realPath);
    const db = getDb();
    expect(db).not.toBe(real);
    expect(accountNames(db)).toEqual(["Everyday Checking", "High Yield Savings", "Visa Card", "Wallet"]);
  });

  it("never writes the real budget's data while on", () => {
    enableDemoMode(real, realPath);
    getDb().prepare("DELETE FROM accounts").run();
    expect(accountNames(real)).toEqual(["My real checking"]);
  });

  it("goes back to the real budget when switched off, and deletes the sample", () => {
    enableDemoMode(real, realPath);
    getDb(); // open the sample connection
    disableDemoMode(real, realPath);

    expect(getDb()).toBe(real);
    expect(fs.existsSync(demoModeDbPath(realPath))).toBe(false);
    expect(real.prepare("SELECT 1 FROM app_settings WHERE key = ?").get(DEMO_MODE_SETTING)).toBeUndefined();
  });

  it("ends on its own after the time limit", () => {
    const start = Date.now();
    const expiresAt = enableDemoMode(real, realPath, start);
    expect(expiresAt).toBe(start + DEMO_MODE_HOURS * HOUR);

    expect(getDemoModeDb(real, realPath, start + HOUR)).not.toBeNull();
    expect(getDemoModeDb(real, realPath, expiresAt + 1)).toBeNull();
  });

  it("starts from a clean sample every time it's switched on", () => {
    enableDemoMode(real, realPath);
    getDb().prepare("DELETE FROM accounts").run();
    enableDemoMode(real, realPath);
    expect(accountNames(getDb())).toHaveLength(4);
  });

  it("treats a missing sample file as off rather than half on", () => {
    enableDemoMode(real, realPath);
    // Re-read state from the setting, as a fresh process would.
    clearTestDb();
    const reopened = new Database(":memory:");
    reopened.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
    reopened
      .prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)")
      .run(DEMO_MODE_SETTING, new Date(Date.now() + HOUR).toISOString());
    fs.rmSync(demoModeDbPath(realPath));

    expect(demoModeExpiresAt(reopened, realPath)).toBeNull();
    expect(getDemoModeDb(reopened, realPath)).toBeNull();
    reopened.close();
    setTestDb(real);
  });

  it("survives a restart: the switch is read back from the real database", () => {
    const expiresAt = enableDemoMode(real, realPath);
    // A second connection to the same data stands in for a fresh process.
    const backup = path.join(dir, "copy.db");
    real.exec(`VACUUM INTO '${backup}'`);
    const restarted = new Database(backup);
    expect(demoModeExpiresAt(restarted, realPath)).toBe(expiresAt);
    restarted.close();
    setTestDb(real);
  });
});
