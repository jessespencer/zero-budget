"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldGroup } from "@/components/ui/field-group";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function DialogPlaygroundPage() {
  const [open, setOpen] = useState(false);
  return (
    <PlaygroundShell
      title="Dialog"
      source="components/ui/dialog.tsx"
      description="Modal with header (title + description), body, and footer. Backdrop dims with subtle blur. Esc and click-outside close."
    >
      <Section title="Default trigger">
        <Dialog>
          <DialogTrigger render={<Button>Open dialog</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit account</DialogTitle>
              <DialogDescription>
                Update the account name. Changes apply across all linked transactions.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <FieldGroup label="Name">
                <Input defaultValue="Chase Checking" />
              </FieldGroup>
              <FieldGroup label="Notes" optional>
                <Input placeholder="Internal note" />
              </FieldGroup>
            </div>
            <DialogFooter showCloseButton>
              <Button>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Controlled open state">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setOpen(true)}>
            Open programmatically
          </Button>
          <span className="text-xs text-muted-foreground">open = {String(open)}</span>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Heads up</DialogTitle>
              <DialogDescription>
                This dialog is controlled by component state, not the trigger.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="No close button" hint="showCloseButton={false}">
        <Dialog>
          <DialogTrigger render={<Button variant="outline">Open</Button>} />
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Bare dialog</DialogTitle>
              <DialogDescription>
                No close X. Footer carries the only dismiss action.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      </Section>
    </PlaygroundShell>
  );
}
