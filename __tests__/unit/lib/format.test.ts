import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatShortDate,
  getMonthKey,
  parseMonthKey,
  formatMonthYear,
  prevMonth,
  nextMonth,
} from "@/lib/format";

describe("formatCurrency", () => {
  it("formats positive dollars", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
  });

  it("formats negative dollars", () => {
    expect(formatCurrency(-50)).toBe("-$50.00");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats large numbers with commas", () => {
    expect(formatCurrency(1000000)).toBe("$1,000,000.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCurrency(10.999)).toBe("$11.00");
  });
});

describe("formatDate", () => {
  it("formats ISO date to readable string", () => {
    expect(formatDate("2026-04-15")).toBe("Apr 15, 2026");
  });

  it("formats single-digit day", () => {
    expect(formatDate("2026-01-05")).toBe("Jan 5, 2026");
  });
});

describe("formatShortDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 8)); // June 8, 2026 — Today
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders current-year dates as 'Mon D' however far away", () => {
    expect(formatShortDate("2026-06-08")).toBe("Jun 8");
    expect(formatShortDate("2026-05-30")).toBe("May 30");
    expect(formatShortDate("2026-01-01")).toBe("Jan 1");
    expect(formatShortDate("2026-12-25")).toBe("Dec 25");
  });

  it("adds the year only outside the current year", () => {
    expect(formatShortDate("2025-12-31")).toBe("Dec 31, 2025");
    expect(formatShortDate("2027-01-02")).toBe("Jan 2, 2027");
  });
});

describe("getMonthKey / parseMonthKey", () => {
  it("returns first of the month in YYYY-MM-DD format", () => {
    const date = new Date(2026, 3, 15); // April 15
    expect(getMonthKey(date)).toBe("2026-04-01");
  });

  it("parseMonthKey round-trips with getMonthKey", () => {
    const key = "2026-07-01";
    const parsed = parseMonthKey(key);
    expect(getMonthKey(parsed)).toBe(key);
  });
});

describe("formatMonthYear", () => {
  it("formats month key to readable string", () => {
    expect(formatMonthYear("2026-04-01")).toBe("Apr 2026");
  });

  it("formats December", () => {
    expect(formatMonthYear("2026-12-01")).toBe("Dec 2026");
  });
});

describe("prevMonth / nextMonth", () => {
  it("prevMonth goes back one month", () => {
    expect(prevMonth("2026-04-01")).toBe("2026-03-01");
  });

  it("nextMonth goes forward one month", () => {
    expect(nextMonth("2026-04-01")).toBe("2026-05-01");
  });

  it("prevMonth handles year boundary (Jan -> Dec)", () => {
    expect(prevMonth("2026-01-01")).toBe("2025-12-01");
  });

  it("nextMonth handles year boundary (Dec -> Jan)", () => {
    expect(nextMonth("2025-12-01")).toBe("2026-01-01");
  });
});
