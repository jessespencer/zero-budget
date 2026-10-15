import { ThemeToggle } from "@/components/shared/theme-toggle";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function ThemeTogglePlaygroundPage() {
  return (
    <PlaygroundShell
      title="Theme toggle"
      source="components/shared/theme-toggle.tsx"
      description="Sidebar-styled trigger that opens a dialog with Light · Dark · System options. collapsed=true hides the label."
    >
      <Section title="Expanded sidebar style" hint="collapsed=false">
        <div className="max-w-[260px] rounded-lg bg-sidebar p-3">
          <ThemeToggle collapsed={false} />
        </div>
      </Section>

      <Section title="Collapsed sidebar style" hint="collapsed=true">
        <div className="w-[60px] rounded-lg bg-sidebar p-3">
          <ThemeToggle collapsed />
        </div>
      </Section>
    </PlaygroundShell>
  );
}
