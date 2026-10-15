"use client";

import { X, ChevronDown, Trash2, Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Account } from "@/lib/types";
import { useExitPresence } from "@/components/shared/use-exit-presence";
import { cn } from "@/lib/utils";

type BudgetSelectionToolbarProps = {
  selectedCount: number;
  accounts: Account[];
  onClear: () => void;
  onPickAccount: (accountId: string | null) => void;
  onDelete: () => void;
  disabled?: boolean;
  // When set, the toolbar renders the hidden-selection variant: just count +
  // clear + Unhide (no account reassignment, no delete).
  variant?: "default" | "unhide";
  onUnhide?: () => void;
};

export function BudgetSelectionToolbar({
  selectedCount,
  accounts,
  onClear,
  onPickAccount,
  onDelete,
  disabled = false,
  variant = "default",
  onUnhide,
}: BudgetSelectionToolbarProps) {
  // Stays mounted for the exit animation; shows the last count while leaving.
  const { mounted, closing, last } = useExitPresence(selectedCount > 0, selectedCount);
  if (!mounted) return null;
  selectedCount = last;

  if (variant === "unhide") {
    return (
      <div
        data-budget-selection-toolbar
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 duration-150",
          closing
            ? "animate-out slide-out-to-bottom-4 fade-out fill-mode-forwards pointer-events-none"
            : "animate-in slide-in-from-bottom-4 fade-in"
        )}
      >
        <div className="flex items-center gap-0.5 rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 px-2 py-2">
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            {selectedCount} selected
          </button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <button
            onClick={onUnhide}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-foreground hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            <Eye className="h-3.5 w-3.5" />
            Unhide
          </button>
        </div>
      </div>
    );
  }

  const primary = accounts.find((a) => a.is_primary);
  const budgetAccounts = accounts.filter(
    (a) => a.is_budget_account && !a.archived && !a.is_debt && !a.is_primary
  );

  return (
    <div
      data-budget-selection-toolbar
      className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 duration-150",
          closing
            ? "animate-out slide-out-to-bottom-4 fade-out fill-mode-forwards pointer-events-none"
            : "animate-in slide-in-from-bottom-4 fade-in"
        )}
    >
      <div className="flex items-center gap-0.5 rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 px-1.5 py-1.5">
        {/* Count + clear (X icon) */}
        <button
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          {selectedCount} selected
        </button>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Change account */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            Where money lives
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="center"
            className="max-h-80 overflow-y-auto"
          >
            <DropdownMenuItem onClick={() => onPickAccount(null)}>
              {primary?.name ?? "Primary"} (default)
            </DropdownMenuItem>
            {budgetAccounts.length > 0 && <DropdownMenuSeparator />}
            {budgetAccounts.map((a) => (
              <DropdownMenuItem key={a.id} onClick={() => onPickAccount(a.id)}>
                {a.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Delete */}
        <button
          onClick={onDelete}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </div>
  );
}
