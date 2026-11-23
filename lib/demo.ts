import Database from "better-sqlite3";
import type { AsyncLocalStorage } from "node:async_hooks";
import fs from "fs";
import path from "path";
import { demoIdleHours, demoMaxSessions } from "./demo-config";

// Per-visitor demo sandbox. Under `npm run demo`, every visitor gets their own
// copy of the seed:dev database, so edits are private and nobody can vandalise
// the demo for anyone else.
//
// How a request finds its database: scripts/demo-server.mjs reads (or issues)
// the visitor's `zero_demo` cookie and runs Next's request handler inside an
// AsyncLocalStorage context holding that id. getDb() (lib/db.ts) reads the id
// here and returns that visitor's connection. Every query in the app already
// goes through getDb(), so nothing else needs to know demo mode exists.
//
// The sandbox file is created lazily on the first getDb() call, so static
// assets and bots that never render a page never cost a database.

export type DemoRequestStore = { sessionId: string };

type DemoSession = { db: Database.Database; lastSeen: number };

declare const globalThis: {
  /** Created by scripts/demo-server.mjs; shared through the global so the
   *  plain-JS server and the Next bundle hold the same instance. */
  __zero_demo_als?: AsyncLocalStorage<DemoRequestStore>;
  /** Insertion order = recency: an access moves the entry to the end. */
  __zero_demo_sessions?: Map<string, DemoSession>;
  __zero_demo_sweeper?: ReturnType<typeof setInterval>;
};

// Ids are UUIDs the server minted; anything else is refused before it can
// reach a file path.
const DEMO_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export function isValidDemoId(id: string): boolean {
  return DEMO_ID_RE.test(id);
}

/** Root of the demo files. Must sit inside the checkout: seed-dev refuses to
 *  write a database anywhere else. */
export function demoDir(): string {
  return process.env.ZERO_DEMO_DIR ?? path.join(process.cwd(), "data", "demo");
}

export function demoTemplatePath(): string {
  return path.join(demoDir(), "template.db");
}

function sessionPath(id: string): string {
  return path.join(demoDir(), "sessions", `${id}.db`);
}

function sessions(): Map<string, DemoSession> {
  globalThis.__zero_demo_sessions ??= new Map();
  return globalThis.__zero_demo_sessions;
}

/** The current request's sandbox id. Throws outside a demo request — a query
 *  with no visitor behind it has no database to go to. */
export function currentDemoSessionId(): string {
  const id = globalThis.__zero_demo_als?.getStore()?.sessionId;
  if (!id) {
    throw new Error(
      "Demo mode: no visitor session for this query. Start the demo with `npm run demo`, which assigns one per request."
    );
  }
  return id;
}

function closeAndDelete(id: string, session: DemoSession): void {
  try {
    session.db.close();
  } catch {
    // Already closed
  }
  const file = sessionPath(id);
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(file + suffix, { force: true });
  }
  sessions().delete(id);
}

/** Close and delete sandboxes idle past the limit. Returns how many went. */
export function sweepDemoSessions(now: number = Date.now()): number {
  const cutoff = now - demoIdleHours() * 60 * 60 * 1000;
  let removed = 0;
  for (const [id, session] of sessions()) {
    if (session.lastSeen < cutoff) {
      closeAndDelete(id, session);
      removed++;
    }
  }
  return removed;
}

function startSweeper(): void {
  if (globalThis.__zero_demo_sweeper) return;
  const timer = setInterval(() => sweepDemoSessions(), SWEEP_INTERVAL_MS);
  timer.unref();
  globalThis.__zero_demo_sweeper = timer;
}

/** The visitor's own database, copied from the template on first use. */
export function getDemoDb(
  sessionId: string = currentDemoSessionId(),
  now: number = Date.now()
): Database.Database {
  if (!isValidDemoId(sessionId)) {
    throw new Error("Demo mode: invalid session id");
  }

  const map = sessions();
  const existing = map.get(sessionId);
  if (existing) {
    existing.lastSeen = now;
    map.delete(sessionId);
    map.set(sessionId, existing);
    return existing.db;
  }

  const template = demoTemplatePath();
  if (!fs.existsSync(template)) {
    throw new Error(
      `Demo mode: template database missing at ${template}. Start the demo with \`npm run demo\`, which builds it.`
    );
  }

  // Make room before opening another file.
  const max = demoMaxSessions();
  for (const [id, session] of map) {
    if (map.size < max) break;
    closeAndDelete(id, session);
  }

  const file = sessionPath(sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.copyFileSync(template, file);

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  map.set(sessionId, { db, lastSeen: now });
  startSweeper();
  return db;
}

/** Test hook: close every sandbox and forget them. */
export function resetDemoSessionsForTests(): void {
  for (const [id, session] of sessions()) closeAndDelete(id, session);
  if (globalThis.__zero_demo_sweeper) {
    clearInterval(globalThis.__zero_demo_sweeper);
    globalThis.__zero_demo_sweeper = undefined;
  }
}
