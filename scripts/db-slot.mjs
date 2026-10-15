#!/usr/bin/env node
// scripts/db-slot.mjs
//
// Switch the LOCAL dev database (data/zero.db) between three named "slots" so
// you can test different app states without losing data:
//
//   onboarding  empty schema (system categories only) → the first-run flow
//   seeded      the deterministic seed:dev fixture     → a populated demo
//   full        your real working DB                   → captured from current
//
// Model:
//   - Slot files live next to the DB in data/slots/<slot>.db (clean, no WAL).
//   - `full` is REAL data: its edits are saved back to its slot before you
//     switch away, so nothing is lost.
//   - `onboarding` / `seeded` are DISPOSABLE fixtures: switching to them always
//     loads a pristine copy; edits you make while on them are discarded on the
//     next switch. Use `reset <slot>` to regenerate the pristine copy in place.
//
// The active slot is tracked in data/slots/.active.
//
// SAFETY: only ever touches data/zero.db and data/slots/ inside this repo. Your
// current DB is captured into the `full` slot before the first swap, so a swap
// can never lose your working data.
//
// Usage:
//   node scripts/db-slot.mjs status
//   node scripts/db-slot.mjs onboarding | seeded | full
//   node scripts/db-slot.mjs reset onboarding | reset seeded
//
// After switching, restart the dev server — the running process holds an open
// handle to the old DB file and won't see the swap until it reconnects.

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const LIVE = resolve(process.env.ZERO_DB_PATH ?? join(REPO_ROOT, "data", "zero.db"));
const SLOTS_DIR = join(REPO_ROOT, "data", "slots");
const MARKER = join(SLOTS_DIR, ".active");

const SLOTS = ["onboarding", "seeded", "full"];
const DISPOSABLE = new Set(["onboarding", "seeded"]);

const slotPath = (slot) => join(SLOTS_DIR, `${slot}.db`);

function die(msg) {
  console.error(`[db-slot] ${msg}`);
  process.exit(1);
}

// Remove a SQLite file and its WAL/SHM sidecars so no stale journal replays.
function removeDb(path) {
  for (const p of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(p)) rmSync(p);
  }
}

