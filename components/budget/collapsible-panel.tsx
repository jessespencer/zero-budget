"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type CollapsiblePanelProps = {
  title: string;
  icon?: React.ReactNode;
  open: boolean;
  active?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

export function CollapsiblePanel({
  title,
  icon,
  open,
  active,
  onToggle,
  children,
}: CollapsiblePanelProps) {
  return (
    <section
      className="summary-card overflow-hidden"
      data-active={active ? "true" : undefined}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-5 py-4 text-left"
      >
        {icon}
        <h3 className="text-base font-extrabold tracking-[-0.01em]">{title}</h3>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground ml-auto transition-transform duration-150",
            !open && "-rotate-90"
          )}
          strokeWidth={2.5}
        />
      </button>
      {open && <div className="px-5 pb-5 space-y-2.5">{children}</div>}
    </section>
  );
}
