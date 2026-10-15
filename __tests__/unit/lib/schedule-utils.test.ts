import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeNextDate,
  computeInitialNextDate,
  getScheduleStatus,
  formatFrequency,
  getStatusProps,
} from "@/lib/schedule-utils";

type RecurrenceConfig = Parameters<typeof computeNextDate>[0];

function config(overrides: Partial<RecurrenceConfig> = {}): RecurrenceConfig {
  return {
    frequency: "monthly",
    interval: 1,
    start_date: "2026-01-01",
    end_date: null,
    day_of_month: null,
    day_of_week: null,
    skip_weekend: null,
    ...overrides,
  };
}

describe("computeNextDate", () => {
  // ── Frequency types ──────────────────────────────────

  it("monthly: returns next month after afterDate", () => {
    const result = computeNextDate(config({ start_date: "2026-01-01" }), "2026-03-15");
    expect(result).toBe("2026-04-01");
  });

  it("daily: returns next day after afterDate", () => {
    const result = computeNextDate(
      config({ frequency: "daily", start_date: "2026-04-01" }),
      "2026-04-01"
    );
    expect(result).toBe("2026-04-02");
  });

  it("daily with interval 3: every 3 days", () => {
    const result = computeNextDate(
      config({ frequency: "daily", interval: 3, start_date: "2026-04-01" }),
      "2026-04-04"
    );
    expect(result).toBe("2026-04-07");
  });

  it("weekly: returns next week", () => {
    const result = computeNextDate(
      config({ frequency: "weekly", start_date: "2026-04-06" }), // Monday
      "2026-04-06"
    );
    expect(result).toBe("2026-04-13");
  });

  it("biweekly: returns 2 weeks later", () => {
    const result = computeNextDate(
      config({ frequency: "biweekly", start_date: "2026-04-01" }),
      "2026-04-01"
    );
    expect(result).toBe("2026-04-15");
  });

  it("yearly: returns next year", () => {
    const result = computeNextDate(
      config({ frequency: "yearly", start_date: "2026-06-15" }),
      "2026-06-15"
    );
    expect(result).toBe("2027-06-15");
  });

  it("once: returns start_date if afterDate is before it", () => {
    const result = computeNextDate(
      config({ frequency: "once", start_date: "2026-06-01" }),
      "2026-05-15"
    );
    expect(result).toBe("2026-06-01");
  });

  it("once: returns null if afterDate is past start_date", () => {
    const result = computeNextDate(
      config({ frequency: "once", start_date: "2026-06-01" }),
      "2026-06-02"
    );
    expect(result).toBeNull();
  });

  // ── Day constraints ──────────────────────────────────

  it("monthly with day_of_month: pins to specific day", () => {
    const result = computeNextDate(
      config({ start_date: "2026-01-15", day_of_month: 15 }),
      "2026-03-16"
    );
    expect(result).toBe("2026-04-15");
  });

  it("monthly with day_of_month -1: last day of month", () => {
    const result = computeNextDate(
      config({ start_date: "2026-01-31", day_of_month: -1 }),
      "2026-01-31"
    );
    // Feb last day = 28
    expect(result).toBe("2026-02-28");
  });

  it("monthly with day_of_month 31 in short month: clamps to month end", () => {
    const result = computeNextDate(
      config({ start_date: "2026-01-31", day_of_month: 31 }),
      "2026-01-31"
    );
    // Feb has 28 days in 2026
    expect(result).toBe("2026-02-28");
  });

  it("weekly with day_of_week: pins to specific day", () => {
    const result = computeNextDate(
      config({ frequency: "weekly", start_date: "2026-04-06", day_of_week: 5 }), // Friday
      "2026-04-06" // Monday
    );
    expect(result).toBe("2026-04-10"); // Friday of same week
  });

  // ── Skip weekend ─────────────────────────────────────

  it("skip_weekend 'before': moves Saturday to Friday", () => {
    // 2026-05-02 is a Saturday
    const result = computeNextDate(
      config({ start_date: "2026-01-02", day_of_month: 2, skip_weekend: "before" }),
      "2026-04-03"
    );
    expect(result).toBe("2026-05-01"); // Friday May 1
  });

  it("skip_weekend 'after': moves Saturday to Monday", () => {
    const result = computeNextDate(
      config({ start_date: "2026-01-02", day_of_month: 2, skip_weekend: "after" }),
      "2026-04-03"
    );
    expect(result).toBe("2026-05-04"); // Monday May 4
  });

  // ── End date ─────────────────────────────────────────

  it("returns null when next occurrence is past end_date", () => {
    const result = computeNextDate(
      config({ start_date: "2026-01-01", end_date: "2026-03-01" }),
      "2026-03-15"
    );
    expect(result).toBeNull();
  });

  it("returns occurrence if it falls on or before end_date", () => {
    const result = computeNextDate(
      config({ start_date: "2026-01-01", end_date: "2026-06-01" }),
      "2026-04-15"
    );
    expect(result).toBe("2026-05-01");
  });

  // ── Intervals > 1 ───────────────────────────────────

  it("monthly with interval 2: every other month", () => {
    const result = computeNextDate(
      config({ start_date: "2026-01-01", interval: 2 }),
      "2026-03-15"
    );
    expect(result).toBe("2026-05-01");
  });

  it("weekly with interval 2: every 2 weeks", () => {
    const result = computeNextDate(
      config({ frequency: "weekly", start_date: "2026-04-06", interval: 2 }),
      "2026-04-06"
    );
    expect(result).toBe("2026-04-20");
  });
});

