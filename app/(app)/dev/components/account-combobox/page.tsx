"use client";

import { useState } from "react";
import { AccountCombobox } from "@/components/shared/account-combobox";
import { FieldGroup } from "@/components/ui/field-group";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const accounts = [
  { id: "chase", name: "Chase Checking" },
  { id: "amex", name: "Amex Gold" },
  { id: "schwab", name: "Schwab Savings" },
  { id: "vanguard", name: "Vanguard Brokerage" },
  { id: "venmo", name: "Venmo" },
  { id: "cash", name: "Cash" },
];

export default function AccountComboboxPlaygroundPage() {
  const [a, setA] = useState("");
  const [b, setB] = useState("chase");

  return (
    <PlaygroundShell
      title="Account combobox"
      source="components/shared/account-combobox.tsx"
      description="Type-ahead account picker. Sorted alphabetically. Arrow/Enter/Escape."
    >
      <Section title="Empty">
        <div className="max-w-sm">
          <FieldGroup label="Account">
            <AccountCombobox value={a} accounts={accounts} onChange={setA} />
          </FieldGroup>
          <div className="mt-2 text-xs text-muted-foreground">value = {JSON.stringify(a)}</div>
        </div>
      </Section>

      <Section title="Pre-selected">
        <div className="max-w-sm">
          <FieldGroup label="Account">
            <AccountCombobox value={b} accounts={accounts} onChange={setB} />
          </FieldGroup>
          <div className="mt-2 text-xs text-muted-foreground">value = {JSON.stringify(b)}</div>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
