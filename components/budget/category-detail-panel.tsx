"use client";

import { useState, useEffect, useTransition } from "react";
import { endOfMonth } from "date-fns";
import { format } from "date-fns";
import { X, Bookmark, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { availableCents } from "@/lib/db-utils";
import { formatShortDate, parseMonthKey } from "@/lib/format";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useToast } from "@/components/ui/toast";
import { getTransactions, getAccountsAndCategories, getPayees } from "@/app/(app)/transactions/actions";
import { updateCategoryNotesWithSnapshot, restoreCategoryNotes } from "@/app/(app)/budget/actions";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { Badge } from "@/components/ui/badge";
import type { PayeeOption } from "@/components/shared/payee-combobox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TargetSection } from "./target-section";
import { SummaryRow } from "./summary-row";
import { CollapsiblePanel } from "./collapsible-panel";
import { CategoryAutoAssignSection } from "./category-auto-assign-section";
import type { CategoryWithBudget, TransactionWithDetails } from "@/lib/types";
import { Kbd } from "@/components/ui/kbd";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";

type CategoryDetailPanelProps = {
  category: CategoryWithBudget;
  groupName: string;
  month: string;
  onClose: () => void;
  onMutate: (entry: MutationEntry) => MutationId;
  undoEntry: (id: MutationId) => void;
};

