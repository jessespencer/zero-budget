"use client";

import { useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
};

type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  // "md" = 38px track (filter bars), "sm" = 32px track (toolbars).
  size?: "md" | "sm";
  // Show icons only; each label moves to the button's accessible name and a
  // hover tooltip. Options without an icon still show their label.
  iconOnly?: boolean;
  // Fully rounded track and thumb, to sit beside pill-shaped chips.
  pill?: boolean;
  className?: string;
};

type Thumb = { left: number; width: number };

// One segmented control for every "pick one of these views" toggle, so they
// look and move the same. The thumb is a single absolutely-positioned element
// that slides to the active segment rather than each button painting its own
// background.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  iconOnly = false,
  pill = false,
  className,
}: SegmentedControlProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  // No slide on first paint — the thumb should simply be there, not fly in
  // from the left edge.
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const active = track.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!active) return setThumb(null);
      setThumb({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    // Counts change width as the user edits the budget; re-measure on any
    // segment resize so the thumb never lags behind its button.
    const observer = new ResizeObserver(measure);
    track.querySelectorAll("button").forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  }, [value, options]);

  useLayoutEffect(() => {
    if (thumb && !animate) {
      const id = requestAnimationFrame(() => setAnimate(true));
      return () => cancelAnimationFrame(id);
    }
  }, [thumb, animate]);

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex items-center gap-0.5 bg-muted p-[3px] shrink-0",
        pill ? "rounded-pill" : "rounded-[10px]",
        size === "md" ? "h-[38px]" : "h-8",
        className
      )}
    >
      {thumb && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-[3px] bottom-[3px] left-0 shadow-sm",
            pill ? "rounded-pill" : "rounded-[7px]",
            // In dark mode --card sits *below* --muted, so a card-colored
            // thumb sinks into the track; lift it with a foreground tint.
            "bg-card dark:bg-foreground/12",
            animate &&
              "transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
          )}
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        />
      )}
      {options.map(({ value: optionValue, label, icon: Icon }) => {
        const active = optionValue === value;
        const hideLabel = iconOnly && !!Icon;
        const button = (
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={hideLabel ? label : undefined}
            onClick={() => onChange(optionValue)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center h-full font-action whitespace-nowrap transition-colors cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              pill ? "rounded-pill" : "rounded-[7px]",
              hideLabel
                ? "aspect-square"
                : size === "md"
                  ? "gap-1.5 px-2.5 text-sm"
                  : "gap-1.5 px-2.5 text-[13px]",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon && (
              <Icon
                className={size === "md" && hideLabel ? "size-[18px]" : "h-3.5 w-3.5"}
                aria-hidden="true"
              />
            )}
            {!hideLabel && label}
          </button>
        );
        if (!hideLabel) return button;
        return (
          <Tooltip key={optionValue}>
            <TooltipTrigger render={button} />
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
