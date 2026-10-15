"use client";

import { useState, useRef, useTransition } from "react";
import { cn } from "@/lib/utils";
// eslint-disable-next-line no-restricted-imports -- formatCurrency is for the undo-history label (mutation-time, always visible), not a live display.
import { formatCurrency, maskCurrency } from "@/lib/format";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { useToast } from "@/components/ui/toast";
import { updateAssigned } from "@/app/(app)/budget/actions";
import { roundCents } from "@/lib/db-utils";
import type { MutationEntry } from "@/lib/use-undo-redo";

type AssignInputProps = {
  categoryId: string;
  categoryName: string;
  month: string;
  value: number;
  onMutate?: (entry: MutationEntry) => void;
  onSelect?: () => void;
};

export function AssignInput({
  categoryId,
  categoryName,
  month,
  value,
  onMutate,
  onSelect,
}: AssignInputProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(String(roundCents(value)));
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const { hidden } = useAmountsHidden();
  const { toast } = useToast();

  const handleClick = () => {
    setLocalValue(value === 0 ? "" : String(roundCents(value)));
    setEditing(true);
    onSelect?.();
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const handleSave = () => {
    setEditing(false);
    const parsed = parseFloat(localValue) || 0;
    if (parsed !== value) {
      const oldValue = value;
      const newValue = parsed;
      startTransition(async () => {
        try {
          await updateAssigned(categoryId, month, newValue);
          // Registered only once the write is confirmed. Pushing before the
          // await left an undo entry for a save that may have failed, so a
          // later Cmd+Z "restored" a value the database never held.
          onMutate?.({
            label: `Set ${categoryName} to ${formatCurrency(newValue)}`,
            forward: () => updateAssigned(categoryId, month, newValue),
            backward: () => updateAssigned(categoryId, month, oldValue),
          });
        } catch {
          // No toast on success — the grid updating is the feedback. A failure
          // has no on-screen tell at all, so it needs one.
          setLocalValue(String(roundCents(oldValue)));
          toast({
            message: `Couldn't update ${categoryName}. Your change wasn't saved.`,
            variant: "error",
          });
        }
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditing(false);
      setLocalValue(String(roundCents(value)));
    }
  };

  const fieldClasses =
    "w-full h-7 px-2 rounded-lg border border-input bg-muted text-right text-[14px] tabular-nums text-foreground";

  // Privacy mode: mask the value and lock editing ("changes to amounts
  // will not be saved"). Masks zero too, so an empty assign isn't leaked.
  if (hidden) {
    return (
      <button
        type="button"
        disabled
        aria-label="Amounts hidden"
        className={cn(fieldClasses, "zero-amount cursor-not-allowed opacity-70")}
      >
        {maskCurrency(value)}
      </button>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="0.01"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={cn(
          fieldClasses,
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        )}
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        fieldClasses,
        "transition-colors hover:bg-muted/70",
        isPending && "opacity-40"
      )}
      disabled={isPending}
    >
      {value === 0 ? "—" : formatCurrency(value)}
    </button>
  );
}
