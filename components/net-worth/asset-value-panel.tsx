"use client";

import { useState, useTransition } from "react";
import { cn, fieldClass } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field-group";
import { DateInput } from "@/components/shared/date-input";
import { parseMoneyInput } from "@/lib/db-utils";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useToast } from "@/components/ui/toast";
import { useNetWorthUndo } from "./use-net-worth-undo";

type AssetValuePanelProps = {
  assetId: string;
  currentValue: number;
  /** Optional callback fired after a successful save. */
  onUpdated?: () => void;
};

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Side panel for updating a tracked asset's value. Three inputs:
 *
 *  - New value (large tabular-nums input; primary affordance)
 *  - Recorded on (optional date picker for backfilling old values)
 *  - Note (optional)
 *
 * Save calls updateTrackedAssetValueWithSnapshot via the useNetWorthUndo hook
 * so the undo/redo stack picks up the snapshot. Backfilled saves (recorded_at
 * earlier than the most-recent history row) insert a row but do NOT bump the
 * asset's cached current_value — semantics enforced by the server action.
 */
export function AssetValuePanel({
  assetId,
  currentValue,
  onUpdated,
}: AssetValuePanelProps) {
  const [valueRaw, setValueRaw] = useState<string>(currentValue.toFixed(2));
  const [valueFocused, setValueFocused] = useState(false);
  const [recordedAt, setRecordedAt] = useState<string>(todayDateStr());
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { pushValueUpdate, undoEntry } = useNetWorthUndo();
  const { toast } = useToast();
  const { hidden } = useAmountsHidden();
  const fmt = useMaskedCurrency();

  // Show the raw digits while the field is focused (easy to type into), but the
  // fully formatted "$296,000.00" while it sits at rest — the resting value is a
  // number the user reads, not edits. `fmt` also masks to $•••••• in privacy
  // mode, so the hidden branch below is really just for the empty placeholder.
  const parsedValue = parseMoneyInput(valueRaw);
  const valueDisplay = hidden
    ? ""
    : valueFocused || parsedValue === null
      ? valueRaw
      : fmt(parsedValue);

  const handleSave = () => {
    // Privacy lock: amounts hidden, so no value update is saved.
    if (hidden) return;
    const parsed = parseMoneyInput(valueRaw);
    if (parsed === null) {
      setError("Enter a valid amount.");
      return;
    }
    setError(null);
    const trimmedNote = note.trim();

    startTransition(async () => {
      try {
        const entryId = await pushValueUpdate(assetId, {
          value: parsed,
          recorded_at: recordedAt,
          note: trimmedNote.length > 0 ? trimmedNote : undefined,
        });
        setNote("");
        // Backfilled saves (an older recorded_at) deliberately leave the
        // on-screen current value unchanged, so the toast is the only
        // acknowledgement — and the only reachable undo on a page that mounts
        // no Cmd+Z handler. Amount-free by construction (privacy-safe).
        toast({
          message: "Value recorded",
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
        onUpdated?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save value.");
      }
    });
  };

  return (
    <aside className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
      <h2 className="text-sm font-extrabold text-foreground">Update value</h2>

      <FieldGroup label="New value" htmlFor="asset-value-input">
        <input
          id="asset-value-input"
          className={cn(fieldClass, "text-3xl font-bold tabular-nums tracking-tight h-14")}
          type="text"
          inputMode="decimal"
          value={valueDisplay}
          onFocus={() => setValueFocused(true)}
          onBlur={() => setValueFocused(false)}
          onChange={(e) => {
            setValueRaw(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder={hidden ? "$••••••" : "0.00"}
          disabled={hidden}
        />
      </FieldGroup>

      <FieldGroup label="Recorded on" htmlFor="asset-recorded-at">
        <DateInput
          id="asset-recorded-at"
          className="text-sm"
          value={recordedAt}
          max={todayDateStr()}
          onChange={(e) => setRecordedAt(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Backfill an old value? Pick a past date.
        </p>
      </FieldGroup>

      <FieldGroup label="Note (optional)" htmlFor="asset-note">
        <input
          id="asset-note"
          className={fieldClass}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Q1 statement, March valuation"
        />
      </FieldGroup>

      {error ? (
        <div className="text-sm text-negative" role="status">
          {error}
        </div>
      ) : null}

      <Button onClick={handleSave} disabled={hidden || isPending}>
        {isPending ? "Saving..." : "Save"}
      </Button>
    </aside>
  );
}
