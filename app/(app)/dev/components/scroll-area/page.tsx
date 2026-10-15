import { ScrollArea } from "@/components/ui/scroll-area";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const rows = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  payee: ["Whole Foods", "Amazon", "Shell", "Starbucks", "Costco"][i % 5],
  amount: ((i + 1) * 3.7).toFixed(2),
}));

export default function ScrollAreaPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Scroll area"
      source="components/ui/scroll-area.tsx"
      description="Custom-styled scrollable region with a thin scrollbar that fades in on hover."
    >
      <Section title="Vertical" contentClassName="p-0">
        <ScrollArea className="h-64">
          <ul className="divide-y">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between px-4 py-2 text-sm hover:bg-accent/30"
              >
                <span>{r.payee}</span>
                <span className="text-muted-foreground tabular-nums">${r.amount}</span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Section>

      <Section title="Horizontal">
        <ScrollArea className="w-full">
          <div className="flex w-[1400px] gap-3 py-2">
            {Array.from({ length: 20 }, (_, i) => (
              <div
                key={i}
                className="flex h-24 w-40 shrink-0 items-center justify-center rounded-lg border border-border bg-accent/20 text-sm"
              >
                Card {i + 1}
              </div>
            ))}
          </div>
        </ScrollArea>
      </Section>
    </PlaygroundShell>
  );
}
