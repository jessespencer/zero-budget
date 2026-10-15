"use client";

import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";

/**
 * Hover hint that names a control's keyboard shortcut — the shortcuts all
 * existed, nothing said so. Wraps the control without changing it.
 */
export function ShortcutTooltip({
  label,
  keys,
  children,
  side = "bottom",
}: {
  label: string;
  /** One chip per key, e.g. ["⌘", "Z"] or ["N"]. */
  keys: string[];
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>
        {label}
        <span className="inline-flex gap-0.5">
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
