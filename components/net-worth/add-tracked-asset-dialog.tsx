"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTrackedAsset } from "@/app/(app)/assets/actions";
import type { TrackedAssetType } from "@/lib/types";
import { fieldClass } from "@/lib/utils";
import { parseMoneyInput } from "@/lib/db-utils";
import { useAmountsHidden } from "@/components/shared/privacy-provider";

type AddTrackedAssetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Sentence-case labels per CLAUDE.md. Order mirrors the existing
// add-account-dialog asset-type ordering.
export const trackedAssetTypeOptions: { value: TrackedAssetType; label: string }[] = [
  { value: "investment", label: "Investment" },
  { value: "retirement", label: "Retirement" },
  { value: "real_estate", label: "Real estate" },
  { value: "crypto", label: "Crypto" },
  { value: "vehicle", label: "Vehicle" },
  { value: "other", label: "Other" },
];

export function AddTrackedAssetDialog({
  open,
  onOpenChange,
}: AddTrackedAssetDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<TrackedAssetType>("investment");
  const [initialValueRaw, setInitialValueRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { hidden } = useAmountsHidden();

  const reset = () => {
    setName("");
    setAssetType("investment");
    setInitialValueRaw("");
    setError(null);
  };

  const handleSave = () => {
    // Privacy lock: amounts hidden, so no asset value is written.
    if (hidden) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name for the asset.");
      return;
    }

    const parsed = parseMoneyInput(initialValueRaw);
    if (parsed === null) {
      setError("Enter a valid amount.");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        await createTrackedAsset({
          name: trimmed,
          asset_type: assetType,
          initial_value: parsed,
        });
        reset();
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add asset.");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tracked asset</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FieldGroup label="Name" htmlFor="add-tracked-asset-name">
            <input
              id="add-tracked-asset-name"
              className={fieldClass}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Vanguard brokerage"
              autoFocus
            />
          </FieldGroup>

          <FieldGroup label="Asset type" htmlFor="add-tracked-asset-type">
            <Select
              value={assetType}
              onValueChange={(v) => v && setAssetType(v as TrackedAssetType)}
            >
              <SelectTrigger id="add-tracked-asset-type" className="w-full h-10">
                <SelectValue>
                  {trackedAssetTypeOptions.find((o) => o.value === assetType)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {trackedAssetTypeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldGroup>

          <FieldGroup label="Current value" htmlFor="add-tracked-asset-value">
            <input
              id="add-tracked-asset-value"
              className={fieldClass}
              type="text"
              inputMode="decimal"
              value={hidden ? "" : initialValueRaw}
              onChange={(e) => {
                setInitialValueRaw(e.target.value);
                if (error) setError(null);
              }}
              placeholder={hidden ? "$••••••" : "0.00"}
              disabled={hidden}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </FieldGroup>

          {error ? (
            <div className="text-sm text-negative" role="status">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={hidden || isPending || !name.trim()}
          >
            {isPending ? "Adding..." : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
