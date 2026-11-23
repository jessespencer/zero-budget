#!/usr/bin/env node
// scripts/demo-server.mjs — `npm run demo`
//
// Serves the production build as a public demo where every visitor gets a
// private copy of the seed:dev household. Nothing a visitor does is seen by
// anyone else, and nothing survives: a sandbox idle for ZERO_DEMO_IDLE_HOURS
// (default 4) is deleted, and a restart wipes them all.
//
// What this wrapper adds over `next start`:
//   1. Builds data/demo/template.db (migrations + seed-dev) at boot, and again
//      when the date changes, so the demo's "13 months ending today" stays true.
//   2. Gives each visitor a `zero_demo` cookie (a random UUID).
//   3. Runs Next's handler inside an AsyncLocalStorage holding that id, which
//      getDb() (lib/db.ts → lib/demo.ts) uses to pick the visitor's database.
//
// Needs a production build first: `npm run build`. Hosting notes: docs/DEMO.md.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { buildSeededDb } from "./lib/seeded-db.mjs";

const REPO_ROOT = join(import.meta.dirname, "..");
process.chdir(REPO_ROOT);

const PORT = Number(process.env.PORT ?? 4041);
const HOST = process.env.HOSTNAME ?? "0.0.0.0";
const BUILD_DIR = process.env.NEXT_BUILD_DIR ?? ".next-prod";
const DEMO_DIR = process.env.ZERO_DEMO_DIR ?? join(REPO_ROOT, "data", "demo");
const COOKIE = "zero_demo"; // keep in sync with DEMO_COOKIE in lib/demo-config.ts
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

if (!existsSync(join(REPO_ROOT, BUILD_DIR, "BUILD_ID"))) {
  console.error(`No production build in ${BUILD_DIR}/. Run \`npm run build\` first.`);
  process.exit(1);
}

// Demo mode is decided here, before Next loads, so nothing can boot it
// half-configured. ZERO_DB_PATH is dropped: demo mode never opens it.
process.env.ZERO_DEMO = "1";
process.env.ZERO_DEMO_DIR = DEMO_DIR;
process.env.NEXT_BUILD_DIR = BUILD_DIR;
process.env.NODE_ENV = "production";
delete process.env.ZERO_DB_PATH;

// --- template -------------------------------------------------------------

const templatePath = join(DEMO_DIR, "template.db");
let templateDay = "";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Build beside the live file, then rename over it: a visitor arriving
// mid-rebuild copies the old template rather than a half-written one.
function rebuildTemplate() {
  mkdirSync(DEMO_DIR, { recursive: true });
  const next = join(DEMO_DIR, "template.next.db");
  for (const suffix of ["", "-wal", "-shm"]) rmSync(next + suffix, { force: true });
  buildSeededDb(next);
  renameSync(next, templatePath);
  templateDay = today();
  console.log(`[demo] template built for ${templateDay}`);
}

// Sandboxes from a previous run point at a stale template and nothing tracks
// them any more, so a boot starts from none.
rmSync(join(DEMO_DIR, "sessions"), { recursive: true, force: true });
rebuildTemplate();
setInterval(() => {
  if (today() !== templateDay) {
    try {
      rebuildTemplate();
    } catch (err) {
      console.error("[demo] template rebuild failed; keeping the old one", err);
    }
  }
}, 15 * 60 * 1000).unref();

// --- server ---------------------------------------------------------------

// Shared with lib/demo.ts through the global — see the comment there.
globalThis.__zero_demo_als ??= new AsyncLocalStorage();
const als = globalThis.__zero_demo_als;

function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function isHttps(req) {
  const proto = req.headers["x-forwarded-proto"];
  return (Array.isArray(proto) ? proto[0] : proto)?.split(",")[0].trim() === "https";
}

// Next sets its own cookies with setHeader("set-cookie", …), which would
// replace ours. Fold ours into whatever it sets.
function keepCookie(res, cookie) {
  res.setHeader("Set-Cookie", cookie);
  const setHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() !== "set-cookie") return setHeader(name, value);
    const values = Array.isArray(value) ? value : [String(value)];
    return setHeader(name, values.includes(cookie) ? values : [cookie, ...values]);
  };
}

const { default: next } = await import("next");
const app = next({ dev: false, dir: REPO_ROOT, hostname: HOST, port: PORT });
const handle = app.getRequestHandler();
await app.prepare();

createServer((req, res) => {
  let sessionId = readCookie(req.headers.cookie, COOKIE);
  if (!sessionId || !UUID_RE.test(sessionId)) {
    sessionId = randomUUID();
    const secure = isHttps(req) ? "; Secure" : "";
    keepCookie(
      res,
      `${COOKIE}=${sessionId}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure}`
    );
  }
  als.run({ sessionId }, () => {
    handle(req, res).catch((err) => {
      console.error("[demo] request failed", err);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
}).listen(PORT, HOST, () => {
  console.log(`[demo] Zero demo on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});
