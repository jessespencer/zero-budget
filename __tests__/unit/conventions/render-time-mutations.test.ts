import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Mechanical enforcement of the "don't mutate during a render pass" rule in
 * CLAUDE.md ("System visibility").
 *
 * The failure this encodes is real and shipped: /schedules used to call
 * `postDueSchedules()` straight from its page component, so every load that
 * posted a due schedule logged
 *
 *   Route /schedules used "revalidatePath /schedules" during render which is
 *   unsupported.
 *
 * — `revalidatePath()` throws when called during render. It was invisible in
 * the UI (the throw is caught and logged by Next, the row still posted) and sat
 * in the Pi's pm2 error log for weeks. `4efc80a` moved the call into the (app)
 * layout behind `catchUpDueSchedules()` and added the `revalidate: false`
 * escape hatch. Nothing stopped the next page from re-introducing it.
 *
 * Three checks, in order of how general they are:
 *
 *   1. No server component imports a server action that revalidates. This is
 *      the shape of the original bug and it catches it exactly (verified
 *      against the tree at 4efc80a^).
 *   2. A `lib/` module reached from a server component may call such an action
 *      only with `revalidate: false` — the one sanctioned indirect path.
 *   3. The sanctioned exception itself keeps its guards: request-`cache()`d, and
 *      passing `revalidate: false`.
 *
 * What is NOT encoded: whether a mutation is "idempotent catch-up work due on
 * wall-clock time" versus a user action in disguise. That's the judgment half
 * of the rule and it stays prose. This test only ensures a render-time mutation
 * can't take the revalidate path, which is the half that throws.
 *
 * No allowlist: the codebase is clean on all three today. A failure here means
 * the rule was broken in the change under test, not inherited.
 */

const ROOT = join(__dirname, "..", "..", "..");
const rel = (f: string) => relative(ROOT, f);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".next")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const APP_FILES = walk(join(ROOT, "app"));

/** Anything that reaches `revalidatePath`, directly or through our two wrappers. */
const REVALIDATES = /\brevalidatePath\s*\(|\brevalidateAll\s*\(|\brevalidateMoneyPages\s*\(/;

/** Index just past the matching close of the delimiter pair opening at `open`. */
function matchDelim(src: string, open: number, o: string, c: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return i + 1;
  }
  return src.length;
}

/**
 * Body of the function declared at `from`, brace-matched.
 *
 * Skipping the parameter list first is load-bearing, not tidiness: the first
 * `{` after `export async function postDueSchedules` opens its destructured
 * parameter (`{ revalidate = true }`), so matching from there returns the
 * signature and the action reads as revalidating nothing.
 *
 * Slicing to the next `\nexport` instead would swallow the private helpers that
 * trail the last export in a file — `advanceScheduleInTransaction` sits below
 * `postDueSchedules` and revalidates nothing, but a naive slice would attribute
 * it upward. Braces inside strings or comments can over-extend a body; that
 * costs a false positive at worst, and there are none today.
 */
function functionBody(src: string, from: number): string {
  const params = src.indexOf("(", from);
  if (params === -1) return "";
  const open = src.indexOf("{", matchDelim(src, params, "(", ")"));
  if (open === -1) return "";
  return src.slice(open, matchDelim(src, open, "{", "}"));
}

/** Exported server actions that revalidate, keyed by name → defining file. */
function collectRevalidatingActions(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of APP_FILES) {
    if (!file.endsWith("actions.ts")) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes('"use server"')) continue;
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
      if (REVALIDATES.test(functionBody(src, m.index))) found.set(m[1], rel(file));
    }
  }
  return found;
}

/** Named import bindings in a file, aliases resolved to the imported name. */
function importedNames(src: string): { name: string; from: string }[] {
  const out: { name: string; from: string }[] = [];
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) out.push({ name, from: m[2] });
    }
  }
  return out;
}

/** `.tsx` files under app/ that render on the server. */
const SERVER_COMPONENTS = APP_FILES.filter(
  (f) => f.endsWith(".tsx") && !readFileSync(f, "utf8").includes('"use client"')
);

