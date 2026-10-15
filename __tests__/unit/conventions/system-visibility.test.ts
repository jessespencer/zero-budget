import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Mechanical enforcement of the "System visibility" rule in CLAUDE.md.
 *
 * The rule is prose, and prose decays — ~70 mutations drifted apart precisely
 * because feedback was decided per-call-site with no shared criterion. Two
 * parts of that rule are mechanical enough for a machine to decide:
 *
 *   1. A server action with a `*WithSnapshot` variant is consequential and
 *      undoable by construction. Its call sites must fire a toast.
 *   2. A delete-shaped action with NO snapshot variant is irreversible. Its
 *      call sites must sit behind `ConfirmDialog`.
 *
 * Everything else in the decision table (reversible + visible on screen ⇒ no
 * feedback needed) requires judgment about whether an effect is on-screen, and
 * is deliberately not encoded here.
 *
 * The file-level toast check is coarse by design: if a file imports the action
 * and also imports `useToast`, that counts. A full per-call-site check needs an
 * AST (the primary call and its `forward:`/`backward:` re-calls are textually
 * identical, and the wrappers vary — `runMutation`, `startTransition`, custom
 * `assignWithUndo`, a bare `undoRedo.push`). Two things narrow the coarse net
 * without paying for an AST:
 *
 *   - `use-*-undo.ts` hooks are skipped as importers. They wrap `push()` and
 *     correctly never toast — the toast lives in the component that calls the
 *     hook helper (`pushValueUpdate`, …), which imports the helper, not the
 *     action. Attributing the missing toast to the hook was a false positive
 *     that kept six `use-net-worth-undo.ts` entries alive with nothing to fix.
 *   - `snapshotBlockWithoutToast` re-checks the one wrapper shape that IS
 *     brace-matchable — a `runMutation`/`startTransition` body — per-block, so
 *     one toasting branch can't launder a silent sibling branch in the same
 *     file (the approve-pending money-mover in `transactions-client` was
 *     exactly this: the file toasts in delete, so the file-level net passed it).
 *     Brace-matching counts one toast per body, so the closure re-calls inside
 *     a body don't produce spurious flags.
 *
 * THE ALLOWLISTS ARE EMPTY. They were seeded on 2026-07-19 with the 34
 * violations that existed then, to be deleted one at a time as each was fixed;
 * the last three went on 2026-07-27. Every rule below is now enforced outright,
 * so a failure is a violation introduced today rather than a pre-existing one.
 *
 * They stay declared, and empty, on purpose — a named list to delete from is a
 * much better shape than a diff to a test's assertions if a future sweep ever
 * needs one. Do not put anything back into them to make a build pass.
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
const ALL_SOURCE = [...APP_FILES, ...walk(join(ROOT, "components"))];

/** Server actions, keyed by exported name. */
function collectActions(): Set<string> {
  const names = new Set<string>();
  for (const file of APP_FILES) {
    if (!file.endsWith("actions.ts")) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes('"use server"')) continue;
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
      names.add(m[1]);
    }
  }
  return names;
}

/** True for the `use-*-undo.ts` undo-wrapper hooks (see the header note). */
const isUndoHook = (file: string) => /use-[a-z-]+-undo\.tsx?$/.test(file);

/** Client files that import `name` from anywhere. */
function importersOf(name: string): string[] {
  const out: string[] = [];
  for (const file of ALL_SOURCE) {
    if (file.endsWith("actions.ts")) continue;
    if (isUndoHook(file)) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes('"use client"')) continue;
    // Only count real import bindings, not incidental mentions in comments.
    const imports = src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g);
    for (const m of imports) {
      const bound = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());
      if (bound.includes(name)) {
        out.push(relative(ROOT, file));
        break;
      }
    }
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f);
const fileSrc = (f: string) => readFileSync(join(ROOT, f), "utf8");

/**
 * Bodies of every `startTransition(...)` callback in a file.
 *
 * Brace-matched rather than regexed, because the granularity has to be
 * per-block here: a file-level "does it contain `catch`" check passes a file
 * where one handler is guarded and three are not, which is exactly the state
 * `budget-table.tsx` and `manage-payees-dialog.tsx` are in today.
 *
 * Braces inside string literals or comments would confuse the matcher. That
 * costs a false positive at worst, and the allowlist absorbs it.
 */
