"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function SwitchPlaygroundPage() {
  const [checked, setChecked] = useState(true);
  return (
    <PlaygroundShell
      title="Switch"
      source="components/ui/switch.tsx"
      description="Boolean toggle. Use for instant-on settings (not deferred until Save)."
    >
      <Section title="States">
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={checked} onCheckedChange={setChecked} />
            Controlled — currently {checked ? "on" : "off"}
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch defaultChecked />
            Default checked
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch />
            Default unchecked
          </label>
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <Switch disabled />
            Disabled (off)
          </label>
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <Switch disabled defaultChecked />
            Disabled (on)
          </label>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
