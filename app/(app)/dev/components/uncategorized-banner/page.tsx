"use client";

import { useState } from "react";
import {
  UncategorizedBanner,
  UncategorizedFilterActive,
} from "@/components/shared/uncategorized-banner";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function UncategorizedBannerPlaygroundPage() {
  const [count, setCount] = useState(12);
  const [filterActive, setFilterActive] = useState(false);

  return (
    <PlaygroundShell
      title="Uncategorized banner"
      source="components/shared/uncategorized-banner.tsx"
      description="Warning-intent banner counting uncategorized transactions. Has a filter-active sibling that announces the current view."
      maxWidth="wide"
    >
      <Section title="Default (clickable, count > 0)" contentClassName="p-0">
        <UncategorizedBanner
          count={count}
          onView={() => setFilterActive(true)}
        />
        <div className="p-4 text-xs text-muted-foreground">
          Click the banner to flip into filter-active mode below.
        </div>
      </Section>

      <Section title="Adjust count">
        <div className="flex items-center gap-2 text-sm">
          <label>Count</label>
          <input
            type="number"
            min={0}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-8 w-24 rounded-md border border-border bg-card px-2 text-sm"
          />
          <span className="text-muted-foreground">— count=0 hides the banner.</span>
        </div>
      </Section>

      <Section title="Filter-active variant" contentClassName="p-0">
        {filterActive ? (
          <UncategorizedFilterActive onClear={() => setFilterActive(false)} />
        ) : (
          <div className="p-4 text-xs text-muted-foreground">
            Filter not active — open from the default banner above to see this.
          </div>
        )}
      </Section>
    </PlaygroundShell>
  );
}
