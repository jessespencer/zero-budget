import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  setDate,
  lastDayOfMonth,
  nextMonday,
  previousFriday,
  isWeekend,
  isBefore,
  isEqual,
  format,
  differenceInDays,
  parseISO,
  startOfDay,
  setDay,
} from "date-fns";
import type {
  ScheduledTransaction,
  ScheduleFrequency,
  ScheduleStatus,
} from "./types";

// ─── Recurrence computation ──────────────────────────────────

type RecurrenceConfig = Pick<
  ScheduledTransaction,
  | "frequency"
  | "interval"
  | "start_date"
  | "end_date"
  | "day_of_month"
  | "day_of_week"
  | "skip_weekend"
>;

/**
 * Compute the next occurrence of a schedule strictly after `afterDate`.
 * Returns an ISO date string (YYYY-MM-DD) or null if the schedule has ended.
 */
export function computeNextDate(
  config: RecurrenceConfig,
  afterDate: string
): string | null {
  const after = startOfDay(parseISO(afterDate));
  const start = startOfDay(parseISO(config.start_date));
  const end = config.end_date
    ? startOfDay(parseISO(config.end_date))
    : null;

  if (config.frequency === "once") {
    // One-time: the only occurrence is start_date
    if (isBefore(after, start) || isEqual(after, start)) {
      return maybeSkipWeekend(start, config.skip_weekend);
    }
    return null;
  }

  // Walk forward from start_date by interval steps until we pass afterDate
  let candidate = start;
  const maxIterations = 1000;
  for (let i = 0; i < maxIterations; i++) {
    const adjusted = applyDayConstraints(candidate, config);
    const final = config.skip_weekend
      ? startOfDay(parseISO(maybeSkipWeekend(adjusted, config.skip_weekend)!))
      : adjusted;

    if (isBefore(after, final)) {
      // This occurrence is after our reference date
      if (end && isBefore(end, final)) return null;
      return formatDate(final);
    }

    candidate = advanceByFrequency(candidate, config.frequency, config.interval);
  }

  return null;
}

/**
 * Compute the initial next_date for a new schedule (first occurrence >= start_date).
 */
export function computeInitialNextDate(
  config: RecurrenceConfig
): string {
  const start = startOfDay(parseISO(config.start_date));
  const dayBefore = addDays(start, -1);
  return computeNextDate(config, formatDate(dayBefore)) ?? config.start_date;
}

function advanceByFrequency(
  date: Date,
  frequency: ScheduleFrequency,
  interval: number
): Date {
  switch (frequency) {
    case "daily":
      return addDays(date, interval);
    case "weekly":
      return addWeeks(date, interval);
    case "biweekly":
      return addWeeks(date, 2 * interval);
    case "monthly":
      return addMonths(date, interval);
    case "yearly":
      return addYears(date, interval);
    default:
      return date;
  }
}

function applyDayConstraints(
  date: Date,
  config: RecurrenceConfig
): Date {
  if (
    (config.frequency === "monthly" || config.frequency === "yearly") &&
    config.day_of_month != null
  ) {
    if (config.day_of_month === -1) {
      return lastDayOfMonth(date);
    }
    const maxDay = lastDayOfMonth(date).getDate();
    const day = Math.min(config.day_of_month, maxDay);
    return setDate(date, day);
  }

  if (
    (config.frequency === "weekly" || config.frequency === "biweekly") &&
    config.day_of_week != null
  ) {
    return setDay(date, config.day_of_week, { weekStartsOn: 0 });
  }

  return date;
}

function maybeSkipWeekend(
  date: Date,
  skipWeekend: string | null
): string | null {
  if (!skipWeekend || !isWeekend(date)) {
    return formatDate(date);
  }
  if (skipWeekend === "before") {
    return formatDate(previousFriday(date));
  }
  if (skipWeekend === "after") {
    return formatDate(nextMonday(date));
  }
  return formatDate(date);
}

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

// ─── Status computation ──────────────────────────────────────

/**
 * Compute the display status for a schedule.
 * Matches Actual Budget's 6-state model.
 */
export function getScheduleStatus(
  schedule: { next_date: string; completed: boolean },
  hasPaidTransaction: boolean
): ScheduleStatus {
  if (schedule.completed) return "completed";
  if (hasPaidTransaction) return "paid";

  const today = startOfDay(new Date());
  const nextDate = startOfDay(parseISO(schedule.next_date));

  if (isEqual(nextDate, today)) return "due";
  if (isBefore(nextDate, today)) return "missed";

  const daysUntil = differenceInDays(nextDate, today);
  if (daysUntil <= 7) return "upcoming";

  return "scheduled";
}

// ─── Display helpers ─────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinal(n: number): string {
  if (n === -1) return "last day";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Human-readable frequency description.
 * Examples: "Monthly on the 1st", "Every 2 weeks on Fri", "Daily", "Once"
 */
export function formatFrequency(
  schedule: Pick<
    ScheduledTransaction,
    "frequency" | "interval" | "day_of_month" | "day_of_week" | "start_date"
  >
): string {
  const { frequency, interval, day_of_month, day_of_week } = schedule;

  switch (frequency) {
    case "once":
      return "Once";

    case "daily":
      return interval > 1 ? `Every ${interval} days` : "Daily";

    case "weekly":
      if (interval > 1) {
        const dayStr =
          day_of_week != null ? ` on ${DAY_NAMES[day_of_week]}` : "";
        return `Every ${interval} weeks${dayStr}`;
      }
      return day_of_week != null
        ? `Weekly on ${DAY_NAMES[day_of_week]}`
        : "Weekly";

    case "biweekly":
      return day_of_week != null
        ? `Every 2 weeks on ${DAY_NAMES[day_of_week]}`
        : "Every 2 weeks";

    case "monthly":
      if (interval > 1) {
        const dayStr =
          day_of_month != null ? ` on the ${ordinal(day_of_month)}` : "";
        return `Every ${interval} months${dayStr}`;
      }
      return day_of_month != null
        ? `Monthly on the ${ordinal(day_of_month)}`
        : "Monthly";

    case "yearly":
      if (interval > 1) return `Every ${interval} years`;
      return "Yearly";

    default:
      return frequency;
  }
}

type BadgeIntent = "neutral" | "positive" | "negative" | "warning" | "info";

/**
 * Label + badge intent for a schedule status. Consumers feed the intent
 * straight into <Badge intent={...}> from components/ui/badge.
 */
export function getStatusProps(status: ScheduleStatus): {
  label: string;
  intent: BadgeIntent;
} {
  switch (status) {
    case "missed":
      return { label: "Missed", intent: "negative" };
    case "due":
      return { label: "Due", intent: "warning" };
    case "upcoming":
      return { label: "Upcoming", intent: "info" };
    case "paid":
      return { label: "Paid", intent: "positive" };
    case "completed":
      return { label: "Completed", intent: "neutral" };
    case "scheduled":
      return { label: "Scheduled", intent: "neutral" };
  }
}
