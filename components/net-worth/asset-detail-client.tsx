"use client";

import type { TrackedAsset, TrackedAssetHistory } from "@/lib/types";
import type { NetWorthPoint } from "@/lib/net-worth-series";
import { NetWorthChart } from "./net-worth-chart";
import { AssetValuePanel } from "./asset-value-panel";
import { AssetHistoryTable } from "./asset-history-table";

type AssetDetailClientProps = {
  asset: TrackedAsset;
  history: TrackedAssetHistory[];
  series: NetWorthPoint[];
};

/**
 * Composes the three pieces of the /assets/[id] body: the reused
 * NetWorthChart (with its own time-range tabs), the AssetValuePanel
 * side-column, and the AssetHistoryTable beneath the chart.
 *
 * Two-column layout kicks in at `lg:` — below that, the side panel stacks
 * under the table so the chart still gets full width on tablets and below.
 *
 * The chart is reused verbatim from Plan 08-03; per-asset step
 * interpolation lives in `lib/net-worth-series.stepInterpolateForAsset`
 * (called by `getAssetSeries`) so the timeline math agrees with the
 * insights chart at every date (HIGH fix H2).
 */
export function AssetDetailClient({
  asset,
  history,
  series,
}: AssetDetailClientProps) {
  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <NetWorthChart points={series} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        <AssetHistoryTable rows={history} />
        <AssetValuePanel
          assetId={asset.id}
          currentValue={Number(asset.current_value)}
        />
      </div>
    </div>
  );
}
