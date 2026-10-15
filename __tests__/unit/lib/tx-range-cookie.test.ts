import { describe, it, expect } from "vitest";
import {
  parseTxRangeCookie,
  resolveTxRange,
  computePresetRange,
  serializeTxRange,
  type ParsedTxRange,
} from "@/lib/tx-range-cookie";

// A fixed "now" in mid-July 2026 so preset resolution is deterministic. The
// regression this file guards: presets must resolve against the live clock,
// not freeze to the month they were picked in.
const JULY = new Date(2026, 6, 15); // month is 0-indexed → July

describe("parseTxRangeCookie", () => {
  it("returns null for an empty/undefined cookie", () => {
    expect(parseTxRangeCookie(undefined)).toBeNull();
    expect(parseTxRangeCookie("")).toBeNull();
  });

  it("parses a preset token into a preset intent", () => {
    expect(parseTxRangeCookie("preset:this-month")).toEqual({
      kind: "preset",
      preset: "this-month",
    });
    expect(parseTxRangeCookie("preset:last-year")).toEqual({
      kind: "preset",
      preset: "last-year",
    });
  });

  it("rejects an unknown preset token", () => {
    expect(parseTxRangeCookie("preset:nonsense")).toBeNull();
    expect(parseTxRangeCookie("preset:")).toBeNull();
  });

  it("parses an absolute custom range", () => {
    expect(parseTxRangeCookie("2026-03:2026-06")).toEqual({
      kind: "custom",
      range: { start: "2026-03", end: "2026-06" },
    });
  });

  it("rejects a custom range whose start is after its end", () => {
    expect(parseTxRangeCookie("2026-08:2026-01")).toBeNull();
  });

  it("rejects malformed / out-of-range month keys", () => {
    expect(parseTxRangeCookie("2026-13:2026-14")).toBeNull();
    expect(parseTxRangeCookie("2026-00:2026-05")).toBeNull();
    expect(parseTxRangeCookie("garbage")).toBeNull();
  });

  describe("legacy values", () => {
    it("maps a bare \"all\" to the all preset", () => {
      expect(parseTxRangeCookie("all")).toEqual({
        kind: "preset",
        preset: "all",
      });
    });

    it("still parses a legacy absolute range written before presets", () => {
      expect(parseTxRangeCookie("2026-06:2026-06")).toEqual({
        kind: "custom",
        range: { start: "2026-06", end: "2026-06" },
      });
    });
  });
});

describe("computePresetRange", () => {
  it("resolves \"this month\" to the current month", () => {
    expect(computePresetRange("this-month", JULY)).toEqual({
      start: "2026-07",
      end: "2026-07",
    });
  });

  it("resolves \"latest 3 months\" as a trailing 3-month window", () => {
    expect(computePresetRange("latest-3-months", JULY)).toEqual({
      start: "2026-05",
      end: "2026-07",
    });
  });

  it("resolves \"latest 3 months\" across a year boundary", () => {
    const jan = new Date(2026, 0, 10); // January 2026
    expect(computePresetRange("latest-3-months", jan)).toEqual({
      start: "2025-11",
      end: "2026-01",
    });
  });

  it("resolves \"this year\" to the full calendar year", () => {
    expect(computePresetRange("this-year", JULY)).toEqual({
      start: "2026-01",
      end: "2026-12",
    });
  });

  it("resolves \"last year\" to the previous calendar year", () => {
    expect(computePresetRange("last-year", JULY)).toEqual({
      start: "2025-01",
      end: "2025-12",
    });
  });

  it("resolves \"all\" to an open range", () => {
    expect(computePresetRange("all", JULY)).toEqual({
      start: null,
      end: null,
    });
  });
});

describe("resolveTxRange", () => {
  // The core regression test: a "this month" preset picked while the cookie
  // was written must follow the clock to whatever month `now` is.
  it("re-resolves a \"this month\" preset against the live clock", () => {
    const parsed = parseTxRangeCookie("preset:this-month");
    expect(parsed).not.toBeNull();
    // Picked in June, viewed in July → July, not June.
    expect(resolveTxRange(parsed as ParsedTxRange, JULY)).toEqual({
      start: "2026-07",
      end: "2026-07",
    });
  });

  it("passes a custom range through unchanged regardless of now", () => {
    const parsed = parseTxRangeCookie("2026-03:2026-06");
    expect(resolveTxRange(parsed as ParsedTxRange, JULY)).toEqual({
      start: "2026-03",
      end: "2026-06",
    });
  });

  it("round-trips a preset cookie: this month picked in June shows July in July", () => {
    // Simulate the exact reported bug end to end.
    const june = new Date(2026, 5, 20);
    const pickedRange = computePresetRange("this-month", june);
    expect(pickedRange).toEqual({ start: "2026-06", end: "2026-06" });

    // But we persist the intent, not the resolved range.
    const parsed = parseTxRangeCookie("preset:this-month") as ParsedTxRange;
    expect(resolveTxRange(parsed, JULY)).toEqual({
      start: "2026-07",
      end: "2026-07",
    });
  });
});

describe("serializeTxRange", () => {
  it("serializes an absolute range", () => {
    expect(serializeTxRange({ start: "2026-03", end: "2026-06" })).toBe(
      "2026-03:2026-06"
    );
  });

  it("serializes an open range to \"all\"", () => {
    expect(serializeTxRange({ start: null, end: null })).toBe("all");
  });

  it("throws on a half-open range", () => {
    expect(() => serializeTxRange({ start: "2026-03", end: null })).toThrow();
  });
});