export function CategoryDetailPanel({
  category,
  groupName,
  month,
  onClose,
  onMutate,
  undoEntry,
}: CategoryDetailPanelProps) {
  const [transactions, setTransactions] = useState<TransactionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTxn, setEditingTxn] = useState<TransactionWithDetails | null>(null);
  const [dialogData, setDialogData] = useState<{
    accounts: { id: string; name: string; type: string; is_budget_account: boolean }[];
    categories: { id: string; name: string; category_group_id: string }[];
    categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
    payees: PayeeOption[];
  } | null>(null);

  const refreshTransactions = () => {
    const startDate = month;
    const endDate = format(endOfMonth(parseMonthKey(month)), "yyyy-MM-dd");
    getTransactions({ categoryId: category.id, startDate, endDate })
      .then(setTransactions)
      .catch(() => setError("Failed to refresh transactions"));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTransactions([]);
    setError(null);

    const startDate = month;
    const endDate = format(endOfMonth(parseMonthKey(month)), "yyyy-MM-dd");

    getTransactions({ categoryId: category.id, startDate, endDate })
      .then((data) => {
        if (!cancelled) {
          setTransactions(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load transactions");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [category.id, month]);

  const handleTxnClick = async (txn: TransactionWithDetails) => {
    try {
      if (!dialogData) {
        const [acData, payeeData] = await Promise.all([
          getAccountsAndCategories(),
          getPayees(),
        ]);
        setDialogData({
          accounts: acData.accounts,
          categories: acData.categories,
          categoryGroups: acData.categoryGroups,
          payees: payeeData,
        });
      }
      setEditingTxn(txn);
    } catch {
      setError("Failed to load transaction details");
    }
  };

  const [tab, setTab] = useState("goals");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [txnsOpen, setTxnsOpen] = useState(true);
  const fmt = useMaskedCurrency();

  // Notes — free-form text saved on blur. Local draft mirrors the server value;
  // re-sync from props whenever the category or its saved notes change (e.g.
  // switching categories, or an undo restoring prior text) but never while the
  // field is focused, so we don't clobber an in-progress edit.
  const [notes, setNotes] = useState(category.notes);
  const [notesFocused, setNotesFocused] = useState(false);
  const [, startTransition] = useTransition();
  const { toast } = useToast();
  useEffect(() => {
    if (!notesFocused) setNotes(category.notes);
  }, [category.id, category.notes, notesFocused]);

  const saveNotes = () => {
    setNotesFocused(false);
    const next = notes.trim();
    if (next === category.notes) return;
    const categoryId = category.id;
    const previousFallback = category.notes;
    startTransition(async () => {
      try {
        // The action returns the notes it actually replaced. Undo now restores
        // that, rather than whatever `category.notes` happened to hold when the
        // handler was created — which goes stale the moment anything else
        // edits this category.
        const { previous } = await updateCategoryNotesWithSnapshot(
          categoryId,
          next
        );
        // Pushed only once the write lands. It used to be pushed first and the
        // call fired with `void`, so a rejection left an undo entry for text
        // the database never received — and no one heard about it either way.
        onMutate({
          label: "edit notes",
          forward: async () => {
            await updateCategoryNotesWithSnapshot(categoryId, next);
          },
          backward: async () => {
            await restoreCategoryNotes(categoryId, previous);
          },
        });
      } catch {
        // The textarea keeps showing the typed text whether or not it saved,
        // so unlike an assign cell the UI here is not the feedback — it's the
        // lie. Put the saved text back so what's on screen is what's stored.
        setNotes(previousFallback);
        toast({
          message: "Couldn't save your notes. Your changes weren't saved.",
          variant: "error",
        });
      }
    });
  };

  return (
    // Keyed per category by the parent, so each swap remounts — the fade turns
    // a row-to-row click into a transition instead of a hard cut.
    <div className="flex flex-col h-full w-full bg-background overflow-hidden animate-in fade-in duration-150">
      {/* Header — mirrors BudgetOverviewPanel chrome: title row, no
          underline. Adds a group pill below the title and a close button
          (the category panel can be dismissed; the month panel can't). */}
      <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-2xl font-extrabold tracking-[-0.02em] text-foreground truncate">
            {category.name}
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onClose}
                    aria-label="Close panel"
                    className="shrink-0"
                  />
                }
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>
                Close panel <Kbd>Esc</Kbd>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Badge className="uppercase tracking-[0.06em] w-fit">
          {groupName}
        </Badge>
      </div>

      {/* This month — pinned above the tabs so the core Assigned/Activity/
          Available numbers stay visible no matter which tab is open. px-6 pb-5
          matches the panel's content margins; the active card's 1px ring has
          room inside the panel surface. */}
      <div className="shrink-0 px-6 pb-5">
        <CollapsiblePanel
          title="This month"
          icon={<Bookmark className="h-3.5 w-3.5 text-primary" fill="currentColor" />}
          open={summaryOpen}
          active
          onToggle={() => setSummaryOpen(!summaryOpen)}
        >
          <SummaryRow flash={month} label="Assigned" value={category.assigned} />
          <SummaryRow flash={month}
            label="Activity"
            value={category.activity}
            muted={category.activity === 0}
          />
          <div className="h-px bg-border/50" />
          <SummaryRow flash={month}
            label="Available"
            value={category.available}
            className={cn(
              // Colorize off the rounded value — a break-even category sits at
              // ~-1e-13 and would print a red "$0.00" (see availableCents).
              availableCents(category.available) > 0 && "text-positive",
              availableCents(category.available) < 0 && "text-negative"
            )}
          />
        </CollapsiblePanel>
      </div>

      {/* Tabs swap the deeper content below the pinned summary — the (tall)
          target card, the auto-assign helper, and the transaction list — so
          each is one tap away. gap-0 + min-h-0 let the active panel own the
          scroll region. */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as string)}
        className="flex-1 min-h-0 gap-0"
      >
        <div className="shrink-0 px-6 border-b border-border">
          <TabsList variant="line" className="gap-4">
            <TabsTrigger value="goals" className="flex-none px-0">
              Goals
            </TabsTrigger>
            <TabsTrigger value="transactions" className="flex-none px-0">
              Transactions
              {!loading && transactions.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {transactions.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="notes" className="flex-none px-0">
              Notes
              {category.notes.trim().length > 0 && (
                <span
                  className="ml-1.5 h-1.5 w-1.5 rounded-full bg-primary"
                  aria-hidden="true"
                />
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Goals — target and auto-assign stacked; each owns its own card
            chrome via CollapsiblePanel */}
        <TabsContent
          value="goals"
          className="flex-1 min-h-0 px-6 pt-6 pb-6 overflow-auto space-y-5"
        >
          <TargetSection
            category={category}
            month={month}
            onMutate={onMutate}
            undoEntry={undoEntry}
          />
          <CategoryAutoAssignSection
            category={category}
            month={month}
            onMutate={onMutate}
            undoEntry={undoEntry}
          />
        </TabsContent>

        {/* Transactions */}
        <TabsContent
          value="transactions"
          className="flex-1 min-h-0 px-6 pt-6 pb-6 overflow-auto"
        >
          <CollapsiblePanel
            title="Transactions"
            icon={<Coins className="h-3.5 w-3.5 text-primary" fill="currentColor" />}
            open={txnsOpen}
            onToggle={() => setTxnsOpen(!txnsOpen)}
          >
            {error ? (
              <p className="text-sm text-negative">{error}</p>
            ) : loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-10 bg-muted/30 rounded animate-pulse"
                  />
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No transactions this month
              </p>
            ) : (
              <div className="space-y-1 -mx-1">
                {transactions.map((txn) => (
                  <button
                    key={txn.id}
                    type="button"
                    onClick={() => handleTxnClick(txn)}
                    className="flex items-center justify-between py-2 px-2 text-sm w-full rounded-md hover:bg-accent/30 transition-colors cursor-pointer text-left"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-foreground truncate">
                        {txn.payee || "No payee"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatShortDate(txn.date)}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "tabular-nums zero-amount font-semibold shrink-0 ml-3",
                        txn.amount >= 0 ? "text-positive" : "text-foreground"
                      )}
                    >
                      {fmt(txn.amount)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CollapsiblePanel>
        </TabsContent>

        {/* Notes — free-form scratch space for this category. Saves on blur. */}
        <TabsContent
          value="notes"
          className="flex-1 min-h-0 px-6 pt-6 pb-6 overflow-auto"
        >
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onFocus={() => setNotesFocused(true)}
            onBlur={saveNotes}
            onKeyDown={(e) => {
              // Enter saves (blur triggers the save); Shift+Enter inserts a
              // line break — the classic single-line-commit textarea.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="Add a description, reminder, or anything worth remembering about this category…"
            className="min-h-40 resize-none"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Enter to save · Shift + Enter for a line break
          </p>
        </TabsContent>
      </Tabs>

      {dialogData && (
        <TransactionDialog
          open={!!editingTxn}
          onOpenChange={(open) => {
            if (!open) {
              setEditingTxn(null);
              refreshTransactions();
            }
          }}
          accounts={dialogData.accounts}
          categories={dialogData.categories}
          categoryGroups={dialogData.categoryGroups}
          payees={dialogData.payees}
          transaction={editingTxn}
          onMutated={refreshTransactions}
        />
      )}
    </div>
  );
}
