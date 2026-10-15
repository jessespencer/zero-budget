"use client";

import { useState } from "react";
import { CategoryCombobox } from "@/components/shared/category-combobox";
import { FieldGroup } from "@/components/ui/field-group";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const groupedCategories = [
  {
    id: "essentials",
    name: "Essentials",
    items: [
      { id: "rent", name: "Rent" },
      { id: "groceries", name: "Groceries" },
      { id: "utilities", name: "Utilities" },
      { id: "internet", name: "Internet" },
    ],
  },
  {
    id: "lifestyle",
    name: "Lifestyle",
    items: [
      { id: "dining", name: "Dining out" },
      { id: "travel", name: "Travel" },
      { id: "hobbies", name: "Hobbies" },
    ],
  },
  {
    id: "subs",
    name: "Subscriptions",
    items: [
      { id: "netflix", name: "Netflix" },
      { id: "spotify", name: "Spotify" },
    ],
  },
];

const incomeCategories = [
  { id: "paycheck", name: "Paycheck" },
  { id: "interest", name: "Interest" },
];

export default function CategoryComboboxPlaygroundPage() {
  const [a, setA] = useState("");
  const [b, setB] = useState("groceries");
  const [c, setC] = useState("");
  const [splitCount, setSplitCount] = useState(0);

  return (
    <PlaygroundShell
      title="Category combobox"
      source="components/shared/category-combobox.tsx"
      description="Type-ahead, grouped. Arrow keys navigate, Enter picks the top match. Optional income section and Split action."
    >
      <Section title="Empty" hint="placeholder visible">
        <div className="max-w-sm">
          <FieldGroup label="Category">
            <CategoryCombobox
              value={a}
              groupedCategories={groupedCategories}
              onChange={setA}
            />
          </FieldGroup>
          <div className="mt-2 text-xs text-muted-foreground">value = {JSON.stringify(a)}</div>
        </div>
      </Section>

      <Section title="Pre-selected">
        <div className="max-w-sm">
          <FieldGroup label="Category">
            <CategoryCombobox
              value={b}
              groupedCategories={groupedCategories}
              onChange={setB}
            />
          </FieldGroup>
          <div className="mt-2 text-xs text-muted-foreground">value = {JSON.stringify(b)}</div>
        </div>
      </Section>

      <Section title="With income section + Split">
        <div className="max-w-sm">
          <FieldGroup label="Category">
            <CategoryCombobox
              value={c}
              groupedCategories={groupedCategories}
              incomeCategories={incomeCategories}
              onChange={setC}
              onSplit={() => setSplitCount((n) => n + 1)}
            />
          </FieldGroup>
          <div className="mt-2 text-xs text-muted-foreground">
            value = {JSON.stringify(c)} · split clicks = {splitCount}
          </div>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
