"use client";

import Link from "next/link";
import {
  ArrowLeftRight,
  CalendarClock,
  ChartLine,
  ChevronLeft,
  CircleCheck,
  Compass,
  FolderPlus,
  PiggyBank,
  Receipt,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";

type EmptyVariant = "inline" | "page";

type EmptyStateSample = {
  id: string;
  source: string;
  variant: EmptyVariant;
  icon: LucideIcon;
  headline?: string;
  message: string;
  primaryAction?: { label: string };
  secondaryAction?: { label: string };
};

const samples: EmptyStateSample[] = [
  {
    id: "budget",
    source: "Budget · no category groups",
    variant: "inline",
    icon: FolderPlus,
    message: "Create your first category group to start budgeting.",
    primaryAction: { label: "Add category group" },
  },
  {
    id: "budget-overspent-cleared",
    source: "Budget · overspent filter, all caught up",
    variant: "inline",
    icon: CircleCheck,
    message: "No overspent categories — you're all caught up.",
    primaryAction: { label: "Clear filter" },
  },
  {
    id: "budget-underfunded-cleared",
    source: "Budget · underfunded filter, all set",
    variant: "inline",
    icon: CircleCheck,
    message: "No underfunded categories — you're all set.",
    primaryAction: { label: "Clear filter" },
  },
  {
    id: "transactions",
    source: "Transactions · empty list",
    variant: "inline",
    icon: ArrowLeftRight,
    message: "Add your first transaction to get started.",
    primaryAction: { label: "Add transaction" },
  },
  {
    id: "transactions-filtered-empty",
    source: "Transactions · filter yields nothing",
    variant: "inline",
    icon: ArrowLeftRight,
    message: "No transactions match these filters.",
    primaryAction: { label: "Clear filters" },
  },
  {
    id: "transactions-uncategorized-done",
    source: "Transactions · uncategorized filter, all caught up",
    variant: "inline",
    icon: CircleCheck,
    message: "Nothing left to categorize — you're all caught up.",
    primaryAction: { label: "Clear filter" },
  },
  {
    id: "account-register",
    source: "Account register · no transactions",
    variant: "inline",
    icon: ArrowLeftRight,
    message: "Add your first transaction to get started.",
  },
  {
    id: "schedules",
    source: "Schedules · empty list",
    variant: "inline",
    icon: CalendarClock,
    message: "Set up your recurring bills and income to stay on track.",
    primaryAction: { label: "Add schedule" },
  },
  {
    id: "insights-networth",
    source: "Insights · no accounts (net worth tab)",
    variant: "inline",
    icon: ChartLine,
    message: "Add an account to start tracking your net worth.",
    primaryAction: { label: "Add account" },
  },
  {
    id: "insights-spending",
    source: "Insights · no transactions (spending tab)",
    variant: "inline",
    icon: ChartLine,
    message: "Your spending breakdown will appear once transactions come through.",
    primaryAction: { label: "Add transaction" },
  },
  {
    id: "expense-grid",
    source: "Reports · expense grid",
    variant: "inline",
    icon: Receipt,
    message: "Expenses will appear here once you start categorizing transactions.",
  },
  {
    id: "savings-tracker",
    source: "Reports · savings tracker",
    variant: "inline",
    icon: PiggyBank,
    message: "Tag categories as savings to track your progress here.",
  },
  {
    id: "not-found",
    source: "404 · app/not-found.tsx",
    variant: "page",
    icon: Compass,
    headline: "This page didn't make the budget.",
    message: "It doesn't exist, or it may have been moved.",
    primaryAction: { label: "Go home" },
  },
  {
    id: "error",
    source: "Error boundary · app/error.tsx",
    variant: "page",
    icon: TriangleAlert,
    headline: "We overspent our error budget.",
    message: "Something went wrong. You can try again, or reload the page if the problem persists.",
    primaryAction: { label: "Try again" },
  },
];

const variantPill: Record<EmptyVariant, string> = {
  inline: "bg-muted text-muted-foreground",
  page: "bg-[var(--color-info)]/15 text-[var(--color-info)]",
};

const noop = () => {};

export default function EmptyStatesPlaygroundPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link
        href="/dev"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to dev
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Empty states playground</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every empty state in the app, rendered with its real copy and icon.
        Inline variants appear within a page; page variants take over the screen (404,
        error boundary). Action buttons are visual only — clicks are no-ops.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {samples.map((sample) => (
          <section
            key={sample.id}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border bg-accent/40 px-4 py-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>{sample.source}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                    variantPill[sample.variant],
                  )}
                >
                  {sample.variant}
                </span>
              </div>
            </header>

            <div
              className={cn(
                "relative",
                sample.variant === "page" && "min-h-[480px] bg-background",
              )}
            >
              <EmptyState
                icon={sample.icon}
                headline={sample.headline}
                message={sample.message}
                variant={sample.variant}
                primaryAction={
                  sample.primaryAction
                    ? { label: sample.primaryAction.label, onClick: noop }
                    : undefined
                }
                secondaryAction={
                  sample.secondaryAction
                    ? { label: sample.secondaryAction.label, onClick: noop }
                    : undefined
                }
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
