"use client";

import { useState } from "react";
import { Plus, Filter, Download } from "lucide-react";
import { PageToolbar } from "@/components/shared/page-toolbar";
import { Button } from "@/components/ui/button";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function PageToolbarPlaygroundPage() {
  const [search, setSearch] = useState("");
  return (
    <PlaygroundShell
      title="Page toolbar"
      source="components/shared/page-toolbar.tsx"
      description="Sticky 40px toolbar. Left children are page actions; right content + optional debounced search."
      maxWidth="wide"
    >
      <Section title="Left actions only" contentClassName="p-0">
        <PageToolbar>
          <Button size="xs" variant="ghost">
            <Plus data-icon="inline-start" />
            Add transaction
          </Button>
          <Button size="xs" variant="ghost">
            <Filter data-icon="inline-start" />
            Filters
          </Button>
        </PageToolbar>
        <div className="p-4 text-sm text-muted-foreground">Page content sits below.</div>
      </Section>

      <Section title="With right content" contentClassName="p-0">
        <PageToolbar
          rightContent={
            <Button size="xs" variant="ghost">
              <Download data-icon="inline-start" />
              Export
            </Button>
          }
        >
          <Button size="xs" variant="ghost">
            <Plus data-icon="inline-start" />
            New
          </Button>
        </PageToolbar>
      </Section>

      <Section title="With debounced search" contentClassName="p-0">
        <PageToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search payees…"
        >
          <Button size="xs" variant="ghost">
            <Plus data-icon="inline-start" />
            New
          </Button>
        </PageToolbar>
        <div className="p-4 text-xs text-muted-foreground">search = {JSON.stringify(search)}</div>
      </Section>
    </PlaygroundShell>
  );
}
