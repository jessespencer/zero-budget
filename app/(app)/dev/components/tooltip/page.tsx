"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const sides = ["top", "right", "bottom", "left"] as const;

export default function TooltipPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Tooltip"
      source="components/ui/tooltip.tsx"
      description="Hover/focus tooltip with arrow. Wrap with TooltipProvider; 500ms default delay."
    >
      <Section title="Default">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline">Hover me</Button>} />
            <TooltipContent>Tooltip body</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Section>

      <Section title="All four sides" hint="side prop">
        <TooltipProvider>
          <div className="flex flex-wrap items-center gap-3">
            {sides.map((side) => (
              <Tooltip key={side}>
                <TooltipTrigger
                  render={<Button variant="outline">side={side}</Button>}
                />
                <TooltipContent side={side}>side={side}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </Section>

      <Section title="On an icon button">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="What is this?">
                  <Info />
                </Button>
              }
            />
            <TooltipContent>Hover hints for icon-only buttons.</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Section>
    </PlaygroundShell>
  );
}
