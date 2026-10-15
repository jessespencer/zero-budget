"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Single-line text that shows its full value in a tooltip only when it's
 * actually cut off. One element throughout, so the ResizeObserver keeps
 * measuring after the tooltip turns on (a column widening un-truncates it).
 */
export function TruncatedText({
  children,
  className,
  side = "bottom",
}: {
  children: string;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  const span = (
    <span ref={ref} className={cn("truncate block min-w-0", className)}>
      {children}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={span} />
      {isTruncated && (
        <TooltipContent side={side} align="start">
          {children}
        </TooltipContent>
      )}
    </Tooltip>
  );
}
