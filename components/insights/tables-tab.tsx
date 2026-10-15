"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditGrid } from "./audit-grid";
import { InsightsSectionHeader } from "./insights-section-header";
import { CardFilterBar } from "./card-filter-bar";
import { YearStepper } from "./year-stepper";
import { RangeStepper } from "./range-stepper";
import { FEATURES } from "@/lib/features";
import type { AuditPivotData } from "@/app/(app)/insights/actions";

// Unified envelope table: every budget envelope × time. Month grain shows the
// 12 months of the selected year; Year grain shows the decade. Cells are net
// spending; the Trend sparkline shows the running balance climbing (so savings
// envelopes — funded but rarely spent — read "—" across the cells yet visibly
// trend up). Group chips + Include hidden filter both grains.
type TablesTabProps = {
  data: AuditPivotData;
  grain: "month" | "year";
  selectedGroupKeys: string[];
  includeArchived: boolean;
};

export function TablesTab({
  data,
  grain,
  selectedGroupKeys,
  includeArchived,
}: TablesTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setGrain = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "tables");
    params.set("grain", value);
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <InsightsSectionHeader
        title="Spending by envelope"
        subtitle="Net spending per envelope, with the running balance as a trend."
        // Year stepper (left) on the month grain; on the year grain there's
        // nothing to navigate, so a disabled stepper shows the decade range.
        // Month/Year segmented (right) only with history enabled.
        calendarControl={
          !FEATURES.HISTORICAL_DATA ? undefined : grain === "month" ? (
            <YearStepper />
          ) : (
            <RangeStepper label="All years" />
          )
        }
        controls={
          FEATURES.HISTORICAL_DATA ? (
            <Tabs value={grain} onValueChange={setGrain}>
              <TabsList>
                <TabsTrigger value="month">Month</TabsTrigger>
                <TabsTrigger value="year">Year</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : undefined
        }
      />
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <CardFilterBar
          allGroups={data.allGroups}
          selectedGroupKeys={selectedGroupKeys}
          includeArchived={includeArchived}
        />
        <AuditGrid data={data} />
      </div>
    </div>
  );
}
