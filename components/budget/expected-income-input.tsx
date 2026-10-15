"use client";

import { useState, useRef, useTransition } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
// eslint-disable-next-line no-restricted-imports -- formatCurrency is for the undo-history label (mutation-time, always visible); the visible rows use fmt() below.
import { formatCurrency } from "@/lib/format";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useToast } from "@/components/ui/toast";
import { parseMoneyInput, roundCents } from "@/lib/db-utils";
import { updateExpectedIncome } from "@/app/(app)/budget/actions";
import type { MutationEntry } from "@/lib/use-undo-redo";

type ExpectedIncomeInputProps = {
  month: string;
  // User-entered forecast, or null when no forecast is set for the month.
  forecast: number | null;
  // Income actually recorded so far this month (engine-derived).
  received: number;
  onMutate?: (entry: MutationEntry) => void;
};

// Click-to-edit "Expected income" row modeled on AssignInput: the headline is
// the forecast when set (falling back to recorded income when unset), with a
// "Received so far" sub-line once a forecast exists. Enter/blur saves, Escape
// cancels; clearing the field removes the forecast.
export function ExpectedIncomeInput({
  month,
  forecast,
  received,
  onMutate,
}: ExpectedIncomeInputProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const { hidden } = useAmountsHidden();
  const fmt = useMaskedCurrency();
  const { toast } = useToast();

  const display = forecast ?? received;

  const handleClick = () => {
    // Privacy lock: can't edit amounts while hidden.
    if (hidden) return;
    setLocalValue(forecast != null ? String(roundCents(forecast)) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const handleSave = () => {
    setEditing(false);
    // Empty / unparseable input clears the forecast (null); "0" is a real $0.
    const trimmed = localValue.trim();
    const newValue = trimmed === "" ? null : parseMoneyInput(trimmed);
    const oldValue = forecast;
    if (newValue === oldValue) return;
    startTransition(async () => {
      try {
        await updateExpectedIncome(month, newValue);
        // Registered only once the write is confirmed. Pushing before the await
        // left an undo entry for a save that may have failed, so a later Cmd+Z
        // "restored" a forecast the database never held.
        onMutate?.({
          label:
            newValue == null
              ? "Clear expected income"
              : `Set expected income to ${formatCurrency(newValue)}`,
          forward: () => updateExpectedIncome(month, newValue),
          backward: () => updateExpectedIncome(month, oldValue),
        });
      } catch {
        // `display` is prop-driven (forecast ?? received), so the row reverts to
        // the server value on the next render — the toast is the only tell that
        // nothing was saved.
        toast({
          message: "Couldn't update expected income. Your change wasn't saved.",
          variant: "error",
        });
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* min-h-7 = the editing input's height, so the row stays the same
          height whether it shows the button or the input — no jump on open. */}
      <div className="flex min-h-7 items-center justify-between text-sm">
        <span className="text-muted-foreground">Expected income</span>
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            step="0.01"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder="0.00"
            className="w-28 h-7 px-2 rounded-lg border border-input bg-muted text-right text-[14px] tabular-nums text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            autoFocus
          />
        ) : (
          <button
            onClick={handleClick}
            disabled={isPending || hidden}
            className={cn(
              "group flex items-center gap-1.5 tabular-nums font-semibold zero-amount",
              forecast == null && "text-muted-foreground",
              isPending && "opacity-40",
              hidden && "cursor-not-allowed"
            )}
          >
            {/* Pencil on the left so the value stays flush-right with the
                other summary rows. */}
            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            {fmt(display)}
          </button>
        )}
      </div>
      {forecast != null && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Received so far</span>
          <span className="tabular-nums zero-amount">{fmt(received)}</span>
        </div>
      )}
    </div>
  );
}
