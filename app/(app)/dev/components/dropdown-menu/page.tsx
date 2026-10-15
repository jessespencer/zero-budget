"use client";

import { useState } from "react";
import { MoreHorizontal, Settings, Trash2, Pencil, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function DropdownMenuPlaygroundPage() {
  const [showNotes, setShowNotes] = useState(true);
  const [showCleared, setShowCleared] = useState(false);
  const [sortBy, setSortBy] = useState("date");

  return (
    <PlaygroundShell
      title="Dropdown menu"
      source="components/ui/dropdown-menu.tsx"
      description="Right-click/kebab style menu. Items, labels, separators, checkbox items, radio groups, sub-menus, shortcuts."
    >
      <Section title="Kebab menu (typical)">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="More">
                <MoreHorizontal />
              </Button>
            }
          />
          <DropdownMenuContent align="start">
            <DropdownMenuItem>
              <Pencil />
              Edit
              <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Copy />
              Duplicate
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <Trash2 />
              Delete
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Labels + groups + checkbox items">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">View options</Button>} />
          <DropdownMenuContent>
            <DropdownMenuLabel>Display</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={showNotes} onCheckedChange={setShowNotes}>
              Show notes column
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showCleared}
              onCheckedChange={setShowCleared}
            >
              Show cleared
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortBy} onValueChange={setSortBy}>
              <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="amount">Amount</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="payee">Payee</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Sub-menu">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">Settings</Button>} />
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Settings />
                Preferences
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to account</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Chase Checking</DropdownMenuItem>
                  <DropdownMenuItem>Amex</DropdownMenuItem>
                  <DropdownMenuItem>Schwab Savings</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>
    </PlaygroundShell>
  );
}
