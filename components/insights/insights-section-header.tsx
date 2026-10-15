import { cn } from "@/lib/utils";

// Consistent section header for every Insights tab. Two stacked rows:
//   1. an 18px title with an optional subtitle
//   2. a fixed-height controls row on ONE level — a calendar/period control
//      (interactive YearStepper / month nav, or a disabled RangeStepper where
//      there's nothing to navigate) on the left, segmented view control on the
//      right.
// The row is pinned to h-9 so toggling (which can swap one calendar control for
// another) never changes the row height and shifts the content below.
export function InsightsSectionHeader({
  title,
  subtitle,
  calendarControl,
  controls,
  className,
}: {
  title: string;
  subtitle?: string;
  calendarControl?: React.ReactNode;
  controls?: React.ReactNode;
  className?: string;
}) {
  const hasControlRow = Boolean(calendarControl || controls);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="min-w-0">
        <h2 className="heading-section text-foreground">{title}</h2>
        {subtitle ? <p className="text-subtitle">{subtitle}</p> : null}
      </div>
      {hasControlRow ? (
        <div className="flex items-center gap-3 h-9">
          {calendarControl ? (
            <div className="min-w-0 flex items-center">{calendarControl}</div>
          ) : null}
          {controls ? <div className="ml-auto shrink-0">{controls}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
