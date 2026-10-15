"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SpendingBreakdown } from "./spending-breakdown";
import { EmptyState } from "@/components/shared/empty-state";
import { AddAccountDialog } from "@/components/accounts/add-account-dialog";
import { NetWorthTab } from "@/components/net-worth/net-worth-tab";
import { TablesTab } from "./tables-tab";
import { TrendsTab } from "./trends-tab";
import { PatternsTab } from "./patterns-tab";
import { FEATURES } from "@/lib/features";
import type { Account, TrackedAsset } from "@/lib/types";
import type { NetWorthPoint } from "@/lib/net-worth-series";
import type {
  SpendingData,
  AuditPivotData,
  SeasonalityData,
  SpendingCalendarData,
  PayeeTrendsData,
} from "@/app/(app)/insights/actions";
import { ChartLine } from "lucide-react";

type InsightsTabsProps = {
  accounts: Account[];
  trackedAssets: TrackedAsset[];
  /** Archived assets — the holdings list's Archived section. */
  archivedAssets: TrackedAsset[];
  trackedAssetLastUpdated: Record<string, string | null>;
  series: NetWorthPoint[];
  spending?: SpendingData;
  spendingMonth?: string;
  tablesData?: AuditPivotData;
  trendsData?: AuditPivotData;
  trendsPayeeData?: PayeeTrendsData;
  seasonalityData?: SeasonalityData;
  calendarData?: SpendingCalendarData;
  auditSelectedGroupKeys?: string[];
  auditIncludeArchived?: boolean;
  activeGrain: string;
  activeTab: string;
};

export function InsightsTabs({
  accounts,
  trackedAssets,
  archivedAssets,
  trackedAssetLastUpdated,
  series,
  spending,
  spendingMonth,
  tablesData,
  trendsData,
  trendsPayeeData,
  seasonalityData,
  calendarData,
  auditSelectedGroupKeys = [],
  auditIncludeArchived = false,
  activeGrain,
  activeTab,
}: InsightsTabsProps) {
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Archived assets count toward "has holdings": with only archived assets,
  // the empty state would render and the Archived section — the one route back
  // to them — would be unreachable.
  const isEmpty =
    accounts.length === 0 &&
    trackedAssets.length === 0 &&
    archivedAssets.length === 0;

  const handleTabChange = (value: string) => {
    const yearParam = searchParams.get("year");
    const query = yearParam
      ? `?tab=${value}&year=${yearParam}`
      : `?tab=${value}`;
    router.push(query);
  };

  return (
    <>
      <AddAccountDialog open={addAccountOpen} onOpenChange={setAddAccountOpen} />
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList variant="line">
          <TabsTrigger value="net-worth">Net worth</TabsTrigger>
          <TabsTrigger value="spending">Spending breakdown</TabsTrigger>
          <TabsTrigger value="tables">Tables</TabsTrigger>
          {FEATURES.HISTORICAL_DATA && (
            <TabsTrigger value="trends">Trends</TabsTrigger>
          )}
          {FEATURES.HISTORICAL_DATA && (
            <TabsTrigger value="patterns">Patterns</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="net-worth">
          {isEmpty ? (
            <EmptyState
              icon={ChartLine}
              message="Add an account or tracked asset to start tracking your net worth."
              primaryAction={{
                label: "Add account",
                onClick: () => setAddAccountOpen(true),
              }}
            />
          ) : (
            <NetWorthTab
              accounts={accounts}
              trackedAssets={trackedAssets}
              archivedAssets={archivedAssets}
              trackedAssetLastUpdated={trackedAssetLastUpdated}
              series={series}
            />
          )}
        </TabsContent>

        <TabsContent value="spending">
          {accounts.length === 0 ? (
            <EmptyState
              icon={ChartLine}
              message="Your spending breakdown will appear once transactions come through."
              primaryAction={{
                label: "Add transaction",
                onClick: () => router.push("/transactions"),
              }}
            />
          ) : spending && spendingMonth ? (
            <div className="pt-4">
              <SpendingBreakdown spending={spending} month={spendingMonth} />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="tables">
          <div className="pt-4">
            {tablesData ? (
              <TablesTab
                data={tablesData}
                grain={activeGrain === "year" ? "year" : "month"}
                selectedGroupKeys={auditSelectedGroupKeys}
                includeArchived={auditIncludeArchived}
              />
            ) : null}
          </div>
        </TabsContent>

        {FEATURES.HISTORICAL_DATA && (
          <TabsContent value="trends">
            <div className="pt-4">
              {trendsData && trendsPayeeData ? (
                <TrendsTab
                  data={trendsData}
                  payeeData={trendsPayeeData}
                  selectedGroupKeys={auditSelectedGroupKeys}
                  includeArchived={auditIncludeArchived}
                />
              ) : null}
            </div>
          </TabsContent>
        )}

        {FEATURES.HISTORICAL_DATA && (
          <TabsContent value="patterns">
            <div className="pt-4">
              {seasonalityData && calendarData ? (
                <PatternsTab
                  seasonalityData={seasonalityData}
                  calendarData={calendarData}
                  selectedGroupKeys={auditSelectedGroupKeys}
                  includeArchived={auditIncludeArchived}
                />
              ) : null}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
