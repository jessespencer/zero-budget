import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const USER_ID = "00000000-0000-0000-0000-000000000000";
const migrationsDir = path.join(process.cwd(), "lib", "migrations", "files");
const migration030 = fs.readFileSync(
  path.join(migrationsDir, "030_fresh_install_defaults.sql"),
  "utf-8"
);

/** Every migration before 030, the way the runner would have left the DB. */
function buildDbAtMigration029(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => parseInt(f, 10) <= 29)
    .sort();
  for (const file of files) db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf-8"));
  return db;
}

const setting = (db: Database.Database, key: string) =>
  (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined)
    ?.value;

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

let db: Database.Database;
beforeEach(() => {
  db = buildDbAtMigration029();
});
afterEach(() => db.close());

describe("migration 030 — fresh install defaults", () => {
  it("starts an empty database in the current month and leaves the checklist on", () => {
    expect(setting(db, "budget_start_month")).toBe("2026-05-01");
    db.exec(migration030);
    expect(setting(db, "budget_start_month")).toBe(thisMonth());
    expect(setting(db, "onboarding_dismissed")).toBeUndefined();
  });

  it("keeps an existing database's start month and pre-dismisses the checklist", () => {
    db.prepare(
      `INSERT INTO accounts (id, user_id, name, type, current_balance, sort_order)
       VALUES ('a1', ?, 'Checking', 'checking', 0, 0)`
    ).run(USER_ID);

    db.exec(migration030);
    expect(setting(db, "budget_start_month")).toBe("2026-05-01");
    expect(setting(db, "onboarding_dismissed")).toBe("1");
  });

  it("changes nothing further when applied twice", () => {
    db.exec(migration030);
    const first = setting(db, "budget_start_month");
    db.exec(migration030);
    expect(setting(db, "budget_start_month")).toBe(first);
  });
});