describe("computeInitialNextDate", () => {
  it("returns start_date for monthly schedule", () => {
    const result = computeInitialNextDate(config({ start_date: "2026-04-01" }));
    expect(result).toBe("2026-04-01");
  });

  it("returns start_date for once schedule", () => {
    const result = computeInitialNextDate(config({ frequency: "once", start_date: "2026-06-15" }));
    expect(result).toBe("2026-06-15");
  });
});

describe("getScheduleStatus", () => {
  afterEach(() => vi.useRealTimers());

  it("returns 'completed' when schedule is completed", () => {
    expect(getScheduleStatus({ next_date: "2026-04-01", completed: true }, false)).toBe("completed");
  });

  it("returns 'paid' when hasPaidTransaction is true", () => {
    expect(getScheduleStatus({ next_date: "2026-04-01", completed: false }, true)).toBe("paid");
  });

  it("returns 'due' when next_date is today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15)); // April 15
    expect(getScheduleStatus({ next_date: "2026-04-15", completed: false }, false)).toBe("due");
  });

  it("returns 'missed' when next_date is in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15));
    expect(getScheduleStatus({ next_date: "2026-04-10", completed: false }, false)).toBe("missed");
  });

  it("returns 'upcoming' when next_date is within 7 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15));
    expect(getScheduleStatus({ next_date: "2026-04-20", completed: false }, false)).toBe("upcoming");
  });

  it("returns 'scheduled' when next_date is more than 7 days away", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15));
    expect(getScheduleStatus({ next_date: "2026-05-15", completed: false }, false)).toBe("scheduled");
  });
});

describe("formatFrequency", () => {
  const base = { interval: 1, day_of_month: null, day_of_week: null, start_date: "2026-01-01" };

  it("once", () => {
    expect(formatFrequency({ ...base, frequency: "once" })).toBe("Once");
  });

  it("daily", () => {
    expect(formatFrequency({ ...base, frequency: "daily" })).toBe("Daily");
  });

  it("daily with interval", () => {
    expect(formatFrequency({ ...base, frequency: "daily", interval: 3 })).toBe("Every 3 days");
  });

  it("weekly", () => {
    expect(formatFrequency({ ...base, frequency: "weekly" })).toBe("Weekly");
  });

  it("weekly with day_of_week", () => {
    expect(formatFrequency({ ...base, frequency: "weekly", day_of_week: 5 })).toBe("Weekly on Fri");
  });

  it("weekly with interval > 1", () => {
    expect(formatFrequency({ ...base, frequency: "weekly", interval: 2, day_of_week: 1 })).toBe("Every 2 weeks on Mon");
  });

  it("biweekly", () => {
    expect(formatFrequency({ ...base, frequency: "biweekly" })).toBe("Every 2 weeks");
  });

  it("biweekly with day_of_week", () => {
    expect(formatFrequency({ ...base, frequency: "biweekly", day_of_week: 3 })).toBe("Every 2 weeks on Wed");
  });

  it("monthly", () => {
    expect(formatFrequency({ ...base, frequency: "monthly" })).toBe("Monthly");
  });

  it("monthly with day_of_month", () => {
    expect(formatFrequency({ ...base, frequency: "monthly", day_of_month: 1 })).toBe("Monthly on the 1st");
  });

  it("monthly with day_of_month 15", () => {
    expect(formatFrequency({ ...base, frequency: "monthly", day_of_month: 15 })).toBe("Monthly on the 15th");
  });

  it("monthly with interval > 1", () => {
    expect(formatFrequency({ ...base, frequency: "monthly", interval: 3, day_of_month: 1 })).toBe("Every 3 months on the 1st");
  });

  it("yearly", () => {
    expect(formatFrequency({ ...base, frequency: "yearly" })).toBe("Yearly");
  });

  it("yearly with interval", () => {
    expect(formatFrequency({ ...base, frequency: "yearly", interval: 2 })).toBe("Every 2 years");
  });
});

describe("getStatusProps", () => {
  it("returns correct props for each status", () => {
    expect(getStatusProps("missed").label).toBe("Missed");
    expect(getStatusProps("due").label).toBe("Due");
    expect(getStatusProps("upcoming").label).toBe("Upcoming");
    expect(getStatusProps("paid").label).toBe("Paid");
    expect(getStatusProps("completed").label).toBe("Completed");
    expect(getStatusProps("scheduled").label).toBe("Scheduled");
  });

  it("missed uses negative intent", () => {
    expect(getStatusProps("missed").intent).toBe("negative");
  });

  it("paid uses positive intent", () => {
    expect(getStatusProps("paid").intent).toBe("positive");
  });
});
