// Persistence for the transactions View filter range. Both /transactions and
// /accounts/[id] read this cookie to derive their default date range — bare
// URLs apply the user's last picked preset (or "this month" as a fallback).
// Explicit URL params (?start, ?end, ?range=all) still win, so deep links
// from the audit grid keep working.
//
// The cookie stores the user's *intent*, not a resolved snapshot:
//   - a named preset  → "preset:this-month" (resolved against the live clock
//     on every render, so "This month" auto-advances when the month rolls over)
//   - a custom range  → "YYYY-MM:YYYY-MM" (absolute — the user picked exact
//     months, so we keep them verbatim)
// Legacy values ("all" and bare "YYYY-MM:YYYY-MM" written before presets were
// stored semantically) still parse, so existing cookies don't break.

const COOKIE_NAME = "zero:tx-range";
// 1 year — long enough to feel like a permanent preference; short enough that
// stale cookies eventually expire if the user never returns.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type TxRange = { start: string | null; end: string | null };

// Named presets. Each resolves to a concrete range against a supplied `now`,
// so the time-relative ones ("This month", etc.) follow the calendar instead
// of freezing to the month they were picked in. Keep this list in sync with
// the buttons rendered by ViewFilter — it's the single source of truth.
export const TX_RANGE_PRESETS = [
  { key: "this-month", label: "This month" },
  { key: "latest-3-months", label: "Latest 3 months" },
  { key: "this-year", label: "This year" },
  { key: "last-year", label: "Last year" },
  { key: "all", label: "All dates" },
] as const;

export type TxRangePresetKey = (typeof TX_RANGE_PRESETS)[number]["key"];

const PRESET_KEYS = new Set<string>(TX_RANGE_PRESETS.map((p) => p.key));

// Discriminated result of parsing the cookie — either a preset to resolve
// later, or an already-concrete custom range.
export type ParsedTxRange =
  | { kind: "preset"; preset: TxRangePresetKey }
  | { kind: "custom"; range: TxRange };

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_RE.test(value);
}

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Resolve a named preset to a concrete month range against `now`. Called on
 * every server render so time-relative presets track the live clock.
 */
export function computePresetRange(key: TxRangePresetKey, now: Date): TxRange {
  switch (key) {
    case "this-month": {
      const m = monthKey(now);
      return { start: m, end: m };
    }
    case "latest-3-months": {
      const startDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return { start: monthKey(startDate), end: monthKey(now) };
    }
    case "this-year": {
      const y = now.getFullYear();
      return { start: `${y}-01`, end: `${y}-12` };
    }
    case "last-year": {
      const y = now.getFullYear() - 1;
      return { start: `${y}-01`, end: `${y}-12` };
    }
    case "all":
      return { start: null, end: null };
  }
}

export function parseTxRangeCookie(raw: string | undefined): ParsedTxRange | null {
  if (!raw) return null;
  // Legacy "all" (written before presets were stored as tokens) → the all preset.
  if (raw === "all") return { kind: "preset", preset: "all" };
  if (raw.startsWith("preset:")) {
    const key = raw.slice("preset:".length);
    return PRESET_KEYS.has(key)
      ? { kind: "preset", preset: key as TxRangePresetKey }
      : null;
  }
  const [start, end] = raw.split(":");
  if (!isMonthKey(start) || !isMonthKey(end)) return null;
  if (start > end) return null;
  return { kind: "custom", range: { start, end } };
}

/**
 * Turn a parsed cookie into a concrete range. Presets resolve against `now`;
 * custom ranges pass through unchanged.
 */
export function resolveTxRange(parsed: ParsedTxRange, now: Date): TxRange {
  return parsed.kind === "preset"
    ? computePresetRange(parsed.preset, now)
    : parsed.range;
}

export function serializeTxRange(range: TxRange): string {
  if (range.start === null && range.end === null) return "all";
  if (!isMonthKey(range.start) || !isMonthKey(range.end)) {
    throw new Error("invalid tx range");
  }
  return `${range.start}:${range.end}`;
}

function setCookie(value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

// Client-side write for a custom From/To range — used by ViewFilter's Apply
// button. Path=/ so it applies to every transactions/accounts page.
export function writeTxRangeCookie(range: TxRange): void {
  setCookie(serializeTxRange(range));
}

// Client-side write for a named preset — used by ViewFilter's preset buttons.
// Stores the intent so it re-resolves against the clock on the next render.
export function writeTxRangePresetCookie(key: TxRangePresetKey): void {
  setCookie(`preset:${key}`);
}

export const TX_RANGE_COOKIE_NAME = COOKIE_NAME;
