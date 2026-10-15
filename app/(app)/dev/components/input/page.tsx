import { Input } from "@/components/ui/input";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function InputPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Input"
      source="components/ui/input.tsx"
      description="Standard text input — 32px tall, rounded lg. Common types and states."
    >
      <Section title="Default">
        <div className="max-w-md">
          <Input placeholder="Type here…" />
        </div>
      </Section>

      <Section title="Pre-filled">
        <div className="max-w-md">
          <Input defaultValue="Chase Checking" />
        </div>
      </Section>

      <Section title="Disabled">
        <div className="max-w-md">
          <Input defaultValue="Read-only value" disabled />
        </div>
      </Section>

      <Section title="Invalid" hint="aria-invalid">
        <div className="max-w-md">
          <Input defaultValue="bad@input" aria-invalid />
        </div>
      </Section>

      <Section title="Types">
        <div className="grid max-w-md gap-3">
          <Input type="email" placeholder="email" />
          <Input type="password" placeholder="password" />
          <Input type="number" placeholder="number" />
          <Input type="search" placeholder="search" />
          <Input type="file" />
        </div>
      </Section>
    </PlaygroundShell>
  );
}
