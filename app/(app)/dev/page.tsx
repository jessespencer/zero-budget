import Link from "next/link";

type Playground = {
  href: string;
  title: string;
  description: string;
};

const playgrounds: Playground[] = [
  {
    href: "/dev/audit",
    title: "Audit",
    description:
      "One long scrolling page — every component actually used in prod, grouped so visual inconsistencies (heights, radii, hover bg) jump out.",
  },
  {
    href: "/dev/components",
    title: "Components",
    description:
      "Every UI primitive and shared component — with variants, sizes, states, and source paths.",
  },
  {
    href: "/dev/toasts",
    title: "Toasts",
    description:
      "Every toast variant — default, success, error — including the ones with an undo action.",
  },
  {
    href: "/dev/empty-states",
    title: "Empty states",
    description:
      "Every EmptyState in the app, rendered with its real copy, icon, and primary action.",
  },
  {
    href: "/dev/badge-colors",
    title: "Badge color explorations",
    description:
      "Side-by-side candidates for the positive / negative / warning / info palette, previewed in the budget-row context.",
  },
];

export default function DevIndexPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Dev playgrounds</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Internal pages for previewing UI primitives in isolation. Useful for design
        review, regression checks, and snapshotting visuals.
      </p>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {playgrounds.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="rounded-lg border border-border bg-card px-4 py-3 text-left hover:bg-accent/30"
          >
            <div className="text-sm font-medium">{p.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{p.description}</div>
            <div className="mt-2 font-mono text-[11px] text-muted-foreground/70">
              {p.href}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
