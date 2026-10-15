"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const sides = ["top", "right", "bottom", "left"] as const;

export default function PopoverPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Popover"
      source="components/ui/popover.tsx"
      description="Anchored, dismissable popover. Use for non-modal pickers and inline forms."
    >
      <Section title="Default">
        <Popover>
          <PopoverTrigger render={<Button variant="outline">Open popover</Button>} />
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Heads up</PopoverTitle>
              <PopoverDescription>
                Popovers are non-modal — click outside to dismiss.
              </PopoverDescription>
            </PopoverHeader>
            <div className="text-sm">Arbitrary content lives in the body.</div>
          </PopoverContent>
        </Popover>
      </Section>

      <Section title="All four sides" hint="side prop">
        <div className="flex flex-wrap items-center gap-3">
          {sides.map((side) => (
            <Popover key={side}>
              <PopoverTrigger
                render={<Button variant="outline">side={side}</Button>}
              />
              <PopoverContent side={side}>
                <div className="text-sm">Anchored to {side}.</div>
              </PopoverContent>
            </Popover>
          ))}
        </div>
      </Section>
    </PlaygroundShell>
  );
}
