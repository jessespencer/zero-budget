"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function ConfirmDialogPlaygroundPage() {
  const [destructiveOpen, setDestructiveOpen] = useState(false);
  const [nondestructiveOpen, setNondestructiveOpen] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <PlaygroundShell
      title="Confirm dialog"
      source="components/shared/confirm-dialog.tsx"
      description="Wraps Dialog with destructive-button conventions. Use it for delete/discard prompts."
    >
      <Section title="Destructive (default)">
        <div className="flex items-center gap-3">
          <Button variant="destructive" onClick={() => setDestructiveOpen(true)}>
            Delete account
          </Button>
          {lastAction && (
            <span className="text-xs text-muted-foreground">{lastAction}</span>
          )}
        </div>
        <ConfirmDialog
          open={destructiveOpen}
          onOpenChange={setDestructiveOpen}
          title="Delete Chase Checking?"
          description="This removes the account and all 247 transactions. This can't be undone."
          confirmLabel="Delete account"
          onConfirm={() => setLastAction("Deleted at " + new Date().toLocaleTimeString())}
        />
      </Section>

      <Section title="Non-destructive" hint="destructive=false">
        <Button onClick={() => setNondestructiveOpen(true)}>Discard draft</Button>
        <ConfirmDialog
          open={nondestructiveOpen}
          onOpenChange={setNondestructiveOpen}
          title="Discard your changes?"
          description="Your in-progress edits will be lost."
          confirmLabel="Discard"
          destructive={false}
          onConfirm={() => setLastAction("Discarded at " + new Date().toLocaleTimeString())}
        />
      </Section>
    </PlaygroundShell>
  );
}
