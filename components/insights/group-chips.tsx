"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

// Budget filter bar pill recipe — kept in sync with budget-filter-bar.tsx.
const pillClass =
  "inline-flex items-center gap-1.5 rounded-pill px-5 py-2 text-sm font-action transition-colors whitespace-nowrap";

// Bare group-filter chips row. Sits directly below the Insights toolbar on the
// Tables, Trends, and Patterns tabs. Mirrors the budget filter bar's
// select-one-from-All semantics via the `groups` URL param. Its companion
// "Include hidden" toggle lives separately in the toolbar right cluster.
export function GroupChips({
  allGroups,
  selectedGroupKeys,
}: {
  allGroups: { key: string; name: string }[];
  selectedGroupKeys: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const allSelected = selectedGroupKeys.length === allGroups.length;

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      router.push(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const toggleGroup = (groupKey: string) => {
    updateParams((params) => {
      const next = allSelected
        ? [groupKey]
        : selectedGroupKeys.includes(groupKey)
          ? selectedGroupKeys.filter((k) => k !== groupKey)
          : [...selectedGroupKeys, groupKey];
      if (next.length === 0 || next.length === allGroups.length) {
        params.delete("groups");
      } else {
        params.set("groups", next.join(","));
      }
    });
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <button
        type="button"
        onClick={() => updateParams((p) => p.delete("groups"))}
        className={cn(pillClass, allSelected ? "surface-brand" : "surface-card")}
        aria-pressed={allSelected}
      >
        All
      </button>
      {allGroups.map((g) => {
        const active = !allSelected && selectedGroupKeys.includes(g.key);
        return (
          <button
            key={g.key}
            type="button"
            onClick={() => toggleGroup(g.key)}
            className={cn(pillClass, active ? "surface-brand" : "surface-card")}
            aria-pressed={active}
          >
            {g.name}
          </button>
        );
      })}
    </div>
  );
}
