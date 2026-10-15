"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type PageToolbarProps = {
  children?: React.ReactNode;
  rightContent?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  className?: string;
};

export function PageToolbar({
  children,
  rightContent,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  className,
}: PageToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 pl-1.5 pr-6 h-10 border-b border-border/50 bg-background sticky top-0 z-20",
        className
      )}
    >
      {/* Left side: page-specific actions */}
      <div className="flex items-center gap-1">
        {children}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <div className="flex items-center gap-1">
        {rightContent}
        {onSearchChange && (
          <Input
            placeholder={searchPlaceholder}
            className="w-52 h-7 text-sm ml-1"
            defaultValue={searchValue ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              const timeout = setTimeout(() => onSearchChange(value), 300);
              return () => clearTimeout(timeout);
            }}
          />
        )}
      </div>
    </div>
  );
}
