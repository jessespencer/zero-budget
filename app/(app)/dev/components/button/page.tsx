"use client";

import { Plus, ArrowRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
const sizes = ["xs", "sm", "default", "lg"] as const;
const iconSizes = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;

export default function ButtonPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Button"
      source="components/ui/button.tsx"
      description="Six variants × seven sizes. Add inline-start/inline-end icons via data-icon. Active translates 1px to confirm press."
    >
      <Section title="Variants" hint="size=default">
        <div className="flex flex-wrap gap-3">
          {variants.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Sizes" hint="variant=default">
        <div className="flex flex-wrap items-end gap-3">
          {sizes.map((size) => (
            <Button key={size} size={size}>
              {size}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Icon sizes" hint="variant=outline">
        <div className="flex flex-wrap items-end gap-3">
          {iconSizes.map((size) => (
            <Button key={size} size={size} variant="outline" aria-label={size}>
              <Plus />
            </Button>
          ))}
        </div>
      </Section>

      <Section title="With icons" hint="data-icon=inline-start | inline-end">
        <div className="flex flex-wrap gap-3">
          <Button>
            <Plus data-icon="inline-start" />
            Add expense
          </Button>
          <Button variant="outline">
            Continue
            <ArrowRight data-icon="inline-end" />
          </Button>
          <Button variant="destructive">
            <Trash2 data-icon="inline-start" />
            Delete account
          </Button>
        </div>
      </Section>

      <Section title="States" hint="disabled · aria-invalid">
        <div className="flex flex-wrap gap-3">
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>
            Disabled outline
          </Button>
          <Button aria-invalid>Invalid</Button>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
