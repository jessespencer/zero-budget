import { Textarea } from "@/components/ui/textarea";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function TextareaPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Textarea"
      source="components/ui/textarea.tsx"
      description="Multi-line input. Auto-resizes via field-sizing-content."
    >
      <Section title="Default">
        <div className="max-w-md">
          <Textarea placeholder="Add a note…" rows={3} />
        </div>
      </Section>

      <Section title="Pre-filled">
        <div className="max-w-md">
          <Textarea
            defaultValue={
              "Reimburse Jenny for groceries.\nDon't forget the receipt is in the email folder."
            }
            rows={4}
          />
        </div>
      </Section>

      <Section title="Disabled">
        <div className="max-w-md">
          <Textarea defaultValue="Read-only" disabled rows={2} />
        </div>
      </Section>

      <Section title="Invalid" hint="aria-invalid">
        <div className="max-w-md">
          <Textarea defaultValue="Too short" aria-invalid rows={2} />
        </div>
      </Section>
    </PlaygroundShell>
  );
}
