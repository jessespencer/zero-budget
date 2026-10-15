"use client";

import { useMemo, useState } from "react";
import { ChartLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { NetWorthChart } from "./net-worth-chart";
import { HoldingsList } from "./holdings-list";
import { AddTrackedAssetDialog } from "./add-tracked-asset-dialog";
import type { TrackedAssetWithLast } from "./holdings-list-utils";
import type { NetWorthPoint } from "@/lib/net-worth-series";
import type { Account, TrackedAsset } from "@/lib/types";

type NetWorthTabProps = {
  accounts: Account[];
  trackedAssets: TrackedAsset[];
  /** Archived assets — rendered in the collapsed Archived section. */
  archivedAssets: TrackedAsset[];
  trackedAssetLastUpdated: Record<string, string | null>;
  series: NetWorthPoint[];
};

export function NetWorthTab({
  accounts,
  trackedAssets,
  archivedAssets,
  trackedAssetLastUpdated,
  series,
}: NetWorthTabProps) {
  const [addOpen, setAddOpen] = useState(false);

  const augmentedAssets = useMemo<TrackedAssetWithLast[]>(
    () =>
      trackedAssets.map((ta) => ({
        ...ta,
        lastRecordedAt: trackedAssetLastUpdated[ta.id] ?? null,
      })),
    [trackedAssets, trackedAssetLastUpdated]
  );

  // Archived assets count as holdings here too — otherwise an all-archived
  // account would land on the empty state with no way to reach the Archived
  // section below.
  if (
    accounts.length === 0 &&
    trackedAssets.length === 0 &&
    archivedAssets.length === 0
  ) {
    return (
      <>
        <EmptyState
          icon={ChartLine}
          message="Add an account or tracked asset to start tracking your net worth."
          primaryAction={{
            label: "Add tracked asset",
            onClick: () => setAddOpen(true),
          }}
        />
        <AddTrackedAssetDialog open={addOpen} onOpenChange={setAddOpen} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <NetWorthChart points={series} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="heading-section text-foreground">Holdings</h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Add tracked asset
        </Button>
      </div>

      <HoldingsList
        accounts={accounts}
        trackedAssets={augmentedAssets}
        archivedAssets={archivedAssets}
      />

      <AddTrackedAssetDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
