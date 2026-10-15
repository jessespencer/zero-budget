import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAssetDetail, getAssetSeries } from "./actions";
import { Currency } from "@/components/shared/currency";
import { AssetMenu } from "@/components/net-worth/asset-menu";
import { AssetDetailClient } from "@/components/net-worth/asset-detail-client";
import { Badge } from "@/components/ui/badge";
import type { TrackedAssetType } from "@/lib/types";

type AssetPageProps = {
  params: Promise<{ id: string }>;
};

// Sentence-case type labels. Single source of truth for the chip subtitle and
// the history-row column subtext on this page. Mirrors trackedAssetTypeOptions
// in add-tracked-asset-dialog.tsx (which uses { value, label } pairs).
const TYPE_LABEL: Record<TrackedAssetType, string> = {
  investment: "Investment",
  retirement: "Retirement",
  real_estate: "Real estate",
  crypto: "Crypto",
  vehicle: "Vehicle",
  other: "Other",
};

export default async function AssetPage({ params }: AssetPageProps) {
  const { id } = await params;
  const [{ asset, history }, series] = await Promise.all([
    getAssetDetail(id),
    getAssetSeries(id),
  ]);

  if (!asset) notFound();

  const value = Number(asset.current_value);
  const typeLabel = TYPE_LABEL[asset.asset_type];

  return (
    <div className="flex flex-col h-full">
      {/* Asset header */}
      <div className="flex items-center justify-between px-6 h-[88px] shrink-0 border-b border-border bg-accent/40">
        <div className="flex items-center gap-3">
          <Link
            href="/insights"
            aria-label="Back to insights"
            className="size-8 rounded-md inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <h1 className="page-title">{asset.name}</h1>
          <Badge className="uppercase tracking-[0.06em]">{typeLabel}</Badge>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground uppercase tracking-[0.04em] font-medium">
              Current value
            </div>
            <div
              className={cn(
                "text-[17px] font-semibold tabular-nums tracking-[-0.01em]",
                value >= 0 ? "text-foreground" : "text-negative"
              )}
            >
              <Currency amount={value} colorize={false} smallCents={false} />
            </div>
          </div>
          <AssetMenu asset={asset} />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <AssetDetailClient asset={asset} history={history} series={series} />
      </div>
    </div>
  );
}
