import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type ComponentEntry = {
  name: string;
  source: string;
  href: string;
  description: string;
  external?: boolean;
};

type Group = {
  title: string;
  blurb: string;
  items: ComponentEntry[];
};

const groups: Group[] = [
  {
    title: "UI primitives",
    blurb: "Low-level shadcn-style primitives. Use these when no shared wrapper exists.",
    items: [
      {
        name: "Badge",
        source: "components/ui/badge.tsx",
        href: "/dev/components/badge",
        description: "Pill label with six intent colors — neutral, positive, negative, warning, info, brand.",
      },
      {
        name: "Button",
        source: "components/ui/button.tsx",
        href: "/dev/components/button",
        description: "Six variants (default, outline, secondary, ghost, destructive, link) across seven sizes including icon.",
      },
      {
        name: "Card",
        source: "components/ui/card.tsx",
        href: "/dev/components/card",
        description: "Container with header, title, description, action, content, and footer slots. Two sizes.",
      },
      {
        name: "Collapsible",
        source: "components/ui/collapsible.tsx",
        href: "/dev/components/collapsible",
        description: "Animated expand/collapse panel — trigger + content.",
      },
      {
        name: "Command",
        source: "components/ui/command.tsx",
        href: "/dev/components/command",
        description: "Command palette (cmdk) with input, groups, items, shortcuts, separators.",
      },
      {
        name: "Dialog",
        source: "components/ui/dialog.tsx",
        href: "/dev/components/dialog",
        description: "Modal dialog with header, footer, close button. Trigger + portal + overlay.",
      },
      {
        name: "Dropdown menu",
        source: "components/ui/dropdown-menu.tsx",
        href: "/dev/components/dropdown-menu",
        description: "Right-click style menu with items, labels, separators, checkbox/radio items, sub-menus, shortcuts.",
      },
      {
        name: "Field group",
        source: "components/ui/field-group.tsx",
        href: "/dev/components/field-group",
        description: "Top-labeled form field. Supports optional suffix. Used in every dialog/form.",
      },
      {
        name: "Input",
        source: "components/ui/input.tsx",
        href: "/dev/components/input",
        description: "Standard text input. Disabled, invalid, file, types.",
      },
      {
        name: "Input group",
        source: "components/ui/input-group.tsx",
        href: "/dev/components/input-group",
        description: "Input wrapper for inline/block addons (icons, buttons, text). Textarea variant.",
      },
      {
        name: "Popover",
        source: "components/ui/popover.tsx",
        href: "/dev/components/popover",
        description: "Anchored popover with header, title, description.",
      },
      {
        name: "Progress",
        source: "components/ui/progress.tsx",
        href: "/dev/components/progress",
        description: "Track + indicator + label + value. Determinate.",
      },
      {
        name: "Scroll area",
        source: "components/ui/scroll-area.tsx",
        href: "/dev/components/scroll-area",
        description: "Custom-styled scrollable region with thin scrollbar.",
      },
      {
        name: "Select",
        source: "components/ui/select.tsx",
        href: "/dev/components/select",
        description: "Form select with groups, labels, separators, item indicators.",
      },
      {
        name: "Separator",
        source: "components/ui/separator.tsx",
        href: "/dev/components/separator",
        description: "Horizontal or vertical divider line.",
      },
      {
        name: "Sheet",
        source: "components/ui/sheet.tsx",
        href: "/dev/components/sheet",
        description: "Edge-anchored drawer — top, right, bottom, left.",
      },
      {
        name: "Switch",
        source: "components/ui/switch.tsx",
        href: "/dev/components/switch",
        description: "Boolean toggle. Checked, unchecked, disabled.",
      },
      {
        name: "Table",
        source: "components/ui/table.tsx",
        href: "/dev/components/table",
        description: "Table primitives — header, body, footer, row, head, cell, caption.",
      },
      {
        name: "Tabs",
        source: "components/ui/tabs.tsx",
        href: "/dev/components/tabs",
        description: "Default and line variants, horizontal or vertical orientation.",
      },
      {
        name: "Textarea",
        source: "components/ui/textarea.tsx",
        href: "/dev/components/textarea",
        description: "Multi-line text input. Auto-resizing.",
      },
      {
        name: "Toast",
        source: "components/ui/toast.tsx",
        href: "/dev/toasts",
        description: "Bottom-center toasts with optional undo action. Default, success, error variants.",
      },
      {
        name: "Tooltip",
        source: "components/ui/tooltip.tsx",
        href: "/dev/components/tooltip",
        description: "Hover/focus tooltip with arrow. Four sides.",
      },
    ],
  },
  {
    title: "Shared components",
    blurb: "App-level wrappers in components/shared/. Prefer these over re-rolling primitives.",
    items: [
      {
        name: "Account combobox",
        source: "components/shared/account-combobox.tsx",
        href: "/dev/components/account-combobox",
        description: "Type-ahead account picker with arrow-key nav.",
      },
      {
        name: "Category combobox",
        source: "components/shared/category-combobox.tsx",
        href: "/dev/components/category-combobox",
        description: "Grouped type-ahead category picker. Optional income section and Split action.",
      },
      {
        name: "Confirm dialog",
        source: "components/shared/confirm-dialog.tsx",
        href: "/dev/components/confirm-dialog",
        description: "Destructive-action confirmation wrapping the Dialog primitive.",
      },
      {
        name: "Currency",
        source: "components/shared/currency.tsx",
        href: "/dev/components/currency",
        description: "Tabular-number currency display. Colorized by sign, small-cents superscript.",
      },
      {
        name: "Date input",
        source: "components/shared/date-input.tsx",
        href: "/dev/components/date-input",
        description: "Native date input with calendar icon and design-token styling.",
      },
      {
        name: "Dev mode banner",
        source: "components/shared/dev-mode-banner.tsx",
        href: "/dev/components/dev-mode-banner",
        description: "Sticky amber banner shown when NEXT_PUBLIC_ZERO_DEV_MODE=1.",
      },
      {
        name: "Empty state",
        source: "components/shared/empty-state.tsx",
        href: "/dev/empty-states",
        description: "Illustration + headline + message + actions. Inline and page variants.",
      },
      {
        name: "Month selector",
        source: "components/shared/month-selector.tsx",
        href: "/dev/components/month-selector",
        description: "Big month/year label with prev/next chevrons and a Today button.",
      },
      {
        name: "Page toolbar",
        source: "components/shared/page-toolbar.tsx",
        href: "/dev/components/page-toolbar",
        description: "Sticky 40px toolbar with left actions, right content, optional search.",
      },
      {
        name: "Payee combobox",
        source: "components/shared/payee-combobox.tsx",
        href: "/dev/components/payee-combobox",
        description: "Type-ahead payee picker. Returns name + default category id.",
      },
      {
        name: "Sidebar",
        source: "components/shared/sidebar.tsx",
        href: "/dev/components/sidebar",
        description: "Collapsible app sidebar — 260px expanded, 60px collapsed. Best seen in the app shell.",
      },
      {
        name: "Theme toggle",
        source: "components/shared/theme-toggle.tsx",
        href: "/dev/components/theme-toggle",
        description: "Light / dark / system theme picker. Sidebar variant available.",
      },
      {
        name: "Uncategorized banner",
        source: "components/shared/uncategorized-banner.tsx",
        href: "/dev/components/uncategorized-banner",
        description: "Warning banner counting uncategorized transactions. Has a filter-active variant.",
      },
      {
        name: "Year selector",
        source: "components/shared/year-selector.tsx",
        href: "/dev/components/year-selector",
        description: "Big year label with prev/next chevrons and a This year button.",
      },
    ],
  },
];

export default function ComponentsIndexPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link
        href="/dev"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to dev
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Components</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every reusable component in the app — UI primitives and shared wrappers. Open
        a playground to see variants, states, and the source path.
      </p>

      <div className="mt-8 flex flex-col gap-10">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="text-base font-semibold tracking-tight">{group.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{group.blurb}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg border border-border bg-card px-4 py-3 text-left hover:bg-accent/30"
                >
                  <div className="text-sm font-medium">{item.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.description}
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-muted-foreground/70">
                    {item.source}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
