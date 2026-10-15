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
import { updateAccount } from "@/app/(app)/accounts/[id]/actions";
import { accountTypeOptions } from "./add-account-dialog";
import type { Account, AccountType } from "@/lib/types";
import { fieldClass } from "@/lib/utils";

type EditAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
  /**
   * Hands the close flow back to the caller. When set, the footer grows a
   * destructive "Close account" button — the edit panel is the first place
   * people look. The confirm dialog and the mutation stay in AccountMenu so there is exactly one of each; this only asks for them.
   */
  onRequestClose?: () => void;
};

export function EditAccountDialog({
  open,
  onOpenChange,
  account,
  onRequestClose,
}: EditAccountDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(account.name);
  const [type, setType] = useState<AccountType>(account.type);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(account.name);
      setType(account.type);
      setError(null);
    }
  }, [open, account.id, account.name, account.type]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      // Save button is already disabled in this state, but be defensive.
      onOpenChange(false);
      return;
    }
    const nameChanged = trimmed !== account.name;
    const typeChanged = type !== account.type;
    if (!nameChanged && !typeChanged) {
      onOpenChange(false);
      return;
    }
    const updates: { name?: string; type?: AccountType } = {};
    if (nameChanged) updates.name = trimmed;
    if (typeChanged) updates.type = type;
    setError(null);
    startTransition(async () => {
      try {
        await updateAccount(account.id, updates);
        onOpenChange(false);
      } catch (e) {
        // Keep the dialog open on failure — closing it would strand the user
        // believing a rename that never persisted had gone through.
        setError(e instanceof Error ? e.message : "Could not save account.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FieldGroup label="Account name" htmlFor="edit-account-name">
            <input
              id="edit-account-name"
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              autoFocus
            />
          </FieldGroup>

          <FieldGroup label="Account type" htmlFor="edit-account-type">
            <Select
              value={type}
              onValueChange={(v) => v && setType(v as AccountType)}
            >
              <SelectTrigger id="edit-account-type" className="w-full h-10">
                <SelectValue>
                  {accountTypeOptions.find((o) => o.value === type)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {accountTypeOptions.map((opt) => (
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
          {onRequestClose && !account.archived ? (
            <Button
              variant="destructive"
              className="mr-auto"
              // The primary account can't be closed — the server action refuses
              // it, so don't offer the button and then explain the refusal.
              disabled={account.is_primary}
              title={
                account.is_primary
                  ? "Pick a different primary account first"
                  : undefined
              }
              onClick={() => {
                // Hand off, then step out of the way: the confirm is a second
                // dialog and two stacked overlays is not the shape we want.
                onOpenChange(false);
                onRequestClose();
              }}
            >
              Close account
            </Button>
          ) : null}
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
