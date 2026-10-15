"use client";

import { useState } from "react";
import { PayeeCombobox } from "@/components/shared/payee-combobox";
import { FieldGroup } from "@/components/ui/field-group";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const payees = [
  { id: "1", name: "Whole Foods", default_category_id: "groceries" },
  { id: "2", name: "Amazon", default_category_id: "shopping" },
  { id: "3", name: "Shell", default_category_id: "gas" },
  { id: "4", name: "Starbucks", default_category_id: "dining" },
  { id: "5", name: "Netflix", default_category_id: "subscriptions" },
  { id: "6", name: "Costco", default_category_id: "groceries" },
];

export default function PayeeComboboxPlaygroundPage() {
  const [name, setName] = useState("");
  const [defaultCat, setDefaultCat] = useState<string | null>(null);

  return (
    <PlaygroundShell
      title="Payee combobox"
      source="components/shared/payee-combobox.tsx"
      description="Type-ahead payee picker. Free-text fallback. Returns (name, defaultCategoryId) so callers can auto-fill the category."
    >
      <Section title="Default">
        <div className="max-w-sm">
          <FieldGroup label="Payee">
            <PayeeCombobox
              value={name}
              payees={payees}
              onChange={(n, cat) => {
                setName(n);
                setDefaultCat(cat);
              }}
            />
          </FieldGroup>
          <div className="mt-2 text-xs text-muted-foreground">
            name = {JSON.stringify(name)} · defaultCategoryId = {JSON.stringify(defaultCat)}
          </div>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
