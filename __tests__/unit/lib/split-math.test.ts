import { describe, it, expect } from "vitest";
import { autoDistributeSplits, splitRemainingAmount } from "@/lib/split-math";
import type { SplitDraftItem } from "@/components/transactions/transactions-client";

function item(amount: number): SplitDraftItem {
  return { tempId: `t-${Math.round(amount * 100)}-${amount}`, category_id: "c", amount };
}

describe("splitRemainingAmount", () => {
  it("is zero when the lines sum to the parent", () => {
    expect(
      splitRemainingAmount({ parentAmount: -120, items: [item(-80), item(-40)] })
    ).toBe(0);
  });

  it("reports the unallocated remainder", () => {
    expect(
      splitRemainingAmount({ parentAmount: -120, items: [item(-40), item(-30)] })
    ).toBeCloseTo(-50, 10);
  });
});

describe("autoDistributeSplits", () => {
  it("fills empty lines so the parts sum to the parent to the cent (100 / 3)", () => {
    const result = autoDistributeSplits({
      parentAmount: 100,
      items: [item(0), item(0), item(0)],
    });
    const sumCents = result.reduce((acc, i) => acc + Math.round(i.amount * 100), 0);
    expect(sumCents).toBe(10000);
    // Last line absorbs the rounding remainder.
    expect(result.map((i) => Math.round(i.amount * 100))).toEqual([3333, 3333, 3334]);
  });

  it("distributes the remainder across only the empty lines, leaving filled ones", () => {
    const result = autoDistributeSplits({
      parentAmount: -120,
      items: [item(-100), item(0)],
    });
    expect(result[0].amount).toBe(-100);
    expect(result[1].amount).toBeCloseTo(-20, 10);
  });

  it("adds the remainder to the last line when no line is empty", () => {
    const result = autoDistributeSplits({
      parentAmount: -120,
      items: [item(-40), item(-30)],
    });
    expect(result[0].amount).toBe(-40);
    // -30 + remaining(-50) = -80; parts now sum to the parent.
    expect(result[1].amount).toBeCloseTo(-80, 10);
    const sum = result.reduce((acc, i) => acc + i.amount, 0);
    expect(sum).toBeCloseTo(-120, 10);
  });

  it("handles negative parent amounts across empty lines to the cent", () => {
    const result = autoDistributeSplits({
      parentAmount: -100,
      items: [item(0), item(0), item(0)],
    });
    const sumCents = result.reduce((acc, i) => acc + Math.round(i.amount * 100), 0);
    expect(sumCents).toBe(-10000);
  });
});
