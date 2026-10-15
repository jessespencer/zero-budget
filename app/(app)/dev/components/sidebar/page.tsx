import Link from "next/link";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function SidebarPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Sidebar"
      source="components/shared/sidebar.tsx"
      description="The app shell's collapsible sidebar (260px ↔ 60px). It owns navigation, theme, and dev links, so previewing it in isolation isn't meaningful — see it on any app page."
    >
      <Section title="Where to see it">
        <ul className="list-disc pl-5 text-sm">
          <li>
            <Link href="/budget" className="underline hover:text-foreground">
              /budget
            </Link>{" "}
            — primary landing
          </li>
          <li>
            <Link href="/transactions" className="underline hover:text-foreground">
              /transactions
            </Link>{" "}
            — wide table
          </li>
          <li>
            <Link href="/insights" className="underline hover:text-foreground">
              /insights
            </Link>{" "}
            — net worth + spending
          </li>
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          The sidebar is mounted by the app group layout. Toggle the collapse icon
          to see the 260 ↔ 60 transition and the icon-only state.
        </p>
      </Section>
    </PlaygroundShell>
  );
}
