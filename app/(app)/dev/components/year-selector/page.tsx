import { YearSelector } from "@/components/shared/year-selector";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function YearSelectorPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Year selector"
      source="components/shared/year-selector.tsx"
      description="Page-title-sized year label with prev/next chevrons. Caps at the current year. Drives the ?year query param."
    >
      <Section title="In a page header" hint="h-[88px] · bg-accent/40">
        <div className="-mx-6 -my-6">
          <div className="flex h-[88px] items-center bg-accent/40 px-6">
            <YearSelector label="overview" />
          </div>
          <div className="p-6 text-xs text-muted-foreground">
            Navigation changes the URL — click ◀/▶ above to see the effect.
          </div>
        </div>
      </Section>

      <Section title="With a different label">
        <div className="-mx-6 -my-6">
          <div className="flex h-[88px] items-center bg-accent/40 px-6">
            <YearSelector label="spending" />
          </div>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
