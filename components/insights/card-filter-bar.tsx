import { GroupChips } from "./group-chips";
import { IncludeHiddenToggle } from "./include-hidden-toggle";

// Filter bar docked at the top of a Insights content card: group chips
// (scrollable) on the left, Include hidden pinned right. Lives INSIDE the card.
// Calendar/period controls are NOT here — they sit in their own row directly
// below the section header (matching Spending breakdown). Shared across Tables,
// Trends, and Patterns.
export function CardFilterBar({
  allGroups,
  selectedGroupKeys,
  includeArchived,
}: {
  allGroups: { key: string; name: string }[];
  selectedGroupKeys: string[];
  includeArchived: boolean;
}) {
  return (
    // 55px = 38px chips + 8px above and below + 1px border — matches the
    // budget filter bar, so the space around the chips equals the 8px
    // between them.
    <div className="flex items-center gap-3 px-2 h-[55px] border-b border-border bg-card">
      <div className="min-w-0">
        <GroupChips allGroups={allGroups} selectedGroupKeys={selectedGroupKeys} />
      </div>
      <div className="-my-px self-stretch w-px shrink-0 bg-border" aria-hidden="true" />
      <IncludeHiddenToggle includeArchived={includeArchived} />
    </div>
  );
}