function transitionBlocks(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/startTransition\s*\(/g)) {
    const brace = src.indexOf("{", m.index);
    if (brace === -1) continue;
    let depth = 0;
    let i = brace;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) break;
    }
    out.push(src.slice(brace, i + 1));
  }
  return out;
}

/** Server actions called inside a block, split by whether they're awaited. */
function calledActions(body: string): { awaited: string[]; floating: string[] } {
  const awaited = new Set<string>();
  const all = new Set<string>();
  for (const m of body.matchAll(/(await\s+)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!ACTIONS.has(m[2])) continue;
    all.add(m[2]);
    if (m[1]) awaited.add(m[2]);
  }
  return {
    awaited: [...awaited],
    floating: [...all].filter((n) => !awaited.has(n)),
  };
}

/**
 * Call sites that register an undo entry for a snapshot they received through
 * a callback rather than by importing the action.
 *
 * `importersOf` cannot see these: the file never names
 * `createTransferPairWithSnapshot`, it just takes a `TransferPairSnapshot` from
 * a child's `onConfirmed` prop and pushes it. That is exactly how
 * transfer-plan's missing toast survived this test and reached the app, where
 * two real transactions were written with no acknowledgement at all.
 *
 * The tell is importing a `*Snapshot` **type** and calling `.push(` on the
 * undo stack. If a file does both and never toasts, a consequential, undoable
 * mutation is happening with nothing to show for it.
 */
function snapshotPushWithoutToast(): string[] {
  const out: string[] = [];
  for (const file of ALL_SOURCE) {
    if (file.endsWith("actions.ts")) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes('"use client"')) continue;

    const importsSnapshotType = [
      ...src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g),
    ].some((m) =>
      m[1]
        .split(",")
        .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
        .some((n) => /Snapshot$/.test(n))
    );
    if (!importsSnapshotType) continue;

    const pushesUndo = /(?:undoRedo|undoStack)\.push\s*\(|\bpush\s*\(\s*\{/.test(src);
    if (!pushesUndo) continue;

    if (src.includes("useToast") || src.includes("toast(")) continue;
    out.push(`${rel(file)} pushes an undo entry for a snapshot with no toast`);
  }
  return out.sort();
}

/**
 * Every server-action call inside a `startTransition` whose failure is
 * invisible — either awaited with no `catch` around it, or fired without
 * `await` at all so the rejection never reaches anything.
 *
 * Keyed by action name rather than line number: line numbers churn on every
 * edit, and an allowlist that rots on unrelated changes gets deleted rather
 * than maintained.
 */
function unguardedTransitionCalls(): string[] {
  const out: string[] = [];
  for (const file of ALL_SOURCE) {
    if (file.endsWith("actions.ts")) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes('"use client"')) continue;
    for (const body of transitionBlocks(src)) {
      const guarded = body.includes("catch");
      const { awaited, floating } = calledActions(body);
      for (const name of floating) {
        out.push(`${rel(file)} fires ${name} inside startTransition without awaiting it`);
      }
      if (guarded) continue;
      for (const name of awaited) {
        out.push(`${rel(file)} awaits ${name} inside startTransition with no catch`);
      }
    }
  }
  return [...new Set(out)].sort();
}

/**
 * Bodies of every `runMutation(...)` / `startTransition(...)` callback in a
 * file — the two brace-matchable mutation wrappers. Same technique as
 * `transitionBlocks`, widened to `runMutation`, which is `/quick`'s and
 * `transactions-client`'s wrapper of choice.
 */
function mutationBlocks(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:runMutation|startTransition)\s*\(/g)) {
    const brace = src.indexOf("{", m.index);
    if (brace === -1) continue;
    let depth = 0;
    let i = brace;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) break;
    }
    out.push(src.slice(brace, i + 1));
  }
  return out;
}

/**
 * A `runMutation`/`startTransition` body that invokes a `*WithSnapshot` action
 * but contains no `toast(`. Per-block, so one toasting branch can't launder a
 * silent sibling — the hole the file-level check is blind to by construction.
 *
 * Only the calls made *inside the body* matter, so a body's own `forward:`/
 * `backward:` closures (which re-call the same action) are covered by the one
 * toast the body already requires — they don't each need their own.
 */
