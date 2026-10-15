"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InsightsSectionHeader } from "./insights-section-header";
import { CardFilterBar } from "./card-filter-bar";
import { YearStepper } from "./year-stepper";
import { RangeStepper } from "./range-stepper";
import { SeasonalityTab } from "./trends-tab";
import { SpendingCalendarTab } from "./spending-calendar-tab";
import type {
  SeasonalityData,
  SpendingCalendarData,
} from "@/app/(app)/insights/actions";

type PatternsTabProps = {
  seasonalityData: SeasonalityData;
  calendarData: SpendingCalendarData;
  selectedGroupKeys: string[];
  includeArchived: boolean;
};

// Consolidated "Patterns" tab. Fills the shared Insights skeleton: a section
// header (title + subtitle left, segmented view control + year stepper right),
// then a content card with the chips/Include-hidden filter bar inside it. The
// segmented control swaps the two heatmaps as instant client state (both data
// sets are fetched server-side). The year stepper drives ?year= and shows only
// on the day view — the month view is decade-averaged. Heatmaps reused untouched.
export function PatternsTab({
  seasonalityData,
  calendarData,
  selectedGroupKeys,
  includeArchived,
}: PatternsTabProps) {
  const searchParams = useSearchParams();
  // Seeded from `?view=`, so a copied link reopens on the heatmap you were
  // looking at. Everything else on this tab (year, groups, archived) already
  // round-trips through the URL; this control was the one that didn't, which
  // made the calendar the only un-linkable view on the page.
  const [view, setView] = useState<"month" | "day">(
    searchParams.get("view") === "day" ? "day" : "month"
  );

  // `history.replaceState` rather than `router.push`: both datasets are already
  // fetched and passed as props, so the swap is pure client state and should
  // stay instant. A router navigation would round-trip the server for data we
  // are already holding. Next supports this for search-param-only updates.
  const selectView = (next: "month" | "day") => {
    setView(next);
    const params = new URLSearchParams(searchParams.toString());
    // "month" is the default — leave it out so shared URLs stay clean.
    if (next === "day") params.set("view", "day");
    else params.delete("view");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };

  const allGroups = seasonalityData.allGroups ?? calendarData.allGroups;

  return (
    <div className="flex flex-col gap-4">
      <InsightsSectionHeader
        title="Spending patterns"
        subtitle={
          view === "month"
            ? "Average spend by calendar month — darker means a bigger share of that category's year."
            : "Darker means a heavier spend day. Tap a day to see its transactions."
        }
        calendarControl={
          view === "day" ? <YearStepper /> : <RangeStepper label="All years" />
        }
        controls={
          <Tabs value={view} onValueChange={(v) => selectView(v as "month" | "day")}>
            <TabsList>
              <TabsTrigger value="month">By month · all years</TabsTrigger>
              <TabsTrigger value="day">By day · this year</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <CardFilterBar
          allGroups={allGroups}
          selectedGroupKeys={selectedGroupKeys}
          includeArchived={includeArchived}
        />
        {view === "month" ? (
          <SeasonalityTab data={seasonalityData} />
        ) : (
          <SpendingCalendarTab data={calendarData} />
        )}
      </div>
    </div>
  );
}
