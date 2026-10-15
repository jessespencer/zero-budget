import {
  getInsightsData,
  getTablesPivot,
  getAuditPivotData,
  getSeasonalityData,
  getSpendingCalendarData,
  getSpendingData,
  getPayeeSpendingTrends,
} from "./actions";
import { InsightsTabs } from "@/components/insights/insights-tabs";
import { FEATURES } from "@/lib/features";

type InsightsPageProps = {
  searchParams: Promise<{
    year?: string;
    tab?: string;
    table?: string;
    grain?: string;
    groups?: string;
    archived?: string;
    spendingMonth?: string;
  }>;
};

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const params = await searchParams;
  // Legacy deep-link shim: the old standalone tabs map onto the consolidated
  // Tables tab. audit → Year grain (it was always the Zero-current pivot of the
  // same category × spending measure); expenses/savings → Month grain.
  const LEGACY_TAB_REMAP: Record<string, { grain: "month" | "year" }> = {
    "expenses-year": { grain: "month" },
    "savings-year": { grain: "month" },
    audit: { grain: "year" },
  };
  const legacy = LEGACY_TAB_REMAP[params.tab ?? ""];
  const tab = legacy ? "tables" : (params.tab ?? "net-worth");
  const grainParam = legacy?.grain ?? params.grain;
  // Tables granularity: Month (12 months of `year`) | Year (decade). Year is
  // gated on HISTORICAL_DATA, so OSS stays current-year month-only.
  const grain =
    grainParam === "year" && FEATURES.HISTORICAL_DATA ? "year" : "month";
  // When FEATURES.HISTORICAL_DATA is off (default for OSS), the `?year=` URL
  // param is ignored and the insights renders current-state only. Installs that
  // opt in flip the flag true to re-enable year navigation + the Year grain.
  const currentYear = new Date().getFullYear();
  const year = FEATURES.HISTORICAL_DATA
    ? Number(params.year) || currentYear
    : currentYear;

  const {
    accounts,
    trackedAssets,
    archivedAssets,
    trackedAssetLastUpdated,
    series,
  } = await getInsightsData();

  // Spending data is only needed on the spending tab; getSpendingData defaults
  // to the current month when the searchParam is missing or malformed.
  const spendingResult =
    tab === "spending" ? await getSpendingData(params.spendingMonth) : undefined;

  const auditSelectedGroupKeys = params.groups
    ? params.groups.split(",").filter(Boolean)
    : [];
  // Hidden (archived) envelopes are excluded by default — consistent with the
  // budget page and the rest of the app. Opt in via the toggle (`?archived=1`).
  const auditIncludeArchived = params.archived === "1";
  // Unified envelope table — Month or Year grain, all envelopes, group/hidden
  // filtered. One pivot feeds both grains (the grid renders columns to match).
  const tablesData =
    tab === "tables"
      ? await getTablesPivot({
          grain,
          year,
          groupKeys: auditSelectedGroupKeys.length > 0 ? auditSelectedGroupKeys : undefined,
          includeArchived: auditIncludeArchived,
        })
      : undefined;
  // Trends reuses the Zero audit pivot (same per-category yearly aggregation,
  // no parallel query) plus the same group / hidden filters.
  const trendsData =
    FEATURES.HISTORICAL_DATA && tab === "trends"
      ? await getAuditPivotData({
          pivotBy: "zero",
          groupKeys: auditSelectedGroupKeys.length > 0 ? auditSelectedGroupKeys : undefined,
          includeArchived: auditIncludeArchived,
        })
      : undefined;
  // Payee × year companion to the trends pivot — same chips, same single render.
  // Feeds the "By payee" toggle on the all-time spending section (client state;
  // no refetch on toggle).
  const trendsPayeeData =
    FEATURES.HISTORICAL_DATA && tab === "trends"
      ? await getPayeeSpendingTrends({
          groupKeys: auditSelectedGroupKeys.length > 0 ? auditSelectedGroupKeys : undefined,
          includeArchived: auditIncludeArchived,
        })
      : undefined;
  // Patterns consolidates the seasonality heatmap (by month, all years) and the
  // spending calendar (by day, this year) under one tab with a client-side
  // segmented control, so both data sets load together. The calendar respects
  // the selected year; seasonality is year-independent (decade-averaged).
  const patternsActive = FEATURES.HISTORICAL_DATA && tab === "patterns";
  const seasonalityData = patternsActive
    ? await getSeasonalityData({
        groupKeys: auditSelectedGroupKeys.length > 0 ? auditSelectedGroupKeys : undefined,
        includeArchived: auditIncludeArchived,
      })
    : undefined;
  const calendarData = patternsActive
    ? await getSpendingCalendarData({
        year,
        groupKeys: auditSelectedGroupKeys.length > 0 ? auditSelectedGroupKeys : undefined,
        includeArchived: auditIncludeArchived,
      })
    : undefined;
  // When `groups` param is absent, treat all groups as selected so the
  // filter toolbar reflects the actual filter state. Derived from whichever
  // pivot is live this render (audit / trends / seasonality / calendar all share
  // the Zero group taxonomy).
  const pivotAllGroups =
    tablesData?.allGroups ??
    trendsData?.allGroups ??
    seasonalityData?.allGroups ??
    calendarData?.allGroups;
  const effectiveSelectedGroupKeys =
    pivotAllGroups && auditSelectedGroupKeys.length === 0
      ? pivotAllGroups.map((g) => g.key)
      : auditSelectedGroupKeys;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-6 h-[88px] border-b border-border bg-accent/40">
        <h1 className="page-title">Insights</h1>
      </div>
      <div className="flex-1 overflow-auto px-6 pt-6 pb-24">
        <InsightsTabs
          accounts={accounts}
          trackedAssets={trackedAssets}
          archivedAssets={archivedAssets}
          trackedAssetLastUpdated={trackedAssetLastUpdated}
          series={series}
          spending={spendingResult?.spending}
          spendingMonth={spendingResult?.month}
          tablesData={tablesData}
          trendsData={trendsData}
          trendsPayeeData={trendsPayeeData}
          seasonalityData={seasonalityData}
          calendarData={calendarData}
          auditSelectedGroupKeys={effectiveSelectedGroupKeys}
          auditIncludeArchived={auditIncludeArchived}
          activeGrain={grain}
          activeTab={tab}
        />
      </div>
    </div>
  );
}
