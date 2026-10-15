"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Circle, CircleCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { AddAccountDialog } from "@/components/accounts/add-account-dialog";
import { requestAddCategoryGroup } from "./add-group-request";
import { setPrimaryAccount } from "@/app/(app)/accounts/[id]/actions";
import {
  addStarterCategories,
  dismissOnboarding,
  markOnboardingTransferPlanSeen,
} from "@/app/(app)/budget/actions";
import type { OnboardingState } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

type SetupChecklistProps = {
  state: OnboardingState;
  readyToAssign: number;
  totalIncome: number;
};

type Step = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action?: ReactNode;
};

// First-run setup (SEED-001). Steps tick themselves off from real data, in
// the order setup actually depends on: accounts bring in the money, the
// primary account anchors the transfer plan, categories give the money
// somewhere to go, and assigning it all is what the plan is built from.
export function SetupChecklist({ state, readyToAssign, totalIncome }: SetupChecklistProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [addAccountOpen, setAddAccountOpen] = useState(false);

  // Every action here changes something visible on this page (a step ticks,
  // the grid fills, the card goes away), so success needs no toast — only
  // failure does, or the button would just appear to do nothing.
  const run = (work: () => Promise<void>, failure: string) => {
    startTransition(async () => {
      try {
        await work();
      } catch {
        toast({ message: failure, variant: "error" });
      }
    });
  };

  const handleStarterSet = () =>
    run(async () => {
      const result = await addStarterCategories();
      if (result.ok === false) {
        toast({ message: "You already have categories — the starter set wasn't added.", variant: "error" });
      }
    }, "Could not add the starter categories.");

  const handleSetPrimary = (id: string) =>
    run(async () => {
      const result = await setPrimaryAccount(id);
      if (result.ok === false) {
        toast({ message: "Could not make that account primary.", variant: "error" });
      }
    }, "Could not make that account primary.");

  const handleOpenTransferPlan = () =>
    run(async () => {
      await markOnboardingTransferPlanSeen();
      router.push("/transfer-plan");
    }, "Could not open the transfer plan.");

  const handleDismiss = () => run(dismissOnboarding, "Could not hide the setup checklist.");

  const hasAccounts = state.accountCount > 0;
  const hasPrimary = state.primaryAccountName !== null;
  const allAssigned =
    state.hasCategories && totalIncome > 0 && Math.round(readyToAssign * 100) === 0;

  const steps: Step[] = [
    {
      id: "accounts",
      title: "Add the accounts you budget from",
      detail: hasAccounts
        ? `${state.accountCount} ${state.accountCount === 1 ? "account" : "accounts"} added. Starting balances become money to assign.`
        : "Checking, savings, cash, and credit cards. Starting balances become money to assign.",
      done: hasAccounts,
      action: (
        <Button size="sm" variant={hasAccounts ? "ghost" : "default"} onClick={() => setAddAccountOpen(true)}>
          Add account
        </Button>
      ),
    },
    {
      id: "primary",
      title: "Choose your primary account",
      detail: hasPrimary
        ? `${state.primaryAccountName} — the account bills and transfers run through.`
        : "The checking account bills and transfers run through. Your first checking account is picked automatically.",
      done: hasPrimary,
      action:
        !hasPrimary && state.primaryCandidates.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={isPending} />}>
              Choose account
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {state.primaryCandidates.map((account) => (
                <DropdownMenuItem key={account.id} onClick={() => handleSetPrimary(account.id)}>
                  {account.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined,
    },
    {
      id: "categories",
      title: "Create your categories",
      detail: state.hasCategories
        ? "Rename, add, or remove them anytime from the budget below."
        : state.hasGroups
          ? "Now add categories to your group with “Add budget item” under it."
          : "Start from a starter set you can edit, or add your own groups.",
      done: state.hasCategories,
      action: state.hasCategories ? undefined : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={isPending} onClick={handleStarterSet}>
            Use starter set
          </Button>
          <Button size="sm" variant="outline" onClick={requestAddCategoryGroup}>
            Add category group
          </Button>
        </div>
      ),
    },
    {
      id: "assign",
      title: "Assign all your money",
      detail: allAssigned
        ? "Ready to assign is at $0 — every dollar has a category."
        : "Type amounts in the Assigned column until Ready to assign reaches $0.",
      done: allAssigned,
    },
    {
      id: "transfer-plan",
      title: "See your transfer plan",
      detail: "Zero turns your budget into the moves to make between accounts.",
      done: state.transferPlanSeen,
      action: (
        <Button
          size="sm"
          variant={state.transferPlanSeen ? "ghost" : "outline"}
          disabled={isPending}
          onClick={handleOpenTransferPlan}
        >
          Open transfer plan
        </Button>
      ),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const complete = doneCount === steps.length;

  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="border-b border-border bg-card px-6 py-4"
    >
      <div className="flex items-center gap-3">
        <h2 id="setup-checklist-title" className="text-base font-extrabold tracking-tight">
          {complete ? "You're all set" : "Get Zero set up"}
        </h2>
        <span className="text-sm text-muted-foreground">
          {doneCount} of {steps.length}
        </span>
        <div className="ml-auto">
          {complete ? (
            <Button size="sm" disabled={isPending} onClick={handleDismiss}>
              Done
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={handleDismiss}>
              <X aria-hidden className="size-4" />
              Dismiss
            </Button>
          )}
        </div>
      </div>

      <ol className="mt-3 flex flex-col">
        {steps.map((step) => (
          <li key={step.id} className="flex min-h-12 items-start gap-3 py-1.5">
            {step.done ? (
              <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            ) : (
              <Circle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground/60" />
            )}
            {/* The action wraps under the text on narrow screens; the icon stays put. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
              <div className="min-w-[12rem] flex-1">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    step.done && "text-muted-foreground line-through decoration-muted-foreground/40"
                  )}
                >
                  <span className="sr-only">{step.done ? "Done: " : "To do: "}</span>
                  {step.title}
                </p>
                <p className="text-sm text-muted-foreground">{step.detail}</p>
              </div>
              {step.action && <div className="shrink-0">{step.action}</div>}
            </div>
          </li>
        ))}
      </ol>

      <AddAccountDialog open={addAccountOpen} onOpenChange={setAddAccountOpen} stayOnPage />
    </section>
  );
}
