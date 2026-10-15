import crypto from "crypto";

export function newId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

const BOOLEAN_FIELDS = new Set([
  "archived",
  "is_income",
  "cleared",
  "approved",
  "is_split_parent",
  "is_envelope_movement",
  "is_budget_account",
  "is_debt",
  "posts_transaction",
  "completed",
  "has_paid_transaction",
  "is_buffer",
  "is_primary",
  "is_system",
  "pinned_quick",
  "recurring",
]);

export function mapRow<T>(row: Record<string, unknown>): T {
  const obj = { ...row };
  for (const key of BOOLEAN_FIELDS) {
    if (key in obj) {
      obj[key] = obj[key] === 1 || obj[key] === true;
    }
  }
  return obj as T;
}

export function mapRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => mapRow<T>(row));
}

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Snap a category's `available` to the cents the user actually sees, for use in
 * ANY sign/zero comparison.
 *
 * `available` is a raw float sum out of the budget engine (cumulative assigned +
 * cumulative activity over potentially hundreds of transactions), so a category
 * that has been funded to exactly break-even lands a hair off zero — a real
 * prod value was `-1.136868e-13`. Compared raw, that reads as overspent: the
 * Overspent filter kept the row (and the "1 Overspent" count), the detail panel
 * printed a red "$0.00", Move money warned "This will overspend by $0.00", and
 * the Auto-assign panel still offered "Underfunded $0.00" — all while the
 * available pill, which already rounded, showed a neutral $0.00.
 *
 * Rounding at the STORAGE boundary does not fix this and isn't the answer: the
 * residue comes from summing the transaction floats, not from the stored
 * `assigned`. Round here, at the point of comparison, so every consumer agrees
 * with the number on screen.
 */
export function availableCents(available: number): number {
  const cents = roundCents(available);
  return cents === 0 ? 0 : cents; // normalize -0 (from tiny negatives) to +0
}

/**
 * Round a dollar amount UP to the next whole $10 (no cents).
 * 140.99 → 150, 212 → 220, 150 → 150 (already round), negatives → 0.
 * Integer-cents math avoids float division drift (e.g. 150.0000001).
 */
export function roundUpToTen(value: number): number {
  const cents = Math.round(value * 100);
  const dollars = (Math.ceil(cents / 1000) * 1000) / 100; // 1000 cents = $10
  return dollars === 0 ? 0 : dollars; // normalize -0 (from negatives) to +0
}

/**
 * Parse a user-typed or pasted money string into a number, tolerating
 * currency symbols, whitespace, and thousands separators
 * ("$5,346.16" -> 5346.16). Returns `null` for empty input or unparseable
 * values so callers can distinguish "no input" from "0".
 */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
