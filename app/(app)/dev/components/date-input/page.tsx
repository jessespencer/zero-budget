"use client";

import { useState } from "react";
import { DateInput } from "@/components/shared/date-input";
import { FieldGroup } from "@/components/ui/field-group";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function DateInputPlaygroundPage() {
  const [value, setValue] = useState("2026-06-09");
  return (
    <PlaygroundShell
      title="Date input"
      source="components/shared/date-input.tsx"
      description="Native date input with calendar icon and design-token styling. Use instead of plain <input type='date'>."
    >
      <Section title="Default">
        <div className="max-w-xs">
          <DateInput defaultValue="2026-06-09" />
        </div>
      </Section>

      <Section title="Controlled">
        <div className="max-w-xs">
          <DateInput value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="mt-2 text-xs text-muted-foreground">value = {value}</div>
        </div>
      </Section>

      <Section title="In a FieldGroup">
        <div className="max-w-xs">
          <FieldGroup label="Transaction date">
            <DateInput defaultValue="2026-06-09" />
          </FieldGroup>
        </div>
      </Section>

      <Section title="Min / max constraints">
        <div className="max-w-xs">
          <DateInput defaultValue="2026-06-09" min="2026-06-01" max="2026-06-30" />
          <div className="mt-2 text-xs text-muted-foreground">
            Constrained to June 2026.
          </div>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