const REVALIDATING_ACTIONS = collectRevalidatingActions();

describe("render-time mutations", () => {
  it("finds the server actions that revalidate", () => {
    // Guards the detector itself: a rename of revalidateAll that silently
    // emptied this map would make every check below vacuously pass.
    expect(REVALIDATING_ACTIONS.size).toBeGreaterThan(50);
    expect(REVALIDATING_ACTIONS.has("postDueSchedules")).toBe(true);
  });

  it("no server component imports a revalidating server action", () => {
    const violations: string[] = [];
    for (const file of SERVER_COMPONENTS) {
      for (const { name } of importedNames(readFileSync(file, "utf8"))) {
        const definedIn = REVALIDATING_ACTIONS.get(name);
        if (definedIn) {
          violations.push(`${rel(file)} imports ${name}() from ${definedIn}`);
        }
      }
    }
    expect(
      violations,
      "A server component runs during render, where revalidatePath() throws.\n" +
        "Move the mutation into a server action fired from an event handler. If it\n" +
        "is genuinely idempotent wall-clock catch-up work, route it through a\n" +
        "cache()d lib/ helper that passes `revalidate: false` — see\n" +
        "lib/schedules-catchup.ts, the only sanctioned instance."
    ).toEqual([]);
  });

  it("lib helpers reached from a server component pass revalidate: false", () => {
    // One hop is enough for the shape we have; a deeper chain would need real
    // module resolution. Named here so a future second hop is a known gap
    // rather than a silent one.
    const reached = new Set<string>();
    for (const file of SERVER_COMPONENTS) {
      for (const { from } of importedNames(readFileSync(file, "utf8"))) {
        if (!from.startsWith("@/lib/")) continue;
        const base = join(ROOT, from.slice(2));
        const resolved = [`${base}.ts`, `${base}.tsx`].find(existsSync);
        if (resolved) reached.add(resolved);
      }
    }

    const violations: string[] = [];
    for (const file of reached) {
      const src = readFileSync(file, "utf8");
      for (const action of REVALIDATING_ACTIONS.keys()) {
        // Skip the import line itself; only real call sites matter.
        for (const m of src.matchAll(new RegExp(`\\b${action}\\s*\\(([^)]*)\\)`, "g"))) {
          if (!/revalidate\s*:\s*false/.test(m[1])) {
            violations.push(`${rel(file)} calls ${action}() without revalidate: false`);
          }
        }
      }
    }
    expect(
      violations,
      "This helper is reachable from a render pass, so any revalidatePath() it\n" +
        "triggers throws. Give the action a `revalidate` option and pass false."
    ).toEqual([]);
  });

  it("keeps the sanctioned catch-up exception guarded", () => {
    const src = readFileSync(join(ROOT, "lib", "schedules-catchup.ts"), "utf8");

    // Request-scoped cache: the (app) layout and /schedules both call this on a
    // hard load of /schedules, and the due-schedule scan is a correlated
    // NOT EXISTS over transactions — not something to run twice per request.
    expect(src).toMatch(/export const catchUpDueSchedules = cache\(/);
    expect(src).toMatch(/postDueSchedules\(\{\s*revalidate:\s*false\s*\}\)/);
  });

  it("postDueSchedules only revalidates when a caller opts in", () => {
    const src = readFileSync(join(ROOT, "app", "(app)", "schedules", "actions.ts"), "utf8");
    const m = src.match(/export\s+async\s+function\s+postDueSchedules/);
    expect(m).not.toBeNull();
    const body = functionBody(src, m!.index!);
    // Every revalidate inside the action must sit behind the flag.
    for (const line of body.split("\n")) {
      if (REVALIDATES.test(line)) {
        expect(body).toMatch(/if\s*\([^)]*\brevalidate\b[^)]*\)\s*\{[^}]*revalidateAll\(\)/);
      }
    }
    expect(src).toMatch(/revalidate\s*=\s*true/);
  });
});
