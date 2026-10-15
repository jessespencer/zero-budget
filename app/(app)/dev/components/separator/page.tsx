import { Separator } from "@/components/ui/separator";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function SeparatorPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Separator"
      source="components/ui/separator.tsx"
      description="Divider line. Horizontal (full width) or vertical (self-stretch)."
    >
      <Section title="Horizontal">
        <div className="max-w-md">
          <div className="text-sm">Above</div>
          <Separator className="my-3" />
          <div className="text-sm">Below</div>
        </div>
      </Section>

      <Section title="Vertical" hint="orientation='vertical'">
        <div className="flex h-12 items-center text-sm">
          <span>Left</span>
          <Separator orientation="vertical" className="mx-4" />
          <span>Middle</span>
          <Separator orientation="vertical" className="mx-4" />
          <span>Right</span>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
