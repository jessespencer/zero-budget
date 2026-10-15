"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

// "Include hidden" toggle as a pill, matching the group chips' recipe (kept in
// sync with group-chips / budget-filter-bar) so the filter bar reads as one
// consistent control set instead of a stray native checkbox. The eye icon
// distinguishes it from a group chip; active = the secondary tinted-green style
// (border-primary/30 + bg-primary/15, matching the transaction filter chips),
// not the solid brand green. Reads/writes the `archived` URL param (absent =
// hidden excluded — the default; `1` = include hidden).
const pillClass =
  "inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-sm font-action transition-colors whitespace-nowrap shrink-0";

export function IncludeHiddenToggle({
  includeArchived,
}: {
  includeArchived: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const toggle = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (includeArchived) params.delete("archived");
    else params.set("archived", "1");
    router.push(`?${params.toString()}`);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={includeArchived}
      className={cn(
        pillClass,
        includeArchived
          ? "border border-primary/30 bg-primary/15 text-foreground"
          : "surface-card"
      )}
    >
      {includeArchived ? (
        <>
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          Hide hidden
        </>
      ) : (
        <>
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          Include hidden
        </>
      )}
    </button>
  );
}
