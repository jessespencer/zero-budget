"use client";

import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function CollapsiblePlaygroundPage() {
  return (
    <PlaygroundShell
      title="Collapsible"
      source="components/ui/collapsible.tsx"
      description="Animated expand/collapse panel. Trigger toggles the content. Used in category groups and FAQ-style lists."
    >
      <Section title="Default (closed)">
        <Collapsible className="max-w-md">
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-left text-sm font-medium hover:bg-accent/30">
            Show advanced options
            <ChevronDown className="h-4 w-4 transition-transform group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded-lg border border-border bg-card p-4 text-sm">
            <p>These options are hidden by default to keep the surface uncluttered.</p>
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              <li>Auto-categorize new transactions</li>
              <li>Show pending balance</li>
              <li>Hide closed accounts</li>
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </Section>

      <Section title="Default open" hint="defaultOpen">
        <Collapsible defaultOpen className="max-w-md">
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-left text-sm font-medium hover:bg-accent/30">
            Subscriptions
            <ChevronDown className="h-4 w-4 transition-transform group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded-lg border border-border bg-card p-4 text-sm">
            <p>Default-open variant — typical for category groups.</p>
          </CollapsibleContent>
        </Collapsible>
      </Section>
    </PlaygroundShell>
  );
}
