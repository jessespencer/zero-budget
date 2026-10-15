"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

type SelectCheckboxProps = {
  checked: boolean;
  indeterminate?: boolean;
  onClick: (event: React.MouseEvent<HTMLInputElement>) => void;
  ariaLabel: string;
  className?: string;
};

export function SelectCheckbox({
  checked,
  indeterminate = false,
  onClick,
  ariaLabel,
  className,
}: SelectCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <span
      className={cn(
        "relative inline-flex h-10 w-10 items-center justify-center rounded-full",
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        readOnly
        onClick={onClick}
        className={cn(
          "h-3.5 w-3.5 rounded-[3px] border border-muted-foreground/30 accent-primary cursor-pointer",
          // Native indeterminate draws a faint white minus on the green fill that's
          // hard to read. Strip the native rendering (incl. the WebKit dash, which
          // plain `appearance-none` leaves behind) and overlay a dark minus instead.
          indeterminate &&
            "appearance-none [-webkit-appearance:none] border-primary bg-primary",
        )}
        aria-label={ariaLabel}
      />
      {indeterminate && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground" />
      )}
    </span>
  );
}
