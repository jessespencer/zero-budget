"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Compact year navigator for the Insights toolbar left cluster. Drives the
// `year` URL param (absent = current year). Used by Tables (month grain +
// Savings) and Patterns (day view). The page-title YearSelector rotor is
// reserved for header bands; this is the in-toolbar equivalent.
export function YearStepper() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentYear = new Date().getFullYear();
  const year = Number(searchParams.get("year")) || currentYear;
  const isCurrentYear = year >= currentYear;

  const navigate = (next: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === currentYear) params.delete("year");
    else params.set("year", String(next));
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous year"
        className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:text-muted-foreground/40"
        onClick={() => navigate(year - 1)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="min-w-[56px] text-center text-sm font-medium tabular-nums">
        {year}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next year"
        className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:text-muted-foreground/40"
        disabled={isCurrentYear}
        onClick={() => navigate(year + 1)}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "ml-1 text-xs",
          isCurrentYear && "invisible pointer-events-none"
        )}
        aria-hidden={isCurrentYear}
        tabIndex={isCurrentYear ? -1 : 0}
        onClick={() => navigate(currentYear)}
      >
        This year
      </Button>
    </div>
  );
}
