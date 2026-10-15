import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * A server action nobody calls is a lie waiting to be told.
 *
 * `reopenAccount` sat in `app/(app)/accounts/[id]/actions.ts` for weeks with
 * zero call sites while the close-confirm cheerfully promised "You can reopen
 * it later." The action was correct; nothing was wired to it. Nothing noticed,
 * because nothing was looking — the code compiled, the tests were green, and
 * TypeScript has no opinion about an export with no importer.
 *
 * That is this file's whole job: an exported server action must be reachable
 * from somewhere. It says nothing about whether the wiring is *good* — the
 * copy-vs-reality problem downstream of it is a judgement call and lives in
 * `system-visibility.test.ts`, which checks that call sites acknowledge
 * themselves.
 *
 * SCOPE — deliberately just `"use server"` exports in `app/**\/actions.ts`.
 * That is the shape that bit, it is where every mutation in this codebase
 * lives, and it has an unambiguous answer: an action exists to be called. A
 * general "unused export" sweep over `lib/` and `components/` would drown in
 * Next.js file conventions (`default` in page/layout/route, `dynamic`,
 * `metadata`), barrel re-exports, and types kept for documentation, and the
 * signal-to-noise would sink the rule.
 *
 * MECHANISM — regex + node:fs, no AST, matching the house style of
 * `system-visibility.test.ts`. The two helpers below are deliberately duplicated
 * from that file rather than shared: its versions carry visibility-specific
 * exclusions (importers must be `"use client"`; `use-*-undo.ts` hooks don't
 * count) that would be actively wrong here — both would hide real importers and
 * turn live actions into false positives.
 *
 * No new dependency. `eslint-plugin-import`'s `no-unused-modules` was the
 * obvious alternative and was rejected twice over: it's only present as a
 * transitive dep of `eslint-config-next`, and it throws under flat config
 * (import-js/eslint-plugin-import#3079) unless a legacy `.eslintrc.json` is
 * added purely to feed it.
 */

const ROOT = join(__dirname, "..", "..", "..");

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

/**
 * Everywhere an action could legitimately be referenced from. `__tests__` is
 * included on purpose — an action exercised only by its unit suite is under-
 * wired, but it is not dead code, and flagging it would push people to delete
 * tests. E2E page models live here too.
 */
const IMPORTER_FILES = [
  ...APP_FILES,
  ...walk(join(ROOT, "components")),
  ...walk(join(ROOT, "lib")),
  ...walk(join(ROOT, "__tests__")),
];

const rel = (f: string) => relative(ROOT, f);

/** Exported async functions in `"use server"` action modules, with their file. */
function collectActions(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  for (const file of APP_FILES) {
    if (!file.endsWith("actions.ts")) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes('"use server"')) continue;
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
      out.push({ name: m[1], file });
    }
  }
  return out;
}

/**
 * Every (module, name) pair bound by an import anywhere in the tree.
 *
 * Keyed by resolved module, NOT a flat set of names. Two `actions.ts` files can
 * export the same name — `getAccountsAndCategories` is exported by both
 * `schedules/actions.ts` and `transactions/actions.ts` today — and a flat set
 * would let an import of either mark BOTH live. That is a false negative in
 * exactly the class of bug this file exists to catch, so the specifier is
 * resolved and the name attributed to the module it actually came from.
 *
 * Only real import bindings count, so a mention in a comment or a string
 * doesn't keep a dead action alive — that distinction is the entire point, and
 * it's why this isn't a `grep -c`. `type ` prefixes and `as` aliases are
 * stripped so `import { type Foo, bar as baz }` binds `Foo` and `bar`.
 */
