import { MonthSelector } from "@/components/shared/month-selector";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function MonthSelectorPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Month selector"
      source="components/shared/month-selector.tsx"
      description="Page-title-sized month label with prev/next chevrons. Today button appears when not on the current month. Drives the ?month query param."
    >
      <Section title="In a page header" hint="h-[88px] · bg-accent/40">
        <div className="-mx-6 -my-6">
          <div className="flex h-[88px] items-center bg-accent/40 px-6">
            <MonthSelector />
          </div>
          <div className="p-6 text-xs text-muted-foreground">
            Navigation changes the URL — click ◀/▶ above to see the effect.
          </div>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
