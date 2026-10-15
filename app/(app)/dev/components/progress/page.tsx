import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const values = [0, 25, 50, 75, 100] as const;

export default function ProgressPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Progress"
      source="components/ui/progress.tsx"
      description="Determinate progress with optional label and value display."
    >
      <Section title="Values">
        <div className="flex flex-col gap-4">
          {values.map((v) => (
            <div key={v} className="flex flex-col gap-1.5">
              <div className="text-xs text-muted-foreground">value={v}</div>
              <Progress value={v} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="With label and value">
        <Progress value={68}>
          <ProgressLabel>Grocery budget</ProgressLabel>
          <ProgressValue />
        </Progress>
      </Section>
    </PlaygroundShell>
  );
}
