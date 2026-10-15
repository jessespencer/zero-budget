import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// Static counterpart to YearStepper: same chevron · text · chevron chrome, but
// both chevrons disabled and a fixed range string in the middle. Used where the
// calendar slot has nothing to navigate (Tables year grain, Trends all-time,
// Patterns by-month) so the control reads identically to the interactive
// stepper instead of collapsing to bare text.
export function RangeStepper({ label }: { label: string }) {
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        disabled
        aria-hidden
        tabIndex={-1}
        className="h-7 w-7 text-muted-foreground disabled:text-muted-foreground/40"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="min-w-[56px] text-center text-sm font-medium tabular-nums">
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon"
        disabled
        aria-hidden
        tabIndex={-1}
        className="h-7 w-7 text-muted-foreground disabled:text-muted-foreground/40"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
