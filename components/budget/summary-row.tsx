"use client";

import { cn } from "@/lib/utils";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useFlashOnChange } from "@/components/shared/use-flash-on-change";

export function SummaryRow({
  label,
  value,
  text,
  muted,
  className,
  flash,
}: {
  label: string;
  value?: number;
  text?: string;
  muted?: boolean;
  className?: string;
  /** Flash on change; a string is the reset scope (the month). */
  flash?: boolean | string;
}) {
  const fmt = useMaskedCurrency();
  const flashing = useFlashOnChange(
    value ?? 0,
    typeof flash === "string" ? flash : undefined
  );
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        data-flash={flash ? flashing : undefined}
        className={cn(
          "tabular-nums zero-amount font-semibold",
          muted && "text-muted-foreground",
          className
        )}
      >
        {text ?? (value !== undefined ? fmt(value) : "—")}
      </span>
    </div>
  );
}
