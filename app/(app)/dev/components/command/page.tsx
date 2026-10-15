"use client";

import { useState } from "react";
import {
  CalendarDays,
  CreditCard,
  Plus,
  Search,
  Settings,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function CommandPlaygroundPage() {
  const [open, setOpen] = useState(false);
  return (
    <PlaygroundShell
      title="Command"
      source="components/ui/command.tsx"
      description="Command palette (cmdk). Inline panel or dialog. Type to fuzzy-filter; arrows + Enter to select."
    >
      <Section title="Inline panel">
        <div className="max-w-md rounded-2xl border border-border">
          <Command>
            <CommandInput placeholder="Search…" />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup heading="Suggestions">
                <CommandItem>
                  <CalendarDays /> Calendar
                </CommandItem>
                <CommandItem>
                  <Wallet /> Budget
                  <CommandShortcut>⌘B</CommandShortcut>
                </CommandItem>
                <CommandItem>
                  <CreditCard /> Transactions
                  <CommandShortcut>⌘T</CommandShortcut>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Actions">
                <CommandItem>
                  <Plus /> Add transaction
                </CommandItem>
                <CommandItem>
                  <Settings /> Open settings
                  <CommandShortcut>⌘,</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </Section>

      <Section title="Dialog (⌘K style)">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setOpen(true)}>
            <Search data-icon="inline-start" />
            Open palette
          </Button>
          <span className="text-xs text-muted-foreground">
            Common pattern: bind to ⌘K in the layout.
          </span>
        </div>
        <CommandDialog open={open} onOpenChange={setOpen}>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Navigate">
              <CommandItem onSelect={() => setOpen(false)}>
                <Wallet /> Budget
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <CreditCard /> Transactions
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Settings /> Settings
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </Section>
    </PlaygroundShell>
  );
}
