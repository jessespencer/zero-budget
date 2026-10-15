"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { createAccount } from "@/app/(app)/accounts/[id]/actions";
import type { AccountType } from "@/lib/types";
import { fieldClass } from "@/lib/utils";
import { parseMoneyInput } from "@/lib/db-utils";
import { useAmountsHidden } from "@/components/shared/privacy-provider";

type AddAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Stay on the current page after creating instead of opening the new
   * account. The setup checklist uses this so adding several accounts in a
   * row doesn't keep pulling the user away from it.
   */
  stayOnPage?: boolean;
};

export const accountTypeOptions: { value: AccountType; label: string }[] = [
  { value: "checking", label: "Checking" },
  { value: "cash", label: "Cash" },
  { value: "savings", label: "Savings" },
  { value: "credit_card", label: "Credit card" },
  { value: "other", label: "Other" },
];

export function AddAccountDialog({ open, onOpenChange, stayOnPage = false }: AddAccountDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { hidden } = useAmountsHidden();

  const reset = () => {
    setName("");
    setType("checking");
    setBalance("");
    setError(null);
  };

  const handleSave = () => {
    // Privacy lock: amounts hidden, so no balance is committed.
    if (hidden) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const parsed = parseMoneyInput(balance);
    if (balance.trim() && parsed === null) {
      setError("Enter a valid number for starting balance.");
      return;
    }
    const parsedBalance = parsed ?? 0;
    setError(null);

    startTransition(async () => {
      try {
        const id = await createAccount({
          name: trimmed,
          type,
          currentBalance: parsedBalance,
        });
        // Only tear the form down once the account actually exists. A throw
        // used to leave "Creating…" reverting with nothing else on screen, so
        // a failure was indistinguishable from a no-op and the user clicked
        // Create again.
        reset();
        onOpenChange(false);
        if (stayOnPage) router.refresh();
        else router.push(`/accounts/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create account.");
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
          <DialogTitle>Add account</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FieldGroup label="Account name" htmlFor="add-account-name">
            <input
              id="add-account-name"
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chase checking"
              autoFocus
            />
          </FieldGroup>

          <FieldGroup label="Account type" htmlFor="add-account-type">
            <Select
              value={type}
              onValueChange={(v) => v && setType(v as AccountType)}
            >
              <SelectTrigger id="add-account-type" className="w-full h-10">
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

          <FieldGroup
            label={type === "credit_card" ? "Amount owed" : "Starting balance"}
            htmlFor="add-account-balance"
          >
            <input
              id="add-account-balance"
              className={fieldClass}
              type="text"
              inputMode="decimal"
              value={hidden ? "" : balance}
              onChange={(e) => {
                setBalance(e.target.value);
                if (error) setError(null);
              }}
              placeholder={hidden ? "$••••••" : "0.00"}
              disabled={hidden}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
            {type === "credit_card" ? (
              <div className="text-xs text-muted-foreground">
                What you currently owe on this card.
              </div>
            ) : null}
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
          <Button onClick={handleSave} disabled={hidden || isPending || !name.trim()}>
            {isPending ? "Creating..." : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
