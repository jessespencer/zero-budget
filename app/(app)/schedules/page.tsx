import { Suspense } from "react";
import { getSchedules, getAccountsAndCategories } from "./actions";
import { catchUpDueSchedules } from "@/lib/schedules-catchup";
import { ScheduleTable } from "@/components/schedules/schedule-table";
import { AddScheduleButton } from "@/components/schedules/add-schedule-button";

export default async function SchedulesPage() {
  // Backstop for long-lived tabs: the (app) layout catches up on app load, but
  // layouts aren't re-executed on soft client-side navigation, so a tab left
  // open across a due date would otherwise never catch up. Request-cached, so
  // on a hard load of this route the layout's call already did the work.
  await catchUpDueSchedules();

  const [schedules, { accounts, categories, categoryGroups }] =
    await Promise.all([getSchedules(), getAccountsAndCategories()]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-[88px] border-b border-border bg-accent/40">
        <h1 className="page-title">
          Schedules
        </h1>
        <Suspense>
          <AddScheduleButton
            accounts={accounts}
            categories={categories}
            categoryGroups={categoryGroups}
          />
        </Suspense>
      </div>

      {/* Table */}
      <ScheduleTable
        schedules={schedules}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
      />
    </div>
  );
}
