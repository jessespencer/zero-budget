"use client";

import { useState, useTransition, useEffect } from "react";
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
import { useToast } from "@/components/ui/toast";
import { trackedAssetTypeOptions } from "./add-tracked-asset-dialog";
import { useNetWorthUndo } from "./use-net-worth-undo";
import type { TrackedAsset, TrackedAssetType } from "@/lib/types";
import { fieldClass } from "@/lib/utils";

export type EditTrackedAssetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: TrackedAsset;
};

export function EditTrackedAssetDialog({
  open,
  onOpenChange,
  asset,
}: EditTrackedAssetDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(asset.name);
  const [assetType, setAssetType] = useState<TrackedAssetType>(asset.asset_type);
  const [error, setError] = useState<string | null>(null);
  const { pushMetaUpdate, undoEntry } = useNetWorthUndo();
  const { toast } = useToast();

  // Reseed local state from props when the dialog opens — AssetMenu is reused
  // across navigations so the closed-state value can be stale.
  useEffect(() => {
    if (open) {
      setName(asset.name);
      setAssetType(asset.asset_type);
      setError(null);
    }
  }, [open, asset.id, asset.name, asset.asset_type]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      // Save is already disabled in this state, but be defensive.
      onOpenChange(false);
      return;
    }
    const nameChanged = trimmed !== asset.name;
    const typeChanged = assetType !== asset.asset_type;
    if (!nameChanged && !typeChanged) {
      onOpenChange(false);
      return;
    }
    const updates: { name?: string; asset_type?: TrackedAssetType } = {};
    if (nameChanged) updates.name = trimmed;
    if (typeChanged) updates.asset_type = assetType;
    setError(null);
    startTransition(async () => {
      try {
        const entryId = await pushMetaUpdate(asset.id, updates);
        toast({
          message: `${trimmed} updated`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update asset.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit asset</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FieldGroup label="Name" htmlFor="edit-tracked-asset-name">
            <input
              id="edit-tracked-asset-name"
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              autoFocus
            />
          </FieldGroup>

          <FieldGroup label="Asset type" htmlFor="edit-tracked-asset-type">
            <Select
              value={assetType}
              onValueChange={(v) => v && setAssetType(v as TrackedAssetType)}
            >
              <SelectTrigger id="edit-tracked-asset-type" className="w-full h-10">
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
          <Button onClick={handleSave} disabled={isPending || !name.trim()}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
