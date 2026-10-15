"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error";

const toasts: Array<{
  label: string;
  message: string;
  variant?: ToastVariant;
  withUndo?: boolean;
  duration?: number;
}> = [
  // Default (informational) — current call sites
  { label: "Transaction deleted", message: "Transaction deleted", withUndo: true },
  {
    label: "Mark as buffer",
    message: "Marked as buffer — excluded from savings transfers",
  },
  { label: "Unmark buffer", message: "No longer a buffer category" },
  { label: "Pin to quick-add", message: "Pinned to mobile quick-add" },
  { label: "Unpin from quick-add", message: "Unpinned from mobile quick-add" },
  { label: "Move 1 category", message: `Moved 1 category to Chase Checking`, withUndo: true },
  { label: "Move 3 categories", message: `Moved 3 categories to Chase Checking`, withUndo: true },
  { label: "Delete 1 category", message: `Deleted 1 category`, withUndo: true },
  {
    label: "Delete 4 categories + group",
    message: `Deleted 4 categories and "Subscriptions" group`,
    withUndo: true,
  },
  // Success / error — used by quick-add
  { label: "Saved", message: "Saved", variant: "success", duration: 2500 },
  {
    label: "Invalid amount",
    message: "Enter a valid amount",
    variant: "error",
    duration: 2500,
  },
  {
    label: "Missing fields",
    message: "Pick an account and category",
    variant: "error",
    duration: 2500,
  },
  {
    label: "Save failed",
    message: "Could not save — try again",
    variant: "error",
    duration: 2500,
  },
];

const variantPill: Record<ToastVariant, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-[var(--color-positive)]/15 text-[var(--color-positive)]",
  error: "bg-[var(--color-negative)]/15 text-[var(--color-negative)]",
};

export default function ToastPlaygroundPage() {
  const { toast } = useToast();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link
        href="/dev"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to dev
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Toast playground</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Trigger each toast to review layout and copy. All toasts share the same
        position and sizing — success and error variants add a small leading icon.
      </p>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {toasts.map((t) => {
          const variant: ToastVariant = t.variant ?? "default";
          return (
            <button
              key={t.label}
              type="button"
              onClick={() =>
                toast({
                  message: t.message,
                  variant: t.variant,
                  duration: t.duration,
                  action: t.withUndo
                    ? { label: "Undo", onClick: () => {} }
                    : undefined,
                })
              }
              className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm hover:bg-accent/30"
            >
              <div className="flex items-center gap-2 font-medium">
                <span>{t.label}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                    variantPill[variant]
                  )}
                >
                  {variant}
                </span>
                {t.withUndo && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    undo
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{t.message}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
