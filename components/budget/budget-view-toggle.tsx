"use client";

import { LayoutList, Table2 } from "lucide-react";
import { SegmentedControl } from "@/components/shared/segmented-control";
import type { BudgetView } from "./budget-view";

type BudgetViewToggleProps = {
  view: BudgetView;
  onChange: (view: BudgetView) => void;
  className?: string;
};

export function BudgetViewToggle({ view, onChange, className }: BudgetViewToggleProps) {
  return (
    <SegmentedControl
      ariaLabel="Budget view"
      iconOnly
      pill
      value={view}
      onChange={onChange}
      className={className}
      options={[
        { value: "grid", label: "Grid", icon: Table2 },
        { value: "simple", label: "Simple", icon: LayoutList },
      ]}
    />
  );
}
