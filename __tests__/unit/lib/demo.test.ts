import Database from "better-sqlite3";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  currentDemoSessionId,
  getDemoDb,
  isValidDemoId,
  resetDemoSessionsForTests,
  sweepDemoSessions,
  type DemoRequestStore,
} from "@/lib/demo";

declare const globalThis: { __zero_demo_als?: AsyncLocalStorage<DemoRequestStore> };

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

let dir: string;
const saved = { ...process.env };

function sessionFile(id: string): string {
  return path.join(dir, "sessions", `${id}.db`);
}

function names(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM accounts ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zero-demo-test-"));
  process.env.ZERO_DEMO_DIR = dir;
  const template = new Database(path.join(dir, "template.db"));
  template.exec("CREATE TABLE accounts (name TEXT NOT NULL)");
  template.prepare("INSERT INTO accounts (name) VALUES (?)").run("Everyday Checking");
  template.close();
});

afterEach(() => {
  resetDemoSessionsForTests();
  globalThis.__zero_demo_als = undefined;
  process.env = { ...saved };
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("demo sandbox", () => {
  it("gives each visitor a private copy of the template", () => {
    const a = getDemoDb(A);
    const b = getDemoDb(B);
    a.prepare("INSERT INTO accounts (name) VALUES (?)").run("Visitor A savings");

    expect(names(a)).toEqual(["Everyday Checking", "Visitor A savings"]);
    expect(names(b)).toEqual(["Everyday Checking"]);
    expect(fs.existsSync(sessionFile(A))).toBe(true);
  });

  it("leaves the template untouched by visitor edits", () => {
    getDemoDb(A).prepare("DELETE FROM accounts").run();
    const template = new Database(path.join(dir, "template.db"), { readonly: true });
    expect(names(template)).toEqual(["Everyday Checking"]);
    template.close();
  });

  it("returns the same connection for repeat requests", () => {
    expect(getDemoDb(A)).toBe(getDemoDb(A));
  });

  it("refuses ids that are not UUIDs before touching the filesystem", () => {
    expect(isValidDemoId("../../zero")).toBe(false);
    expect(isValidDemoId(A)).toBe(true);
    expect(() => getDemoDb("../../zero")).toThrow(/invalid session id/);
    expect(fs.existsSync(path.join(dir, "sessions"))).toBe(false);
  });

  it("evicts the least recently used sandbox past the cap", () => {
    process.env.ZERO_DEMO_MAX_SESSIONS = "2";
    getDemoDb(A, 1);
    getDemoDb(B, 2);
    getDemoDb(A, 3); // A is now the most recent
    getDemoDb(C, 4);

    expect(fs.existsSync(sessionFile(B))).toBe(false);
    expect(fs.existsSync(sessionFile(A))).toBe(true);
    expect(fs.existsSync(sessionFile(C))).toBe(true);
  });

  it("sweeps sandboxes idle past the limit and keeps active ones", () => {
    process.env.ZERO_DEMO_IDLE_HOURS = "1";
    const hour = 60 * 60 * 1000;
    getDemoDb(A, 0);
    getDemoDb(B, 2 * hour);

    expect(sweepDemoSessions(2.5 * hour)).toBe(1);
    expect(fs.existsSync(sessionFile(A))).toBe(false);
    expect(fs.existsSync(sessionFile(B))).toBe(true);
  });

  it("starts a swept visitor over from a fresh copy", () => {
    process.env.ZERO_DEMO_IDLE_HOURS = "1";
    getDemoDb(A, 0).prepare("DELETE FROM accounts").run();
    sweepDemoSessions(2 * 60 * 60 * 1000);
    expect(names(getDemoDb(A))).toEqual(["Everyday Checking"]);
  });

  it("explains a missing template instead of creating an empty database", () => {
    fs.rmSync(path.join(dir, "template.db"));
    expect(() => getDemoDb(A)).toThrow(/template database missing/);
  });

  it("reads the visitor from the request context the demo server sets", () => {
    globalThis.__zero_demo_als = new AsyncLocalStorage<DemoRequestStore>();
    const id = globalThis.__zero_demo_als.run({ sessionId: B }, () => currentDemoSessionId());
    expect(id).toBe(B);
  });

  it("refuses a query with no visitor behind it", () => {
    expect(() => currentDemoSessionId()).toThrow(/no visitor session/);
  });
});

describe("getDb in demo mode", () => {
  it("routes to the current visitor's sandbox", async () => {
    process.env.ZERO_DEMO = "1";
    const { getDb } = await import("@/lib/db");
    globalThis.__zero_demo_als = new AsyncLocalStorage<DemoRequestStore>();
    const als = globalThis.__zero_demo_als;

    als.run({ sessionId: A }, () =>
      getDb().prepare("INSERT INTO accounts (name) VALUES (?)").run("Only in A")
    );
    const inB = als.run({ sessionId: B }, () => names(getDb()));
    const inA = als.run({ sessionId: A }, () => names(getDb()));

    expect(inB).toEqual(["Everyday Checking"]);
    expect(inA).toEqual(["Everyday Checking", "Only in A"]);
  });
});
