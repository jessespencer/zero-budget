"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { UncategorizedBanner, UncategorizedFilterActive } from "@/components/shared/uncategorized-banner";

type TransactionBannerProps = {
  uncategorizedCount: number;
  isFilteringUncategorized: boolean;
};

export function TransactionBanner({
  uncategorizedCount,
  isFilteringUncategorized,
}: TransactionBannerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const clearFilter = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("category");
    // "View" widened the date axis to all dates; reverting it here drops the
    // user back to their saved default (generally this month) instead of
    // stranding them on the slow all-time list. A search intentionally spans
    // all history, so leave the range alone when one is active.
    if (!params.get("search")) {
      params.delete("range");
      params.delete("start");
      params.delete("end");
    }
    const next = params.toString();
    router.push(next ? `?${next}` : "?");
  };

  if (isFilteringUncategorized) {
    return <UncategorizedFilterActive onClear={clearFilter} />;
  }

  return (
    <UncategorizedBanner
      count={uncategorizedCount}
      onView={() => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("category", "uncategorized");
        // The count is all-time, so widen the date filter to all dates —
        // otherwise clicking View could reveal fewer rows than the banner
        // promised (out-of-range uncategorized transactions stay hidden).
        params.set("range", "all");
        params.delete("start");
        params.delete("end");
        router.push(`?${params.toString()}`);
      }}
    />
  );
}
