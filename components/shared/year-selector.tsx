"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export function YearSelector({ label }: { label: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentYear = new Date().getFullYear();
  const year = Number(searchParams.get("year")) || currentYear;
  const isCurrentYear = year === currentYear;

  const navigate = (newYear: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(newYear));
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2">
      <h1 className="page-title">
        {year} {label}
      </h1>
      <TooltipProvider>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous year"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => navigate(year - 1)}
                />
              }
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Previous year</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Next year"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  disabled={year >= currentYear}
                  onClick={() => navigate(year + 1)}
                />
              }
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Next year</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      {!isCurrentYear && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => navigate(currentYear)}
        >
          This year
        </Button>
      )}
    </div>
  );
}