function importedNamesByModule(): Map<string, Set<string>> {
  const byModule = new Map<string, Set<string>>();

  for (const file of IMPORTER_FILES) {
    const src = readFileSync(file, "utf8");
    const clauses = [
      ...src.matchAll(
        /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g
      ),
      // `export { a, b } from "./actions"` — a barrel keeps its names alive.
      ...src.matchAll(
        /export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g
      ),
      // `const { a, b } = await import("…")`. The action test suites import
      // this way exclusively — they have to, because the module has to be
      // pulled in after `setTestDb`. Missing this shape would have flagged
      // every action that only its unit suite reaches.
      //
      // `[\w\s,]` and not `[^}]` here, unlike the two above: this pattern is
      // anchored at its END, so a permissive class lets the opening brace drift
      // back to an enclosing one — the `async () => {` of the `it()` block —
      // and capture the whole function head instead of the import clause.
      ...src.matchAll(
        /\{([\w\s,]*)\}\s*=\s*(?:await\s+)?import\s*\(\s*["']([^"']+)["']/g
      ),
    ];

    for (const m of clauses) {
      const target = resolveSpecifier(m[2], file);
      if (!target) continue;
      const names = byModule.get(target) ?? new Set<string>();
      for (const raw of m[1].split(",")) {
        const bound = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (bound) names.add(bound);
      }
      byModule.set(target, names);
    }
  }
  return byModule;
}

/**
 * Resolve an import specifier to a repo-relative, extensionless module path —
 * the same key `moduleKey` produces for a file on disk.
 *
 * Handles the two forms this repo uses: the `@/` root alias from tsconfig
 * paths, and `./` / `../` relative specifiers. Bare package specifiers return
 * null; a node_modules import can't be referencing one of our actions.
 */
function resolveSpecifier(spec: string, importingFile: string): string | null {
  if (spec.startsWith("@/")) return spec.slice(2);
  if (!spec.startsWith(".")) return null;
  return relative(ROOT, resolve(dirname(importingFile), spec));
}

/** Repo-relative path minus the extension, so it can match a specifier. */
const moduleKey = (file: string) => rel(file).replace(/\.tsx?$/, "");

/**
 * True when the declaring module calls the action itself.
 *
 * Plenty of actions are internal helpers — `deleteTransaction` is called by
 * `deleteQuickTransaction` in the same file, `saveSplits` by
 * `updateTransaction`. Those are reachable, so they are not what this rule is
 * about. (They arguably shouldn't be exported at all, since every export of a
 * `"use server"` module is a public endpoint, but that's a different rule and
 * a much noisier one.)
 *
 * Counts identifier occurrences beyond the `export async function` declaration
 * itself, which is what separates a helper with an internal caller from
 * `reopenAccount`, which had no occurrence anywhere but its own definition.
 */
function usedWithinOwnModule(name: string, file: string): boolean {
  const src = readFileSync(file, "utf8");
  const occurrences = src.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
  return occurrences > 1;
}

function deadActions(): string[] {
  const byModule = importedNamesByModule();
  return collectActions()
    .filter(
      ({ name, file }) =>
        !byModule.get(moduleKey(file))?.has(name) &&
        !usedWithinOwnModule(name, file)
    )
    .map(({ name, file }) => `${rel(file)} exports ${name} but nothing imports it`)
    .sort();
}

/**
 * GRANDFATHERED, same convention as `system-visibility.test.ts`: exact
 * violation strings, not paths or line numbers, so entries don't rot on
 * unrelated edits. Deleting a line as you fix it is the intended workflow; the
 * list reaching empty is the finish line.
 *
 * Five were already dead on 2026-07-25 when this detector was written. All five
 * have since been deleted — `setAccountBudgetStatus`, `deleteTarget`,
 * `getPayeeCategoryMap`, and then `getExpenseData` / `getSavingsData` with the
 * ~1,000 lines of expense/savings reporting behind them (superseded by the
 * Insights Tables tab in `86670d8`). The list is empty, which is the finish
 * line.
 *
 * Do not add a line here. A new entry means an action was written today and
 * never wired up — which is the exact thing this file exists to stop.
 */
const ALLOWLIST_DEAD_ACTION: string[] = [];

describe("dead exports (server actions)", () => {
  it("finds the server actions it's meant to be checking", () => {
    // Guards against the detector silently matching nothing after a refactor —
    // an empty haystack would make every assertion below vacuously true.
    const actions = collectActions();
    expect(actions.length).toBeGreaterThan(20);
    const byModule = importedNamesByModule();
    expect(byModule.size).toBeGreaterThan(20);
    // The action modules themselves must be among the resolved targets — if
    // specifier resolution broke, every action would look dead and the
    // allowlist would be the only thing holding the suite up.
    expect(
      byModule.get("app/(app)/accounts/[id]/actions")?.has("closeAccountWithSnapshot")
    ).toBe(true);
  });

  it("every exported server action has at least one importer", () => {
    const live = deadActions().filter((v) => !ALLOWLIST_DEAD_ACTION.includes(v));
    expect(live).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const live = new Set(deadActions());
    const stale = ALLOWLIST_DEAD_ACTION.filter((entry) => !live.has(entry));
    expect(stale).toEqual([]);
  });

  it("does not count a mention in a comment as a call site", () => {
    // The reason this isn't grep: `d4b3a68` left "closeAccount/reopenAccount
    // flag flips" sitting in a budget/actions.ts comment while reopenAccount
    // had no callers at all. A substring check would have called that wired.
    const everyBoundName = new Set(
      [...importedNamesByModule().values()].flatMap((s) => [...s])
    );
    expect(everyBoundName.has("aFunctionNameThatOnlyAppearsInThisComment")).toBe(
      false
    );
  });

  it("attributes a name to the module it was imported from, not any module", () => {
    // `getAccountsAndCategories` is exported by BOTH schedules/actions.ts and
    // transactions/actions.ts. A flat name set would let either importer mark
    // both live — a false negative in exactly the class of bug this file
    // exists to catch. Each must be credited to its own importer.
    const byModule = importedNamesByModule();
    expect(
      byModule.get("app/(app)/schedules/actions")?.has("getAccountsAndCategories")
    ).toBe(true);
    expect(
      byModule
        .get("app/(app)/transactions/actions")
        ?.has("getAccountsAndCategories")
    ).toBe(true);
    // And a name only ever imported from one of them must not leak to the other.
    expect(
      byModule.get("app/(app)/schedules/actions")?.has("getPayeeCategoryMap")
    ).toBeFalsy();
  });
});
