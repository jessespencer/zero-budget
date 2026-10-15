import { describe, it, expect } from "vitest";
import {
  evaluateAmountExpression,
  toAmountOperator,
} from "@/lib/amount-expression";

describe("evaluateAmountExpression", () => {
  it("adds and subtracts money", () => {
    expect(evaluateAmountExpression("12.50 + 3")).toBe(15.5);
    expect(evaluateAmountExpression("100-35.25")).toBe(64.75);
  });

  it("treats a bare number as an expression of itself", () => {
    expect(evaluateAmountExpression("42.10")).toBe(42.1);
  });

  it("binds multiply and divide tighter than add and subtract", () => {
    expect(evaluateAmountExpression("12.50 + 3 * 2")).toBe(18.5);
    expect(evaluateAmountExpression("100 - 90 / 3")).toBe(70);
  });

  it("snaps only the final result to cents", () => {
    // 100 / 3 = 33.333… — rounding each term first would drift.
    expect(evaluateAmountExpression("100 / 3 * 3")).toBe(100);
    expect(evaluateAmountExpression("10 / 3")).toBe(3.33);
    expect(evaluateAmountExpression("0.1 + 0.2")).toBe(0.3);
  });

  it("accepts the glyphs a phone keyboard or a paste produces", () => {
    expect(evaluateAmountExpression("$1,200 × 2")).toBe(2400);
    expect(evaluateAmountExpression("90 ÷ 3")).toBe(30);
    expect(evaluateAmountExpression("50 − 20")).toBe(30);
    expect(evaluateAmountExpression("4 x 2.5")).toBe(10);
  });

  it("can go negative, leaving the caller to decide whether that's allowed", () => {
    expect(evaluateAmountExpression("10 - 25")).toBe(-15);
  });

  it("never returns -0", () => {
    expect(Object.is(evaluateAmountExpression("5 - 5"), 0)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["a trailing operator", "12 +"],
    ["a leading operator", "+ 12"],
    ["two operators in a row", "12 + * 3"],
    ["two numbers with no operator", "12 3"],
    ["letters", "12 + abc"],
    ["parentheses", "(12 + 3)"],
    ["division by zero", "12 / 0"],
  ])("rejects %s", (_label, input) => {
    expect(evaluateAmountExpression(input)).toBeNull();
  });
});

describe("toAmountOperator", () => {
  it("maps keyboard and glyph operators to the canonical four", () => {
    expect(["+", "-", "−", "*", "×", "x", "/", "÷"].map(toAmountOperator)).toEqual([
      "+", "-", "-", "*", "*", "*", "/", "/",
    ]);
  });

  it("returns null for anything else", () => {
    expect(toAmountOperator("=")).toBeNull();
    expect(toAmountOperator("5")).toBeNull();
  });
});
