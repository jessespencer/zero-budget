"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const accounts = [
  { id: "chase", name: "Chase Checking" },
  { id: "amex", name: "Amex Gold" },
  { id: "schwab", name: "Schwab Savings" },
  { id: "vanguard", name: "Vanguard Brokerage" },
];

export default function SelectPlaygroundPage() {
  const [value, setValue] = useState<string | null>("chase");

  return (
    <PlaygroundShell
      title="Select"
      source="components/ui/select.tsx"
      description="Native-feeling select with custom popup. Items, groups, labels, separators."
    >
      <Section title="Default">
        <Select value={value} onValueChange={(v) => setValue(v)}>
          <SelectTrigger className="min-w-[200px]">
            <SelectValue placeholder="Pick an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Section title="Small" hint="size=sm">
        <Select defaultValue="amex">
          <SelectTrigger size="sm" className="min-w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Section title="Grouped">
        <Select>
          <SelectTrigger className="min-w-[220px]">
            <SelectValue placeholder="Pick a category" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Essentials</SelectLabel>
              <SelectItem value="rent">Rent</SelectItem>
              <SelectItem value="groceries">Groceries</SelectItem>
              <SelectItem value="utilities">Utilities</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Lifestyle</SelectLabel>
              <SelectItem value="dining">Dining out</SelectItem>
              <SelectItem value="travel">Travel</SelectItem>
              <SelectItem value="hobbies">Hobbies</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Section>

      <Section title="Disabled">
        <Select disabled defaultValue="chase">
          <SelectTrigger className="min-w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>
    </PlaygroundShell>
  );
}
