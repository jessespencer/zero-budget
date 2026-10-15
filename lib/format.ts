import { endOfMonth, format, parse, startOfMonth } from "date-fns";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatCurrency = (amount: number): string => {
  // Snap negative values that round to zero (float drift like -1e-9) so we
  // never render "-$0.00". Intl prints the sign of the input, not the output.
  const display = amount > -0.005 && amount < 0 ? 0 : amount;
  return currencyFormatter.format(display);
};

const wholeCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Currency with no cents — "$150". For labels that are always whole dollars. */
export const formatCurrencyWhole = (amount: number): string =>
  wholeCurrencyFormatter.format(amount);

/**
 * Split a formatted currency string into dollars (with sign + $) and cents
 * (including the decimal point), so callers can style cents smaller.
 * Example: -1234.56 → { dollars: "-$1,234", cents: ".56" }
 */
export const formatCurrencyParts = (
  amount: number
): { dollars: string; cents: string } => {
  const formatted = formatCurrency(amount);
  const idx = formatted.lastIndexOf(".");
  if (idx === -1) return { dollars: formatted, cents: "" };
  return { dollars: formatted.slice(0, idx), cents: formatted.slice(idx) };
};

/**
 * Fixed-width dot run that stands in for a hidden amount in privacy/demo mode.
 * The length is deliberately constant — "$5" and "$5,000,000" both render
 * "$••••••" — so masking hides magnitude, not just the exact figure.
 */
export const AMOUNT_MASK = "••••••";

/**
 * Sign-preserving masked currency — "$••••••" / "-$••••••". Mirrors the
 * negative-zero snapping in formatCurrency so a float like -1e-9 never shows a
 * misleading minus. Sign is intentionally preserved: an overspent/credit value
 * still reads as negative (and colorizes red), it just hides the number.
 */
export const maskCurrency = (amount: number): string => {
  const display = amount > -0.005 && amount < 0 ? 0 : amount;
  return display < 0 ? `-$${AMOUNT_MASK}` : `$${AMOUNT_MASK}`;
};

/** Masked equivalent of formatCurrencyParts — all mask in `dollars`, no cents. */
export const maskCurrencyParts = (
  amount: number
): { dollars: string; cents: string } => ({
  dollars: maskCurrency(amount),
  cents: "",
});

export const formatDate = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  return format(new Date(y, m - 1, d), "MMM d, yyyy");
};

/**
 * One shape for every row: "Aug 22" within the current year, "Aug 22, 2025"
 * outside it. The year appears exactly when a bare month + day would be
 * ambiguous. (This used to switch between "October 4" and "08/22/2026" at a
 * 30-day threshold, which put two formats in the same column.)
 */
export const formatShortDate = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  if (y === new Date().getFullYear()) {
    return format(target, "MMM d");
  }
  return format(target, "MMM d, yyyy");
};

/** Returns "2026-04-01" format for a given date */
export const getMonthKey = (date: Date = new Date()): string => {
  const d = startOfMonth(date);
  return format(d, "yyyy-MM-dd");
};

/** Parses "2026-04-01" into a Date */
export const parseMonthKey = (key: string): Date => {
  return parse(key, "yyyy-MM-dd", new Date());
};

/** Returns display string like "Apr 2026" */
export const formatMonthYear = (monthKey: string): string => {
  const date = parseMonthKey(monthKey);
  return format(date, "MMM yyyy");
};

/** Returns the previous month key */
export const prevMonth = (monthKey: string): string => {
  const date = parseMonthKey(monthKey);
  date.setMonth(date.getMonth() - 1);
  return getMonthKey(date);
};

/** Returns the next month key */
export const nextMonth = (monthKey: string): string => {
  const date = parseMonthKey(monthKey);
  date.setMonth(date.getMonth() + 1);
  return getMonthKey(date);
};

/**
 * Converts "2026-03" into the inclusive day-precision range used by
 * getTransactions. Returns null if the input doesn't match YYYY-MM with a
 * 01-12 month. The strict shape check keeps user-controllable URL params
 * out of the SQL bind path (T-06.5-01).
 */
export const monthKeyToRange = (
  yyyyMm: string
): { startDate: string; endDate: string } | null => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yyyyMm)) return null;
  const startDate = `${yyyyMm}-01`;
  const endDate = format(endOfMonth(parseMonthKey(startDate)), "yyyy-MM-dd");
  return { startDate, endDate };
};
