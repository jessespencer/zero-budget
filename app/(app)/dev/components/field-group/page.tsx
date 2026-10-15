import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldGroup } from "@/components/ui/field-group";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function FieldGroupPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Field group"
      source="components/ui/field-group.tsx"
      description="Top-labeled form field — text-sm, font-medium, muted, mb-1.5 above the input. Use in every dialog/form; don't hand-roll the label."
    >
      <Section title="Required label">
        <div className="max-w-md">
          <FieldGroup label="Account name" htmlFor="acct-name">
            <Input id="acct-name" placeholder="e.g. Chase Checking" />
          </FieldGroup>
        </div>
      </Section>

      <Section title="Optional label" hint='optional adds " (optional)" suffix'>
        <div className="max-w-md">
          <FieldGroup label="Notes" htmlFor="notes" optional>
            <Textarea id="notes" placeholder="Internal note" rows={3} />
          </FieldGroup>
        </div>
      </Section>

      <Section title="Stacked fields">
        <div className="grid max-w-md gap-4">
          <FieldGroup label="Email">
            <Input type="email" placeholder="you@example.com" />
          </FieldGroup>
          <FieldGroup label="Phone" optional>
            <Input placeholder="+1 555 0100" />
          </FieldGroup>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
