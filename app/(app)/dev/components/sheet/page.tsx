"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const sides = ["right", "left", "top", "bottom"] as const;

export default function SheetPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Sheet"
      source="components/ui/sheet.tsx"
      description="Edge-anchored drawer. Use for transient detail panels and mobile-style flows."
    >
      <Section title="All four sides" hint="side prop">
        <div className="flex flex-wrap gap-3">
          {sides.map((side) => (
            <Sheet key={side}>
              <SheetTrigger render={<Button variant="outline">side={side}</Button>} />
              <SheetContent side={side}>
                <SheetHeader>
                  <SheetTitle>Anchored {side}</SheetTitle>
                  <SheetDescription>
                    Click outside, press Esc, or tap the X to dismiss.
                  </SheetDescription>
                </SheetHeader>
                <div className="px-4 text-sm">Sheet body content.</div>
                <SheetFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button>Save</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          ))}
        </div>
      </Section>
    </PlaygroundShell>
  );
}
