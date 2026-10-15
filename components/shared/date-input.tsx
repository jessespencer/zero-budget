"use client";

import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  className?: string;
};

export function DateInput({ className, ...props }: DateInputProps) {
  return (
    <div className="relative">
      <input
        type="date"
        className={cn(
          "flex h-10 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 pr-9 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 placeholder:text-muted-foreground dark:bg-input",
          "[&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-10 [&::-webkit-calendar-picker-indicator]:h-10 [&::-webkit-calendar-picker-indicator]:cursor-pointer",
          className
        )}
        {...props}
      />
      <Calendar className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
    </div>
  );
}
