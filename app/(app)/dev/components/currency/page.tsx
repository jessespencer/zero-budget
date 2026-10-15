import { Currency } from "@/components/shared/currency";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const amounts = [12847.5, 0, -84.21, 1234567.89, 0.5, -1] as const;

export default function CurrencyPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Currency"
      source="components/shared/currency.tsx"
      description="Tabular-number currency. Sign drives color (positive · negative · muted-zero). Cents render as small superscript by default."
    >
      <Section title="With colorize + smallCents" hint="defaults">
        <div className="flex flex-col gap-2 text-2xl">
          {amounts.map((amount) => (
            <div key={amount}>
              <Currency amount={amount} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="No colorize" hint="colorize=false">
        <div className="flex flex-col gap-2 text-2xl">
          {amounts.map((amount) => (
            <div key={amount}>
              <Currency amount={amount} colorize={false} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Full-size cents" hint="smallCents=false">
        <div className="flex flex-col gap-2 text-2xl">
          {amounts.map((amount) => (
            <div key={amount}>
              <Currency amount={amount} smallCents={false} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Smaller scale">
        <div className="flex flex-col gap-1 text-sm">
          {amounts.map((amount) => (
            <div key={amount}>
              <Currency amount={amount} />
            </div>
          ))}
        </div>
      </Section>
    </PlaygroundShell>
  );
}
