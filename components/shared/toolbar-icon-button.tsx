"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShortcutTooltip } from "./shortcut-tooltip";

type ToolbarIconButtonProps = ComponentProps<typeof Button> & {
  /** Tooltip text and accessible name (an explicit aria-label still wins). */
  label: string;
  /** Keyboard shortcut chips for the tooltip, e.g. ["⌘", "Z"]. */
  keys?: string[];
};

/**
 * Icon-only action with a tooltip naming it, round to match the pills.
 * - Control rows (filters left, actions right): the default ghost look.
 * - Page headers: pass variant="outline" for secondary actions; only the
 *   primary action keeps a text label.
 * Pass the icon as children; override the size with className (e.g.
 * size-[38px] beside 38px chips).
 */
export function ToolbarIconButton({
  label,
  keys,
  className,
  children,
  ...props
}: ToolbarIconButtonProps) {
  const button = (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      className={cn(
        "size-9 rounded-pill text-muted-foreground hover:text-foreground disabled:text-muted-foreground/30 [&_svg:not([class*='size-'])]:size-[18px]",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );

  if (keys) {
    return (
      <ShortcutTooltip label={label} keys={keys}>
        {button}
      </ShortcutTooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