function snapshotBlockWithoutToast(): string[] {
  const out: string[] = [];
  for (const file of ALL_SOURCE) {
    if (file.endsWith("actions.ts") || isUndoHook(file)) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes('"use client"')) continue;
    for (const body of mutationBlocks(src)) {
      if (/\btoast\s*\(/.test(body)) continue;
      const snaps = [
        ...new Set(
          [...body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)]
            .map((m) => m[1])
            .filter((n) => SNAPSHOT_ACTIONS.includes(n))
        ),
      ].sort();
      if (snaps.length === 0) continue;
      out.push(
        `${rel(file)} has a transition block calling ${snaps.join("+")} with no toast`
      );
    }
  }
  return [...new Set(out)].sort();
}

const ACTIONS = collectActions();
const SNAPSHOT_ACTIONS = [...ACTIONS].filter((n) => n.endsWith("WithSnapshot"));
const DELETE_SHAPED = [...ACTIONS].filter(
  (n) =>
    /^(delete|remove|clear|purge)/i.test(n) &&
    !n.endsWith("WithSnapshot") &&
    !ACTIONS.has(`${n}WithSnapshot`)
);

/**
 * True when every call to `action` in `src` is the `backward:` half of a
 * MutationEntry — the undo of an add the user just made.
 *
 * The confirm rule exists because an un-snapshotted delete is irreversible.
 * An undo closure is not: `useUndoRedo` moves the entry to the redo stack, so
 * `forward()` puts the row straight back, and the server refuses the delete
 * outright when real budget history is at stake (`assertNoAssignHistory`,
 * migration 029 — its own comment records that both callers are exactly these
 * two undo paths). Putting a ConfirmDialog in front of Cmd+Z would make the
 * app worse, not safer, so "add a confirm" was never the fix for these two.
 *
 * Deliberately all-or-nothing: one direct call anywhere else in the file turns
 * the exemption off, so it can't launder a real user-initiated delete that
 * happens to share a file with an undo closure.
 */
function onlyUndoBackward(src: string, action: string): boolean {
  const calls = [...src.matchAll(new RegExp(`\\b${action}\\s*\\(`, "g"))];
  if (calls.length === 0) return false;
  const undoCalls = [
    ...src.matchAll(
      new RegExp(
        `backward:\\s*(?:async\\s*)?\\(\\s*\\)\\s*=>\\s*\\{?\\s*(?:await\\s+)?${action}\\s*\\(`,
        "g"
      )
    ),
  ];
  return undoCalls.length === calls.length;
}

/**
 * Violations that existed when this test was introduced (2026-07-19).
 *
 * Entries are exact violation strings, not filenames, so fixing one action in
 * a file doesn't silently exempt the others in it. Delete a line when you fix
 * it. Never add one — a new violation means the rule was broken today, and
 * the point of this test is to say so before it lands.
 *
 * The `use-net-worth-undo.ts` entries that used to live here are gone: that
 * file is a `use-*-undo.ts` hook, now skipped as an importer (see the header).
 * It wraps `push()` and correctly never toasts — the toast lives in the
 * component that calls its helpers, not in the hook.
 */
const ALLOWLIST_NO_TOAST: string[] = [
];

const ALLOWLIST_NO_CONFIRM: string[] = [];

/**
 * Per-block toast violations (added by the per-call-site widening). Same
 * grandfathered set the file-level `ALLOWLIST_NO_TOAST` already carries — every
 * entry here is a `*WithSnapshot` call inside a `runMutation`/`startTransition`
 * body that doesn't toast, and each is a known, pre-existing silent mutation.
 * The value of the separate list is regression protection: it fails on a NEW
 * silent branch even in a file that toasts elsewhere. Delete a line when you
 * fix it, same as the others.
 */
const ALLOWLIST_BLOCK_NO_TOAST: string[] = [
];

/**
 * Server-action calls inside a `startTransition` whose failure is invisible.
 *
 * Added 2026-07-20. CLAUDE.md's "Catch errors outside dialogs too" was prose
 * only, and it is the single most-repeated defect in the codebase — it was the
 * root of findings in `/quick`, budget category CRUD, schedules and
 * transfer-plan, in that order. A bare await inside a transition makes a
 * failed write indistinguishable from a successful one: the optimistic UI
 * keeps showing a value that was never persisted.
 *
 * Same workflow as the lists above — delete a line when you fix it, never add
 * one. The two shapes are distinguished because they fail differently: an
 * un-awaited call rejects into nothing at all, while an awaited one at least
 * surfaces in the console.
 */
