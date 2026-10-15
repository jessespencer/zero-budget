"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  Bitcoin,
  Car,
  ChevronDown,
  CreditCard,
  Home,
  PiggyBank,
  Sparkles,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { unarchiveTrackedAsset } from "@/app/(app)/assets/actions";
import { EmptyState } from "@/components/shared/empty-state";
import type { Account, TrackedAsset } from "@/lib/types";
import { TruncatedText } from "@/components/shared/truncated-text";
import {
  groupItems,
  type HoldingGroupKey,
  type TrackedAssetWithLast,
} from "./holdings-list-utils";

const GROUP_ICON: Record<HoldingGroupKey, LucideIcon> = {
  cash: Wallet,
  credit_cards: CreditCard,
  investments: TrendingUp,
  retirement: PiggyBank,
  real_estate: Home,
  crypto: Bitcoin,
  vehicles: Car,
  other: Sparkles,
};

// Re-export canonical labels so external code (and grep-based acceptance
// criteria) can see the eight group labels here. Labels: "Cash and checking"
// (checking/savings/cash), "Credit cards", "Investments", "Retirement",
// "Real estate", "Crypto", "Vehicles", "Other". Matches GROUP_ORDER.
export { GROUP_ORDER } from "./holdings-list-utils";

type HoldingsListProps = {
  accounts: Account[];
  trackedAssets: TrackedAssetWithLast[];
  /**
   * Archived assets. Rendered as a separate collapsed section rather than
   * merged into the groups above — they contribute nothing to net worth, so
   * folding them into a group's total would misstate it.
   */
  archivedAssets: TrackedAsset[];
};

function lastUpdatedLabel(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return "No history yet";
  if (days === 0) return "Last updated today";
  if (days === 1) return "Last updated 1 day ago";
  return `Last updated ${days} days ago`;
}

export function HoldingsList({
  accounts,
  trackedAssets,
  archivedAssets,
}: HoldingsListProps) {
  const fmt = useMaskedCurrency();
  const groups = groupItems(accounts, trackedAssets);
  const nonEmpty = groups.filter((g) => g.items.length > 0);

  if (nonEmpty.length === 0 && archivedAssets.length === 0) {
    return (
      <EmptyState
        icon={PiggyBank}
        message="Add an account or a tracked asset to see your holdings here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {nonEmpty.map((group) => {
        const Icon = GROUP_ICON[group.key];
        return (
          <section key={group.key} className="rounded-xl border border-border bg-card overflow-hidden">
            <header className="flex items-center justify-between gap-3 px-4 h-20 bg-accent/40 border-b border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  aria-hidden="true"
                  className="shrink-0 h-12 w-12 rounded-full bg-background flex items-center justify-center text-foreground/70"
                >
                  <Icon className="h-6 w-6" strokeWidth={1.75} />
                </div>
                <h3 className="text-lg font-extrabold text-foreground truncate">
                  {group.label}
                </h3>
              </div>
              <span
                className={cn(
                  "text-lg tabular-nums font-extrabold shrink-0 zero-amount",
                  group.total < 0 ? "text-negative" : "text-foreground"
                )}
              >
                {fmt(group.total)}
              </span>
            </header>
            <ul className="divide-y divide-border">
              {group.items.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex flex-col min-w-0 leading-tight">
                      <TruncatedText className="text-base font-medium text-foreground">
                        {item.name}
                      </TruncatedText>
                      <span className="text-xs text-muted-foreground truncate">
                        {item.kind === "asset"
                          ? `${item.typeLabel} · ${lastUpdatedLabel(item.lastUpdatedDays)}`
                          : item.typeLabel}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "text-base tabular-nums font-medium shrink-0 zero-amount",
                        item.balance < 0 ? "text-negative" : "text-foreground"
                      )}
                    >
                      {fmt(item.balance)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {archivedAssets.length > 0 && (
        <ArchivedAssetsSection assets={archivedAssets} />
      )}
    </div>
  );
}

/**
 * Archived assets — the route back from `AssetMenu`'s Archive action.
 *
 * Collapsed by default and headed with a count rather than a total: everything
 * in here is excluded from net worth (`lib/net-worth.ts`), so showing a sum
 * would invite reading it as money that still counts. Same treatment as the
 * accounts Closed section in `components/shared/sidebar.tsx` and the Hidden
 * section on /budget.
 */
function ArchivedAssetsSection({ assets }: { assets: TrackedAsset[] }) {
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();
  const { toast } = useToast();
  const childrenId = "archived-assets-children";

  // Unarchiving is reversible and its effect lands in a different section that
  // may be scrolled out of view, so the toast is the acknowledgement. Not
  // destructive, so no confirm and no undo entry — archiving again is the undo.
  const handleUnarchive = (asset: TrackedAsset) => {
    startTransition(async () => {
      try {
        const result = await unarchiveTrackedAsset(asset.id);
        if (result.ok === false) {
          toast({
            message: `Couldn't unarchive "${asset.name}"`,
            variant: "error",
          });
          return;
        }
        toast({ message: `"${asset.name}" unarchived` });
      } catch {
        toast({
          message: `Couldn't unarchive "${asset.name}"`,
          variant: "error",
        });
      }
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={childrenId}
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between gap-3 w-full px-4 h-20 bg-accent/40 border-b border-border text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            aria-hidden="true"
            className="shrink-0 h-12 w-12 rounded-full bg-background flex items-center justify-center text-foreground/70"
          >
            <Archive className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <h3 className="text-lg font-extrabold text-foreground truncate">
            Archived
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
          <span className="text-lg tabular-nums font-extrabold">
            {assets.length}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("h-5 w-5 transition-transform", !expanded && "-rotate-90")}
          />
        </div>
      </button>

      <ul id={childrenId} hidden={!expanded} className="divide-y divide-border">
        {assets.map((asset) => (
          <li
            key={asset.id}
            className="group flex items-center justify-between gap-3 px-4 py-3.5"
          >
            <Link
              href={`/assets/${asset.id}`}
              className="flex flex-col min-w-0 leading-tight opacity-60 hover:opacity-100 transition-opacity"
            >
              <TruncatedText className="text-base font-medium text-foreground">
                {asset.name}
              </TruncatedText>
              <span className="text-xs text-muted-foreground truncate">
                Archived — not counted in net worth
              </span>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => handleUnarchive(asset)}
            >
              <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
              Unarchive
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
