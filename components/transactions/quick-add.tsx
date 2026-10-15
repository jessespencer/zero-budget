"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowLeftRight, LineChart, Plus } from "lucide-react";
import { TransactionDialog } from "./transaction-dialog";
import { TransferDialog } from "./transfer-dialog";
import { AddTrackedAssetDialog } from "@/components/net-worth/add-tracked-asset-dialog";
import type { PayeeOption } from "@/components/shared/payee-combobox";
import { ShortcutTooltip } from "@/components/shared/shortcut-tooltip";
import { Kbd } from "@/components/ui/kbd";

type QuickAddProps = {
  // includes tracking accounts (260517-vxf) — is_budget_account is not used
  // as a picker filter; the field stays on the row shape for downstream uses.
  accounts: { id: string; name: string; type: string; is_budget_account: boolean }[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  payees?: PayeeOption[];
  fab?: boolean;
};

export function QuickAdd({ accounts, categories, categoryGroups, payees = [], fab }: QuickAddProps) {
  const [txnOpen, setTxnOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Tracked-asset add lives in the FAB only on the insights, where the
  // standalone "Add tracked asset" button scrolls out of view once the user
  // is below the chart. Keeps the FAB menu page-relevant elsewhere.
  const showTrackedAssetOption = pathname === "/insights";

  // Route-aware default: when on /accounts/[id], pre-select that account in the picker.
  // Validate against the visible accounts list so a stale or hidden id falls back to undefined.
  const accountIdFromRoute = useMemo(() => {
    const match = pathname?.match(/^\/accounts\/([^/]+)$/);
    if (!match) return undefined;
    const candidate = match[1];
    return accounts.some((a) => a.id === candidate) ? candidate : undefined;
  }, [pathname, accounts]);

  // Route-aware default: when on /budget with a category selected in the
  // panel (synced via ?category=<id>), pre-select that category in the
  // picker. Validate against the categories prop so a stale id falls back
  // to undefined. Scoped to /budget so other pages aren't affected.
  const categoryIdFromRoute = useMemo(() => {
    if (pathname !== "/budget") return undefined;
    const candidate = searchParams?.get("category") ?? undefined;
    if (!candidate) return undefined;
    return categories.some((c) => c.id === candidate) ? candidate : undefined;
  }, [pathname, searchParams, categories]);

  // Transfer dialog needs id+name only; drop type/is_budget_account.
  const transferAccounts = useMemo(
    () => accounts.map((a) => ({ id: a.id, name: a.name })),
    [accounts]
  );

  // Cmd/Ctrl+N and bare "n" stay wired to the dominant action (Transaction),
  // not the popover, so power users don't lose a keystroke to a menu step.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();
      setTxnOpen(true);
    }
    if (e.key === "n" && !isInputFocused()) {
      setTxnOpen(true);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Non-FAB path (used inside /transactions header): preserve single-click
  // "Add transaction" behavior — no popover.
  if (!fab) {
    return (
      <>
        <ShortcutTooltip label="Add transaction" keys={["N"]}>
          <Button
            size="pill"
            onClick={() => setTxnOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add transaction
          </Button>
        </ShortcutTooltip>
        <TransactionDialog
          open={txnOpen}
          onOpenChange={setTxnOpen}
          accounts={accounts}
          categories={categories}
          categoryGroups={categoryGroups}
          payees={payees}
          defaultAccountId={accountIdFromRoute}
          defaultCategoryId={categoryIdFromRoute}
        />
      </>
    );
  }

  // FAB path: 2-option popover (Transaction / Transfer).
  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          render={
            <Button
              size="icon"
              className="h-12 w-12 rounded-full shadow-lg"
              aria-label="Add"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </Button>
          }
        />
        <PopoverContent
          className="w-56 p-1"
          side="top"
          align="end"
          sideOffset={8}
        >
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/30"
            onClick={() => {
              setMenuOpen(false);
              setTxnOpen(true);
            }}
          >
            <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Transaction
            <Kbd className="ml-auto">N</Kbd>
          </button>
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/30"
            onClick={() => {
              setMenuOpen(false);
              setTransferOpen(true);
            }}
          >
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Transfer
          </button>
          {showTrackedAssetOption && (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/30"
              onClick={() => {
                setMenuOpen(false);
                setAssetOpen(true);
              }}
            >
              <LineChart className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Tracked asset
            </button>
          )}
        </PopoverContent>
      </Popover>
      <TransactionDialog
        open={txnOpen}
        onOpenChange={setTxnOpen}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        payees={payees}
        defaultAccountId={accountIdFromRoute}
        defaultCategoryId={categoryIdFromRoute}
      />
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        accounts={transferAccounts}
        defaultFromAccountId={accountIdFromRoute}
      />
      {showTrackedAssetOption && (
        <AddTrackedAssetDialog open={assetOpen} onOpenChange={setAssetOpen} />
      )}
    </>
  );
}

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}
