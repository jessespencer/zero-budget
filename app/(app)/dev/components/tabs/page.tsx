"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function TabsPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Tabs"
      source="components/ui/tabs.tsx"
      description="Default (pill-bg) or line (underline) variants. Horizontal or vertical orientation."
    >
      <Section title="Default variant">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="net-worth">Net worth</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="rounded-lg border bg-card p-4">
            Overview panel content.
          </TabsContent>
          <TabsContent value="trends" className="rounded-lg border bg-card p-4">
            Trends panel content.
          </TabsContent>
          <TabsContent value="net-worth" className="rounded-lg border bg-card p-4">
            Net worth panel content.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Line variant" hint="variant='line'">
        <Tabs defaultValue="all">
          <TabsList variant="line">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="cleared">Cleared</TabsTrigger>
            <TabsTrigger value="uncleared">Uncleared</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="rounded-lg border bg-card p-4">
            All transactions.
          </TabsContent>
          <TabsContent value="cleared" className="rounded-lg border bg-card p-4">
            Cleared transactions.
          </TabsContent>
          <TabsContent value="uncleared" className="rounded-lg border bg-card p-4">
            Uncleared transactions.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Vertical" hint="orientation='vertical'">
        <Tabs defaultValue="profile" orientation="vertical" className="flex-row">
          <TabsList className="w-40">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="rounded-lg border bg-card p-4">
            Profile settings.
          </TabsContent>
          <TabsContent value="security" className="rounded-lg border bg-card p-4">
            Security settings.
          </TabsContent>
          <TabsContent value="notifications" className="rounded-lg border bg-card p-4">
            Notification preferences.
          </TabsContent>
        </Tabs>
      </Section>
    </PlaygroundShell>
  );
}
