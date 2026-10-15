import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type PlaygroundShellProps = {
  title: string;
  source: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: "default" | "wide";
};

export function PlaygroundShell({
  title,
  source,
  description,
  children,
  maxWidth = "default",
}: PlaygroundShellProps) {
  return (
    <div className={cn("mx-auto p-6", maxWidth === "wide" ? "max-w-6xl" : "max-w-3xl")}>
      <Link
        href="/dev/components"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to components
      </Link>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        <span className="font-mono text-[11px] text-muted-foreground">{source}</span>
      </div>
      {description && (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </div>
  );
}

type SectionProps = {
  title: string;
  hint?: string;
  children: React.ReactNode;
  contentClassName?: string;
};

export function Section({ title, hint, children, contentClassName }: SectionProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-accent/40 px-4 py-2">
        <div className="text-sm font-medium">{title}</div>
        {hint && (
          <span className="font-mono text-[11px] text-muted-foreground">{hint}</span>
        )}
      </header>
      <div className={cn("p-6", contentClassName)}>{children}</div>
    </section>
  );
}
