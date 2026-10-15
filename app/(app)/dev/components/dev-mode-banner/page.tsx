import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function DevModeBannerPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Dev mode banner"
      source="components/shared/dev-mode-banner.tsx"
      description="Sticky amber banner. Renders only when NEXT_PUBLIC_ZERO_DEV_MODE=1. Below is a faithful visual reproduction so you can audit the look without flipping env vars."
    >
      <Section title="Visual reproduction" contentClassName="p-0">
        <div
          role="status"
          aria-label="Development mode (preview)"
          className="flex h-6 items-center justify-center gap-3 bg-amber-300 px-3 text-[11px] text-amber-950"
        >
          <span className="font-semibold uppercase tracking-wider">Dev mode</span>
          <span className="tabular-nums opacity-80">zero.db</span>
        </div>
        <div className="p-4 text-xs text-muted-foreground">
          The live component reads ZERO_DB_PATH and basenames it. AMBER-300 / AMBER-950 is a WCAG-AA pair that works in both themes — the design-token <code>--warning</code> pair can&apos;t pass AA both ways.
        </div>
      </Section>
    </PlaygroundShell>
  );
}
