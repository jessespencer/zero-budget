import { describe, it, expect } from "vitest";
import { mapRow, mapRows, newId, now, roundUpToTen } from "@/lib/db-utils";

describe("mapRow", () => {
  it("converts boolean fields from 1 to true", () => {
    const row = { id: "1", archived: 1, cleared: 1, name: "test" };
    const result = mapRow<{ id: string; archived: boolean; cleared: boolean; name: string }>(row);
    expect(result.archived).toBe(true);
    expect(result.cleared).toBe(true);
  });

  it("converts boolean fields from 0 to false", () => {
    const row = { id: "1", archived: 0, is_income: 0 };
    const result = mapRow<{ id: string; archived: boolean; is_income: boolean }>(row);
    expect(result.archived).toBe(false);
    expect(result.is_income).toBe(false);
  });

  it("passes through non-boolean fields unchanged", () => {
    const row = { id: "abc", name: "Test", amount: 42.5 };
    const result = mapRow<{ id: string; name: string; amount: number }>(row);
    expect(result.id).toBe("abc");
    expect(result.name).toBe("Test");
    expect(result.amount).toBe(42.5);
  });

  it("handles already-boolean values", () => {
    const row = { archived: true, cleared: false };
    const result = mapRow<{ archived: boolean; cleared: boolean }>(row);
    expect(result.archived).toBe(true);
    expect(result.cleared).toBe(false);
  });
});

describe("mapRows", () => {
  it("maps an array of rows", () => {
    const rows = [
      { id: "1", archived: 1 },
      { id: "2", archived: 0 },
    ];
    const result = mapRows<{ id: string; archived: boolean }>(rows);
    expect(result).toHaveLength(2);
    expect(result[0].archived).toBe(true);
    expect(result[1].archived).toBe(false);
  });
});

describe("newId", () => {
  it("returns a valid UUID format", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });
});

describe("now", () => {
  it("returns a valid ISO string", () => {
    const result = now();
    expect(new Date(result).toISOString()).toBe(result);
  });
});

describe("roundUpToTen", () => {
  it("rounds a value with cents up to the next $10", () => {
    expect(roundUpToTen(140.99)).toBe(150);
  });

  it("rounds a whole non-$10 value up to the next $10", () => {
    expect(roundUpToTen(212)).toBe(220);
  });

  it("leaves values already on a $10 mark unchanged", () => {
    expect(roundUpToTen(150)).toBe(150);
  });

  it("rounds large values up correctly", () => {
    expect(roundUpToTen(1003.5)).toBe(1010);
  });

  it("returns 0 for zero", () => {
    expect(roundUpToTen(0)).toBe(0);
  });

  it("returns 0 for negative balances (never rounds up past zero)", () => {
    expect(roundUpToTen(-5.3)).toBe(0);
  });

  it("resists float drift just above a $10 mark", () => {
    expect(roundUpToTen(150.0000001)).toBe(150);
  });
});
