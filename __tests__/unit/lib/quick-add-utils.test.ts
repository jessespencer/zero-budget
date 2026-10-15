import { describe, it, expect } from "vitest";
import {
  EMPTY_AMOUNT_ENTRY,
  amountEntryExpression,
  amountEntryFromNumber,
  amountEntryKey,
  amountEntryText,
  type AmountEntry,
  parseSplitAmount,
  relativeTime,
} from "@/lib/quick-add-utils";

describe("parseSplitAmount", () => {
  it("parses a decimal string", () => {
    expect(parseSplitAmount("12.34")).toBe(12.34);
  });

  it("parses an integer string", () => {
    expect(parseSplitAmount("50")).toBe(50);
  });

  it("returns absolute value (strips negative sign)", () => {
    // Split sign comes from parent mode (expense/income), not per-line input.
    expect(parseSplitAmount("-12.34")).toBe(12.34);
    expect(parseSplitAmount("-50")).toBe(50);
  });

  it("returns 0 for non-numeric input", () => {
    expect(parseSplitAmount("abc")).toBe(0);
    expect(parseSplitAmount("")).toBe(0);
    expect(parseSplitAmount("$12")).toBe(0);
  });

  it("returns 0 for NaN-producing input", () => {
    expect(parseSplitAmount("NaN")).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(parseSplitAmount("Infinity")).toBe(0);
    expect(parseSplitAmount("-Infinity")).toBe(0);
  });

  it("parses 0 as 0", () => {
    expect(parseSplitAmount("0")).toBe(0);
    expect(parseSplitAmount("0.00")).toBe(0);
  });
});

describe("relativeTime", () => {
  const NOW = 1_700_000_000_000; // arbitrary fixed reference

  it("returns 0s for now", () => {
    expect(relativeTime(NOW, NOW)).toBe("0s ago");
  });

  it("returns seconds for sub-minute deltas", () => {
    expect(relativeTime(NOW - 1_000, NOW)).toBe("1s ago");
    expect(relativeTime(NOW - 59_000, NOW)).toBe("59s ago");
  });

  it("transitions to minutes at exactly 60s", () => {
    expect(relativeTime(NOW - 60_000, NOW)).toBe("1m ago");
  });

  it("returns minutes for sub-hour deltas", () => {
    expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe("59m ago");
  });

  it("transitions to hours at exactly 60m", () => {
    expect(relativeTime(NOW - 60 * 60_000, NOW)).toBe("1h ago");
  });

  it("returns hours for sub-day deltas", () => {
    expect(relativeTime(NOW - 23 * 60 * 60_000, NOW)).toBe("23h ago");
  });

  it("transitions to days at exactly 24h", () => {
    expect(relativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe("1d ago");
  });

  it("returns days for multi-day deltas", () => {
    expect(relativeTime(NOW - 7 * 24 * 60 * 60_000, NOW)).toBe("7d ago");
  });

  it("clamps negative deltas (clock skew / future time) to 0s", () => {
    expect(relativeTime(NOW + 5_000, NOW)).toBe("0s ago");
  });

  it("floors fractional seconds", () => {
    expect(relativeTime(NOW - 1_999, NOW)).toBe("1s ago");
  });
});

describe("amount entry (the /quick amount field)", () => {
  const press = (keys: string, from: AmountEntry = EMPTY_AMOUNT_ENTRY) =>
    [...keys].map((k) => (k === "<" ? "Backspace" : k)).reduce(amountEntryKey, from);

  it("reads digits as whole dollars", () => {
    expect(amountEntryText(press("5"))).toBe("5");
    expect(amountEntryExpression(press("5+5"))).toBe("5 + 5");
  });

  it("takes cents after a typed point, at most two", () => {
    expect(amountEntryText(press("12.345"))).toBe("12.34");
    expect(amountEntryText(press(".5"))).toBe("0.5");
    expect(amountEntryText(press("1.2.3"))).toBe("1.23");
  });

  it("drops a leading zero rather than showing 05", () => {
    expect(amountEntryText(press("05"))).toBe("5");
    expect(amountEntryText(press("0.05"))).toBe("0.05");
  });

  it("stops at $9,999,999.99 instead of accepting an eighth whole digit", () => {
    expect(amountEntryText(press("123456789"))).toBe("1234567");
    expect(amountEntryText(press("9999999.999"))).toBe("9999999.99");
  });

  it("shows the whole expression in the field", () => {
    expect(amountEntryText(press("45+12.50"))).toBe("45 + 12.50");
    expect(amountEntryText(press("45+"))).toBe("45 +");
    expect(amountEntryText(press("90/3"))).toBe("90 ÷ 3");
  });

  it("commits a trailing point as a whole number", () => {
    expect(amountEntryText(press("12.+"))).toBe("12 +");
  });

  it("drops a dangling operator from the expression it evaluates", () => {
    expect(amountEntryExpression(press("45+"))).toBe("45");
  });

  it("swaps a pending operator rather than stacking a second", () => {
    expect(amountEntryText(press("10+*"))).toBe("10 ×");
  });

  it("ignores an operator with nothing before it", () => {
    expect(press("+")).toEqual(EMPTY_AMOUNT_ENTRY);
  });

  it("removes the last character on Backspace", () => {
    expect(amountEntryText(press("12.50<"))).toBe("12.5");
    expect(amountEntryText(press("12.5<<"))).toBe("12");
    expect(amountEntryText(press("1<"))).toBe("");
  });

  it("steps back through an operator into the previous operand", () => {
    expect(amountEntryText(press("45+12<<"))).toBe("45 +");
    expect(amountEntryText(press("45+12<<<"))).toBe("45");
  });

  it("ignores characters that aren't keys", () => {
    expect(amountEntryText(press("1 2a"))).toBe("12");
  });

  it("seeds from a stored amount, sign dropped", () => {
    expect(amountEntryText(amountEntryFromNumber(-12.5))).toBe("12.50");
    expect(amountEntryFromNumber(0)).toEqual(EMPTY_AMOUNT_ENTRY);
  });
});
