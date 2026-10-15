"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  updateCategorySettings,
  updateCategorySettingsWithSnapshot,
  restoreCategorySettings,
} from "@/app/(app)/budget/actions";
import type { CategoryWithBudget, Account } from "@/lib/types";
import type { MutationEntry } from "@/lib/use-undo-redo";

type CategorySettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryWithBudget;
  accounts: Account[];
  onMutate: (entry: MutationEntry) => void;
};

export function CategorySettingsDialog({
  open,
  onOpenChange,
  category,
  accounts,
  onMutate,
}: CategorySettingsDialogProps) {
  const primaryAccount = accounts.find((a) => a.is_primary);
  const budgetAccounts = accounts.filter((a) => a.is_budget_account && !a.archived && !a.is_debt);

  // Use "primary" as sentinel value for null allocation_account_id (per D-05, D-06)
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    category.allocation_account_id ?? "primary"
  );
  const [isBuffer, setIsBuffer] = useState(category.is_buffer);
  const [pinnedQuick, setPinnedQuick] = useState(category.pinned_quick);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  // Reset form state when dialog opens -- prevents stale values after undo (per Pitfall 4)
  useEffect(() => {
    if (open) {
      setSelectedAccountId(category.allocation_account_id ?? "primary");
      setIsBuffer(category.is_buffer);
      setPinnedQuick(category.pinned_quick);
      setSaveError(null);
    }
  }, [open, category.allocation_account_id, category.is_buffer, category.pinned_quick]);

  const handleSave = () => {
    const accountIdToSave = selectedAccountId === "primary" ? null : selectedAccountId;
    setSaveError(null);
    // Capture original values up-front so we can detect what changed AFTER
    // the server confirms — toasts fire only for non-local effects the user
    // can't see on the current page.
    const prevIsBuffer = category.is_buffer;
    const prevPinnedQuick = category.pinned_quick;
    const prevAccountId = category.allocation_account_id ?? null;
    startTransition(async () => {
      try {
        const snapshot = await updateCategorySettingsWithSnapshot(
          category.id,
          accountIdToSave,
          isBuffer,
          pinnedQuick
        );
        onMutate({
          label: `Update "${category.name}" settings`,
          forward: async () => {
            await updateCategorySettings(
              category.id,
              accountIdToSave,
              isBuffer,
              pinnedQuick
            );
          },
          backward: async () => {
            await restoreCategorySettings(snapshot);
          },
        });
        onOpenChange(false);

        // Toasts for non-local effects (transfer plan, mobile quick-add).
        // Cmd+Z still works via the onMutate registry above — no Undo button
        // on the toast, since a generic mutation-stack undo wouldn't compose
        // safely with other unrelated mutations the user has stacked.
        // Where a category's money lives only shows up on the transfer plan,
        // so the move needs the same acknowledgement the bulk toolbar gives it
        // ("Moved N categories to X" in budget-table.tsx).
        if (accountIdToSave !== prevAccountId) {
          // Resolve against the full `accounts` list, not `budgetAccounts` —
          // the latter filters out archived and debt accounts, so a category
          // still pointing at one would name it "account".
          const accountName =
            accountIdToSave === null
              ? primaryAccount?.name ?? "Checking"
              : accounts.find((a) => a.id === accountIdToSave)?.name ??
                "account";
          toast({ message: `Moved "${category.name}" to ${accountName}` });
        }
        if (isBuffer !== prevIsBuffer) {
          toast({
            message: isBuffer
              ? "Marked as buffer — excluded from savings transfers"
              : "No longer a buffer category",
          });
        }
        if (pinnedQuick !== prevPinnedQuick) {
          toast({
            message: pinnedQuick
              ? "Pinned to mobile quick-add"
              : "Unpinned from mobile quick-add",
          });
        }
      } catch (err) {
        setSaveError(
          err instanceof Error
            ? err.message
            : "Could not save category settings."
        );
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="gap-0.5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Category settings
          </p>
          <DialogTitle className="text-lg">{category.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {/* Account assignment -- per D-04, D-05 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm">Where does this money live?</label>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input dark:hover:bg-input/80"
              >
                <span className="line-clamp-1 text-left">
                  {selectedAccountId === "primary"
                    ? `${primaryAccount?.name ?? "Checking"} (default)`
                    : budgetAccounts.find((a) => a.id === selectedAccountId)?.name ?? ""}
                </span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                <DropdownMenuItem onClick={() => setSelectedAccountId("primary")}>
                  {primaryAccount?.name ?? "Checking"} (default)
                </DropdownMenuItem>
                {budgetAccounts.filter((a) => !a.is_primary).length > 0 && (
                  <DropdownMenuSeparator />
                )}
                {budgetAccounts
                  .filter((a) => !a.is_primary)
                  .map((account) => (
                    <DropdownMenuItem
                      key={account.id}
                      onClick={() => setSelectedAccountId(account.id)}
                    >
                      {account.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Buffer toggle -- per D-07, D-08, D-09 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Switch checked={isBuffer} onCheckedChange={(v) => setIsBuffer(v)} />
              <span className="text-sm">Buffer category</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Buffer categories keep their balance in checking. They&apos;re
              excluded from savings transfers on the transfer plan page.
            </p>
          </div>

          {/* Pin to mobile quick-add */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Switch
                checked={pinnedQuick}
                onCheckedChange={(v) => {
                  setPinnedQuick(v);
                  setSaveError(null);
                }}
              />
              <span className="text-sm">Pin to mobile quick-add</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Adds this category to the top 3 on the mobile entry page. Limit 3.
            </p>
          </div>

          {saveError && (
            <p className="text-xs text-[var(--color-negative)]">{saveError}</p>
          )}
        </div>
        <DialogFooter className="mt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={handleSave}
          >
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
