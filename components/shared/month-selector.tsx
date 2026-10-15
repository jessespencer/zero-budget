"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { formatMonthYear, getMonthKey, prevMonth, nextMonth } from "@/lib/format";

export function MonthSelector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentMonth = getMonthKey();
  const month = searchParams.get("month") || currentMonth;
  const isCurrentMonth = month === currentMonth;
  const maxMonth = nextMonth(currentMonth);
  const isAtMax = month >= maxMonth;

  const navigate = (newMonth: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", newMonth);
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 pr-6">
      {/* Visible month label. Demoted from <h1> to <div> so the budget page
          can ship a single canonical h1 ("Budget") and avoid a duplicate
          page-title heading in the SR rotor (260511-jlp). */}
      <div className="page-title min-w-[145px]">
        {formatMonthYear(month)}
      </div>
      <TooltipProvider>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous month"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => navigate(prevMonth(month))}
                />
              }
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Previous month</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Next month"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  disabled={isAtMax}
                  onClick={() => navigate(nextMonth(month))}
                />
              }
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Next month</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      {!isCurrentMonth && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => navigate(currentMonth)}
        >
          Today
        </Button>
      )}
    </div>
  );
}