// Produce a clean single-file copy of `src` at `dest` via VACUUM INTO. We
// checkpoint first so any pending WAL from a running dev server is folded in,
// then VACUUM INTO emits a compact, sidecar-free file — ideal for a slot.
function vacuumInto(src, dest) {
  if (!existsSync(src)) die(`source DB missing: ${src}`);
  removeDb(dest); // VACUUM INTO refuses to overwrite an existing file
  const db = new Database(src);
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

// Remove the per-migration *.pre-migration-vN.backup files the migrator drops
// next to a DB — noise for a throwaway slot we can always rebuild.
function cleanMigrationBackups(dest) {
  const dir = dirname(dest);
  const prefix = `${basename(dest)}.pre-migration-`;
  for (const f of readdirSync(dir)) {
    if (f.startsWith(prefix) && f.endsWith(".backup")) rmSync(join(dir, f));
  }
}

// Build an empty, fully-migrated DB (schema + is_system categories only).
function buildOnboarding(dest) {
  removeDb(dest);
  new Database(dest).close(); // create the file so the migrator can open it
  execFileSync("node", [join(__dirname, "apply-pending-migrations.mjs")], {
    env: { ...process.env, ZERO_DB_PATH: dest },
    stdio: "inherit",
  });
  cleanMigrationBackups(dest);
}

// Build the deterministic demo fixture: migrate an empty DB, then seed it.
function buildSeeded(dest) {
  buildOnboarding(dest); // seed-dev wipes+inserts; it needs the schema present
  execFileSync("node", [join(__dirname, "seed-dev.mjs")], {
    env: { ...process.env, ZERO_DB_PATH: dest },
    stdio: "inherit",
  });
}

function ensureSlot(slot) {
  const path = slotPath(slot);
  if (existsSync(path)) return;
  if (slot === "onboarding") buildOnboarding(path);
  else if (slot === "seeded") buildSeeded(path);
  else if (slot === "full") {
    // First-ever run: the current live DB IS the user's real data. Capture it.
    if (!existsSync(LIVE)) die(`no live DB at ${LIVE} to seed the 'full' slot`);
    vacuumInto(LIVE, path);
  }
}

function readActive() {
  if (!existsSync(MARKER)) return null;
  return readFileSync(MARKER, "utf8").trim() || null;
}

function writeActive(slot) {
  writeFileSync(MARKER, slot + "\n");
}

function summarize(path) {
  if (!existsSync(path)) return "(no DB)";
  const db = new Database(path, { readonly: true });
  try {
    const q = (sql) => {
      try {
        return db.prepare(sql).get()?.n ?? 0;
      } catch {
        return "—";
      }
    };
    // User-facing groups exclude is_system / income plumbing (see budget-engine).
    const groups = q(
      "SELECT COUNT(*) n FROM category_groups WHERE is_system = 0 AND is_income = 0"
    );
    const cats = q(
      `SELECT COUNT(*) n FROM categories c
       JOIN category_groups g ON g.id = c.category_group_id
       WHERE g.is_system = 0`
    );
    const accts = q("SELECT COUNT(*) n FROM accounts");
    const txns = q("SELECT COUNT(*) n FROM transactions");
    return `groups: ${groups}, categories: ${cats}, accounts: ${accts}, transactions: ${txns}`;
  } finally {
    db.close();
  }
}

function status() {
  const active = readActive();
  mkdirSync(SLOTS_DIR, { recursive: true });
  console.log(`Active slot: ${active ?? "(unknown — never switched)"}`);
  console.log(`Live DB:     ${LIVE}`);
  console.log(`             ${summarize(LIVE)}`);
  console.log("");
  console.log("Slots:");
  for (const slot of SLOTS) {
    const p = slotPath(slot);
    const mark = slot === active ? "→" : " ";
    console.log(`  ${mark} ${slot.padEnd(11)} ${existsSync(p) ? summarize(p) : "(not built yet)"}`);
  }
}

function switchTo(target) {
  if (!SLOTS.includes(target)) die(`unknown slot '${target}' (use: ${SLOTS.join(", ")})`);
  mkdirSync(SLOTS_DIR, { recursive: true });

  const active = readActive();

  // Guarantee the user's current real data is safe in the 'full' slot before we
  // ever overwrite the live DB. On a fresh setup there's no marker yet.
  ensureSlot("full");

  // Persist edits from the outgoing slot — but only for 'full' (real data).
  // Disposable fixtures are never written back, so they stay pristine.
  if (active && active !== target && !DISPOSABLE.has(active) && existsSync(LIVE)) {
    vacuumInto(LIVE, slotPath(active));
    console.log(`[db-slot] saved live edits back to '${active}' slot`);
  }

  ensureSlot(target);

  removeDb(LIVE);
  vacuumInto(slotPath(target), LIVE);
  writeActive(target);

  console.log(`\n[db-slot] switched to '${target}'`);
  console.log(`          ${summarize(LIVE)}`);
  console.log(`\nRestart the dev server to pick up the swap (e.g. PORT=3000 npm run dev).`);
}

function reset(slot) {
  if (!DISPOSABLE.has(slot)) die(`only disposable slots can be reset: ${[...DISPOSABLE].join(", ")}`);
  if (slot === "onboarding") buildOnboarding(slotPath(slot));
  else buildSeeded(slotPath(slot));
  console.log(`[db-slot] rebuilt pristine '${slot}' slot`);
  if (readActive() === slot) {
    removeDb(LIVE);
    vacuumInto(slotPath(slot), LIVE);
    console.log(`[db-slot] reloaded '${slot}' into the live DB — restart dev to see it`);
  }
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case undefined:
  case "status":
    status();
    break;
  case "reset":
    reset(arg ?? die("reset needs a slot: onboarding | seeded"));
    break;
  case "onboarding":
  case "seeded":
  case "full":
    switchTo(cmd);
    break;
  default:
    die(`unknown command '${cmd}'. Use: status | onboarding | seeded | full | reset <slot>`);
}
