import type { AmountOperator } from "./amount-expression";

/**
 * Pure helpers extracted from `app/quick/quick-add-form.tsx` so they can be
 * unit-tested and reused by `recent-edit-sheet.tsx` (and future decomposition
 * of the quick-add surface). Behavior is preserved verbatim from the inline
 * originals — change here only when you intend to change /quick math.
 */

/**
 * Friendly relative-time formatter for the /quick Recent list.
 *
 * "Xs ago" under a minute, "Xm ago" under an hour, "Xh ago" under a day,
 * otherwise "Xd ago". Clamps negative deltas (clock skew) to "0s ago".
 */
export function relativeTime(time: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Parse a free-form split-amount string to an absolute number, snapped to
 * whole cents. Non-numeric input collapses to 0. Negative signs are stripped —
 * the split's sign comes from the parent transaction's mode (expense/income),
 * not per-line input.
 *
 * The cent snap matters: callers validate the split sum with
 * `Math.round(amount * 100)` but persist `amount` verbatim, so an unrounded
 * value like "12.344" passed validation and then stored 12.344, leaving
 * `SUM(transaction_splits.amount)` permanently adrift from the parent total.
 * This is rounding a single user-entered line value, not an intermediate sum.
 */
export function parseSplitAmount(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : 0;
}

/**
 * The /quick amount field (and its edit sheet): plain dollar entry with
 * arithmetic typed inside the field (SEED-024).
 *
 * `5` is $5, `12.34` is typed with its dot — the decimal pad has a "." key, so
 * the old POS-style cents counter (`1234` → $12.34) no longer earns its keep,
 * and it made `5+5` mean $0.10. The field shows the whole expression, e.g.
 * `45 + 12.50`, and every edit is reduced to one key: a digit, ".", an
 * operator, or Backspace.
 */
export type AmountTerm = { text: string; op: AmountOperator };
export type AmountEntry = { terms: AmountTerm[]; current: string };

export const EMPTY_AMOUNT_ENTRY: AmountEntry = { terms: [], current: "" };

export const AMOUNT_OPERATOR_GLYPHS: Record<AmountOperator, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
};

// $9,999,999.99 — seven whole-dollar digits, two after the point. Keys past
// either limit are ignored rather than accepted and silently trimmed.
const MAX_WHOLE_DIGITS = 7;
const MAX_FRACTION_DIGITS = 2;

/** Seed an entry from a stored amount, e.g. when editing a saved transaction. */
export function amountEntryFromNumber(amount: number): AmountEntry {
  const abs = Math.abs(amount);
  return abs > 0 ? { terms: [], current: abs.toFixed(2) } : EMPTY_AMOUNT_ENTRY;
}

/**
 * Apply one key. `key` is a digit, ".", an operator (already canonicalised by
 * the caller), or "Backspace"; anything else is ignored.
 */
export function amountEntryKey(entry: AmountEntry, key: string): AmountEntry {
  const { current } = entry;

  if (/^\d$/.test(key)) {
    const [whole, fraction] = current.split(".");
    if (fraction !== undefined) {
      if (fraction.length >= MAX_FRACTION_DIGITS) return entry;
    } else if (whole === "0") {
      return { ...entry, current: key }; // "0" then "5" is 5, not 05
    } else if (whole.length >= MAX_WHOLE_DIGITS) {
      return entry;
    }
    return { ...entry, current: current + key };
  }

  if (key === ".") {
    if (current.includes(".")) return entry;
    return { ...entry, current: (current || "0") + "." };
  }

  if (key === "+" || key === "-" || key === "*" || key === "/") {
    if (current) {
      // "12." commits as 12.
      const text = current.endsWith(".") ? current.slice(0, -1) : current;
      return { terms: [...entry.terms, { text, op: key }], current: "" };
    }
    // No operand yet: retarget a pending operator; ignore a leading one.
    if (entry.terms.length === 0) return entry;
    const last = entry.terms[entry.terms.length - 1];
    return { ...entry, terms: [...entry.terms.slice(0, -1), { ...last, op: key }] };
  }

  if (key === "Backspace") {
    if (current) return { ...entry, current: current.slice(0, -1) };
    // Past the start of an operand: remove the operator, resume the previous one.
    if (entry.terms.length === 0) return entry;
    const last = entry.terms[entry.terms.length - 1];
    return { terms: entry.terms.slice(0, -1), current: last.text };
  }

  return entry;
}

/** What the input shows: `45 + 12.50`, or `45 +` with nothing typed after. */
export function amountEntryText(entry: AmountEntry): string {
  const parts = entry.terms.map((t) => `${t.text} ${AMOUNT_OPERATOR_GLYPHS[t.op]}`);
  if (entry.current) parts.push(entry.current);
  return parts.join(" ");
}

/**
 * The expression to evaluate. A dangling operator ("45 +") is dropped so the
 * total still reflects what's been entered.
 */
export function amountEntryExpression(entry: AmountEntry): string {
  const parts: string[] = [];
  entry.terms.forEach((t, i) => {
    parts.push(t.text);
    if (i < entry.terms.length - 1 || entry.current) parts.push(t.op);
  });
  if (entry.current) parts.push(entry.current);
  return parts.join(" ");
}
