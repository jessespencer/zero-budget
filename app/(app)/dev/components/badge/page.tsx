import { Check, Info, AlertTriangle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const intents = ["neutral", "positive", "negative", "warning", "info", "brand"] as const;

export default function BadgePlaygroundPage() {
  return (
    <PlaygroundShell
      title="Badge"
      source="components/ui/badge.tsx"
      description="Pill label with intent colors. Use neutral for counts, positive for confirmations, warning for underfunded, etc."
    >
      <Section title="Intents">
        <div className="flex flex-wrap items-center gap-3">
          {intents.map((intent) => (
            <Badge key={intent} intent={intent}>
              {intent}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="With icons">
        <div className="flex flex-wrap items-center gap-3">
          <Badge intent="positive">
            <Check />
            Paid
          </Badge>
          <Badge intent="warning">
            <AlertTriangle />
            Underfunded
          </Badge>
          <Badge intent="info">
            <Info />
            Scheduled
          </Badge>
          <Badge intent="negative">
            <X />
            Overspent
          </Badge>
        </div>
      </Section>

      <Section title="As counts" hint="common usage">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2 text-sm">
            <span>Transactions</span>
            <Badge>247</Badge>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span>Overspent</span>
            <Badge intent="negative">3</Badge>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span>Uncategorized</span>
            <Badge intent="warning">12</Badge>
          </div>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