/**
 * Snapshot-by-callback call sites with no toast. Added 2026-07-20 alongside
 * the detector above, which exists because the `importersOf` heuristic is
 * blind to this shape by construction — see `snapshotPushWithoutToast`.
 */
const ALLOWLIST_SNAPSHOT_PUSH: string[] = [];

const ALLOWLIST_UNGUARDED_TRANSITION: string[] = [
];

describe("system visibility (CLAUDE.md)", () => {
  it("every snapshot-carrying undo entry is acknowledged", () => {
    const violations = snapshotPushWithoutToast().filter(
      (v) => !ALLOWLIST_SNAPSHOT_PUSH.includes(v)
    );
    expect(violations).toEqual([]);
  });

  it("every server action inside a transition can report its own failure", () => {
    const violations = unguardedTransitionCalls().filter(
      (v) => !ALLOWLIST_UNGUARDED_TRANSITION.includes(v)
    );
    expect(violations).toEqual([]);
  });

  it("no transition block runs a snapshot mutation without a toast", () => {
    const violations = snapshotBlockWithoutToast().filter(
      (v) => !ALLOWLIST_BLOCK_NO_TOAST.includes(v)
    );
    expect(violations).toEqual([]);
  });

  it("finds the server actions it's meant to be checking", () => {
    // Guards against the scanner silently matching nothing after a refactor,
    // which would make every assertion below vacuously pass.
    expect(ACTIONS.size).toBeGreaterThan(20);
    expect(SNAPSHOT_ACTIONS.length).toBeGreaterThan(0);
  });

  it("every *WithSnapshot call site fires a toast", () => {
    const violations: string[] = [];
    for (const action of SNAPSHOT_ACTIONS) {
      for (const file of importersOf(action)) {
        const src = fileSrc(file);
        const toasts = src.includes("useToast") || src.includes("toast(");
        const message = `${file} calls ${action} without a toast`;
        if (!toasts && !ALLOWLIST_NO_TOAST.includes(message)) {
          violations.push(message);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    // Fires when a listed violation has been fixed. That's a good change —
    // the fix is to delete the line, which is how the list shrinks toward
    // empty rather than quietly outliving the problems it describes.
    const live = new Set<string>();
    for (const action of SNAPSHOT_ACTIONS) {
      for (const file of importersOf(action)) {
        const src = fileSrc(file);
        if (!(src.includes("useToast") || src.includes("toast(")))
          live.add(`${file} calls ${action} without a toast`);
      }
    }
    for (const action of DELETE_SHAPED) {
      for (const file of importersOf(action)) {
        const src = fileSrc(file);
        if (onlyUndoBackward(src, action)) continue;
        if (
          !(src.includes("ConfirmDialog") || /confirming|setConfirming/.test(src))
        )
          live.add(`${file} calls ${action} with no confirm step`);
      }
    }
    for (const v of unguardedTransitionCalls()) live.add(v);
    for (const v of snapshotPushWithoutToast()) live.add(v);
    for (const v of snapshotBlockWithoutToast()) live.add(v);
    const stale = [
      ...ALLOWLIST_NO_TOAST,
      ...ALLOWLIST_NO_CONFIRM,
      ...ALLOWLIST_UNGUARDED_TRANSITION,
      ...ALLOWLIST_SNAPSHOT_PUSH,
      ...ALLOWLIST_BLOCK_NO_TOAST,
    ].filter((entry) => !live.has(entry));
    expect(
      stale,
      "These are fixed — delete them from the allowlist in this file"
    ).toEqual([]);
  });

  it("every irreversible delete sits behind ConfirmDialog", () => {
    const violations: string[] = [];
    for (const action of DELETE_SHAPED) {
      for (const file of importersOf(action)) {
        const src = fileSrc(file);
        // Undo-only call sites are exempt — see `onlyUndoBackward`.
        if (onlyUndoBackward(src, action)) continue;
        // An inline confirm step (the /quick sheets) counts — the rule is
        // "the user gets a chance to back out", not "imports this component".
        const confirms =
          src.includes("ConfirmDialog") || /confirming|setConfirming/.test(src);
        const message = `${file} calls ${action} with no confirm step`;
        if (!confirms && !ALLOWLIST_NO_CONFIRM.includes(message)) {
          violations.push(message);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
