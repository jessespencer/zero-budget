import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "@/lib/migrations/runner";

let dir: string;
let dbPath: string;

const backups = () => fs.readdirSync(dir).filter((f) => f.includes(".pre-migration-v"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zero-runner-"));
  dbPath = path.join(dir, "zero.db");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runMigrations backups", () => {
  it("takes no backup when migrating a fresh database", () => {
    const db = new Database(dbPath);
    runMigrations(db, dbPath);
    db.close();

    expect(backups()).toEqual([]);
  });

  it("takes exactly one backup, named for the first pending migration, when upgrading", () => {
    const db = new Database(dbPath);
    runMigrations(db, dbPath);
    // Pretend the last two migrations haven't run yet.
    const latest = (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v;
    db.prepare("DELETE FROM schema_migrations WHERE version >= ?").run(latest - 1);
    db.close();

    // Re-running them must be harmless for this check, so only assert on the
    // backup files: the runner may throw if a migration isn't re-runnable.
    const again = new Database(dbPath);
    try {
      runMigrations(again, dbPath);
    } catch {
      // not idempotent — irrelevant to the backup assertion below
    }
    again.close();

    expect(backups()).toEqual([`zero.db.pre-migration-v${latest - 1}.backup`]);
  });
});
