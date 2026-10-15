"use client";

import {
  STAT_EYEBROW_CLASS,
  STAT_VALUE_CLASS,
  StatCell,
  StatLedger,
  StatStrip,
  statHeroClass,
} from "@/components/shared/stat-strip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RemainingBreakdown } from "./remaining-breakdown";
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Wallet,
  PiggyBank,
  ArrowLeftRight,
  CreditCard,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { computeTransferPlan } from "@/lib/transfer-engine";
import type { TransferPlanResult } from "@/lib/transfer-engine";
import type { BudgetMonth, Account } from "@/lib/types";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { cn } from "@/lib/utils";
import { roundCents } from "@/lib/db-utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useUndoRedo } from "@/lib/use-undo-redo";
import { saveTransferPlanActual } from "@/app/(app)/transfer-plan/actions";
import { TransferDialog } from "@/components/transactions/transfer-dialog";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type TransferPlanClientProps = {
  budgetMonth: BudgetMonth;
  accounts: Account[];
  savedActuals: Record<string, number>;
  month: string;
};

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function Section({
  title,
  icon: Icon,
  children,
  subtotal,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  subtotal?: number;
}) {
  const fmt = useMaskedCurrency();
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 h-20 bg-accent/40 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <div
            aria-hidden="true"
            className="shrink-0 h-12 w-12 rounded-full bg-background flex items-center justify-center text-foreground/70"
          >
            <Icon className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <h3 className="text-lg font-extrabold text-foreground truncate">
            {title}
          </h3>
        </div>
        {subtotal !== undefined && (
          <span className="text-lg tabular-nums font-extrabold shrink-0 zero-amount">
            {fmt(subtotal)}
          </span>
        )}
      </header>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

function DataRow({
  label,
  amount,
  className,
  action,
}: {
  label: string;
  amount: number;
  className?: string;
  action?: { label: string; onClick: () => void };
}) {
  const fmt = useMaskedCurrency();
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3.5">
      <span className="text-[15px] font-medium text-foreground truncate">
        {label}
      </span>
      <div className="flex items-center gap-3 shrink-0">
        {action ? (
          <Button
            type="button"
            variant="default"
            size="xs"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ) : null}
        <span
          className={cn(
            "text-[15px] tabular-nums font-medium zero-amount",
            className
          )}
        >
          {fmt(amount)}
        </span>
      </div>
    </li>
  );
}

function BalanceInput({
  value,
  accountName,
  isCreditCard,
  onUpdate,
}: {
  value: number;
  accountName: string;
  isCreditCard?: boolean;
  onUpdate: (next: number) => void;
}) {
  const fmt = useMaskedCurrency();
  const { hidden } = useAmountsHidden();
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(String(roundCents(value)));
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    // Privacy lock: don't enter edit mode while amounts are
    // hidden — clicking must not reveal the real balance.
    if (hidden) return;
    setLocalValue(String(roundCents(value)));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const handleSave = () => {
    setEditing(false);
    // If privacy mode was toggled on mid-edit, the input unmounts and fires a
    // synchronous blur — bail so we don't commit a partial in-flight string.
    if (hidden) return;
    let parsed = roundCents(parseFloat(localValue) || 0);
    if (isCreditCard && parsed > 0) parsed = -parsed;
    onUpdate(parsed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditing(false);
      setLocalValue(String(roundCents(value)));
    }
  };

  const fieldClasses =
    "w-28 h-8 px-2.5 rounded-lg border border-input bg-muted text-right text-[15px] font-medium tabular-nums text-foreground";

  if (editing && !hidden) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="0.01"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={cn(
          fieldClasses,
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        )}
        autoFocus
        aria-label={`Actual balance for ${accountName}`}
      />
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={hidden}
      className={cn(
        fieldClasses,
        "transition-colors hover:bg-muted/70 zero-amount",
        hidden && "cursor-not-allowed opacity-70"
      )}
    >
      {fmt(value)}
    </button>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <li className="px-4 py-3.5 text-sm text-muted-foreground">
      {message}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TransferPlanClient({
  budgetMonth,
  accounts,
  savedActuals,
  month,
}: TransferPlanClientProps) {
  const fmt = useMaskedCurrency();
  const [actualBalances, setActualBalances] = useState<Map<string, number>>(
    () =>
      new Map(
        accounts.map((a) => [
          a.id,
          savedActuals[a.id] ?? a.current_balance,
        ])
      )
  );

  // The last value the server actually confirmed for each account, seeded from
  // what the page was rendered with. A rollback restores from here rather than
  // from the render-time closure: if two edits to one account are in flight,
  // the older call's closure holds the newer call's optimistic value, and
  // restoring that would resurrect a number nothing ever persisted.
  const confirmedBalances = useRef<Map<string, number>>(
    new Map(
      accounts.map((a) => [a.id, savedActuals[a.id] ?? a.current_balance])
    )
  );

  // Per-account save counter. Only the newest in-flight save for an account is
  // allowed to roll back; an older one that rejects later has been superseded
  // and must not touch the map. Without this, a slow failing save stomps a
  // newer successful one, and nothing on this page corrects it: the revalidate
  // in saveTransferPlanActual refreshes `savedActuals`, but this map is a
  // useState initializer that only re-reads props on remount.
  const saveGeneration = useRef<Map<string, number>>(new Map());

  const noPrimary = !accounts.some((a) => a.is_primary);
  const { toast } = useToast();

  const result = useMemo<TransferPlanResult | null>(() => {
    if (noPrimary) return null;
    return computeTransferPlan({ budgetMonth, accounts, actualBalances });
  }, [budgetMonth, accounts, actualBalances, noPrimary]);

  const allocatedByAccount = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of budgetMonth.groups) {
      for (const cat of group.categories) {
        if (!cat.allocation_account_id) continue;
        const prev = map.get(cat.allocation_account_id) ?? 0;
        map.set(cat.allocation_account_id, prev + cat.available);
      }
    }
    return map;
  }, [budgetMonth]);

  const updateBalance = async (accountId: string, value: number) => {
    const generation = (saveGeneration.current.get(accountId) ?? 0) + 1;
    saveGeneration.current.set(accountId, generation);

    setActualBalances((prev) => {
      const next = new Map(prev);
      next.set(accountId, value);
      return next;
    });

    try {
      // Was a floating promise. The whole plan -- transfers, card payments,
      // remaining -- recomputes from this number, so a save that threw left
      // the user reading a plan the database had rejected, and the figures
      // only snapped back on the next load with no explanation.
      await saveTransferPlanActual(month, accountId, value);
      confirmedBalances.current.set(accountId, value);
    } catch {
      // Superseded by a later edit to the same account: that one owns the
      // displayed value now, and if it succeeded the number on screen is
      // right. Rolling back here would replace a correctly persisted value
      // with a stale one.
      if (saveGeneration.current.get(accountId) !== generation) return;

      // Roll back to what the server last confirmed -- not to the value this
      // closure saw, which may itself be an unpersisted optimistic write.
      // `undefined` is meaningful: no confirmed actual means the row falls
      // back to account.current_balance, so restore by deleting the key
      // rather than writing a zero.
      const confirmed = confirmedBalances.current.get(accountId);
      setActualBalances((prev) => {
        const next = new Map(prev);
        if (confirmed === undefined) next.delete(accountId);
        else next.set(accountId, confirmed);
        return next;
      });
      toast({
        message: "Could not save the actual balance",
        variant: "error",
        duration: 2500,
      });
    }
  };

  const budgetAccounts = accounts
    .filter((a) => a.is_budget_account && !a.archived)
    .sort((a, b) => a.sort_order - b.sort_order);

  const transferAccountOptions = useMemo(
    () => accounts.map((a) => ({ id: a.id, name: a.name })),
    [accounts]
  );

  // Per-row "Record" action wiring -------------------------------------------
  const undoRedo = useUndoRedo();
  const primaryAccount = accounts.find((a) => a.is_primary) ?? null;

  type RecordTarget = {
    fromAccount: { id: string; name: string };
    toAccount: { id: string; name: string };
    amount: number;
    kind: "payment" | "transfer";
  };
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null);

  const openRecordDialog = (target: RecordTarget) => setRecordTarget(target);

  // The undo entry and the toast moved into TransferDialog, which pushes to
  // this same module-singleton stack — so Cmd+Z here is unchanged, and the
  // reasoning that earned the toast still holds on this page in particular:
  // two real transactions are written and two balances move, but nothing here
  // does. The plan derives from the typed actualBalances map, which a transfer
  // doesn't touch, and the transfer actions revalidate `"/"` only — a bare
  // redirect to /budget with no payload of its own, so no page data is
  // invalidated and /transfer-plan least of all. Without the toast the row
  // looks untouched and Record can be clicked again straight into a
  // double-post. `noun` is what keeps the copy saying "Payment recorded" on
  // the credit-card rows.

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        e.preventDefault();
        if (e.shiftKey) undoRedo.redo();
        else undoRedo.undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undoRedo]);

  const noPrimaryMessage =
    "Set a primary account to see transfer plan";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between pl-6 pr-6 h-[88px] border-b border-border bg-accent/40">
        <h1 className="page-title">
          Transfer plan
        </h1>

        {result ? (
          // Same stat strip as the budget header: the headline (Remaining)
          // as the hero, then a ledger of the figures it's computed from —
          // Remaining = Checking − Required (outflows + buffers).
          <StatStrip aria-live="polite">
            {/* Headline cell opens the line-item breakdown, like Ready to
                assign on the budget page. */}
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className={statHeroClass(true)}
                  >
                    <span className={STAT_EYEBROW_CLASS}>Remaining</span>
                    <span
                      aria-label={`Remaining: ${fmt(result.summary.remaining)}`}
                      className={cn(
                        STAT_VALUE_CLASS,
                        result.summary.remaining >= 0 ? "text-positive" : "text-negative-strong"
                      )}
                    >
                      {fmt(result.summary.remaining)}
                    </span>
                  </button>
                }
              />
              <PopoverContent align="end" side="bottom" sideOffset={8} className="w-[28rem]">
                <RemainingBreakdown
                  result={result}
                  primaryAccountName={primaryAccount?.name ?? "Checking"}
                />
              </PopoverContent>
            </Popover>
            <StatLedger>
              <StatCell
                label="Checking"
                hint={`The actual balance you entered for ${primaryAccount?.name ?? "your primary account"}.`}
              >
                {fmt(result.summary.checkingActual)}
              </StatCell>
              <StatCell
                label="Outflows"
                hint="Transfers to savings plus credit card payments due this month."
              >
                {fmt(result.summary.totalOutflows)}
              </StatCell>
              <StatCell
                label="Required"
                hint="Outflows plus buffers: what checking needs to cover this month."
              >
                {fmt(result.summary.requiredInChecking)}
              </StatCell>
            </StatLedger>
          </StatStrip>
        ) : (
          <div className="text-sm text-warning">
            No primary account set. Mark one account as primary in account
            settings.
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto py-6 flex flex-col gap-6">
          {/* Section 1: Account balances */}
          <Section title="Account balances" icon={Wallet}>
            {/* Column headers */}
            <li className="flex items-center justify-between gap-3 px-4 py-2 bg-background/50">
              <span className="text-xs" />
              <div className="flex items-center gap-6 shrink-0">
                <span className="text-xs text-muted-foreground w-28 text-right">
                  Allocated
                </span>
                <span className="text-xs text-muted-foreground w-28 text-right">
                  Zero balance
                </span>
                <span className="text-xs text-muted-foreground w-28 text-right">
                  Actual balance
                </span>
              </div>
            </li>

            {budgetAccounts.map((account) => {
              const allocated = allocatedByAccount.get(account.id) ?? 0;
              return (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <span className="text-[15px] font-medium text-foreground truncate">
                    {account.name}
                  </span>
                  <div className="flex items-center gap-6 shrink-0">
                    <span className="w-28 text-right text-[15px] tabular-nums text-muted-foreground zero-amount">
                      {fmt(allocated)}
                    </span>
                    <span className="w-28 text-right text-[15px] tabular-nums text-muted-foreground zero-amount">
                      {fmt(account.current_balance)}
                    </span>
                    <BalanceInput
                      value={
                        actualBalances.get(account.id) ??
                        account.current_balance
                      }
                      accountName={account.name}
                      isCreditCard={account.type === "credit_card"}
                      onUpdate={(v) => updateBalance(account.id, v)}
                    />
                  </div>
                </li>
              );
            })}
          </Section>

          {/* Section 2: Buffers */}
          <Section
            title="Buffers"
            icon={PiggyBank}
            subtotal={
              result
                ? result.buffers.reduce((s, b) => s + b.available, 0)
                : undefined
            }
          >
            {result ? (
              result.buffers.length === 0 ? (
                <EmptyRow message="No categories marked as buffers" />
              ) : (
                result.buffers.map((b) => (
                  <DataRow
                    key={b.categoryId}
                    label={b.categoryName}
                    amount={b.available}
                  />
                ))
              )
            ) : (
              <EmptyRow message={noPrimaryMessage} />
            )}
          </Section>

          {/* Section 3: Transfers */}
          <Section
            title="Transfers"
            icon={ArrowLeftRight}
            subtotal={
              result
                ? result.savingsTransfers.reduce(
                    (s, t) => s + t.transferAmount,
                    0
                  )
                : undefined
            }
          >
            {result ? (
              result.savingsTransfers.length === 0 ? (
                <EmptyRow message="No categories assigned to savings accounts yet" />
              ) : (
                result.savingsTransfers.map((t) => (
                  <DataRow
                    key={t.accountId}
                    label={t.accountName}
                    amount={t.transferAmount}
                    className={t.transferAmount > 0 ? "text-info" : undefined}
                    action={
                      primaryAccount && t.transferAmount > 0
                        ? {
                            label: "Record",
                            onClick: () =>
                              openRecordDialog({
                                fromAccount: { id: primaryAccount.id, name: primaryAccount.name },
                                toAccount: { id: t.accountId, name: t.accountName },
                                amount: t.transferAmount,
                                kind: "transfer",
                              }),
                          }
                        : undefined
                    }
                  />
                ))
              )
            ) : (
              <EmptyRow message={noPrimaryMessage} />
            )}
          </Section>

          {/* Section 4: Payments */}
          <Section
            title="Payments"
            icon={CreditCard}
            subtotal={
              result
                ? result.creditCardPayments.reduce(
                    (s, p) => s + p.paymentDue,
                    0
                  )
                : undefined
            }
          >
            {result ? (
              result.creditCardPayments.length === 0 ? (
                <EmptyRow message="No credit card accounts" />
              ) : (
                result.creditCardPayments.map((p) => (
                  <DataRow
                    key={p.accountId}
                    label={p.accountName}
                    amount={-p.paymentDue}
                    className={p.paymentDue > 0 ? "text-negative" : undefined}
                    action={
                      primaryAccount && p.paymentDue > 0
                        ? {
                            label: "Record",
                            onClick: () =>
                              openRecordDialog({
                                fromAccount: { id: primaryAccount.id, name: primaryAccount.name },
                                toAccount: { id: p.accountId, name: p.accountName },
                                amount: p.paymentDue,
                                kind: "payment",
                              }),
                          }
                        : undefined
                    }
                  />
                ))
              )
            ) : (
              <EmptyRow message={noPrimaryMessage} />
            )}
          </Section>

          {/* Record-transfer dialog */}
          {recordTarget ? (
            <TransferDialog
              open={recordTarget !== null}
              onOpenChange={(open) => {
                if (!open) setRecordTarget(null);
              }}
              accounts={transferAccountOptions}
              defaultFromAccountId={recordTarget.fromAccount.id}
              defaultToAccountId={recordTarget.toAccount.id}
              defaultAmount={recordTarget.amount}
              noun={recordTarget.kind === "payment" ? "Payment" : "Transfer"}
            />
          ) : null}

          {/* Section 5: Summary */}
          <Section title="Summary" icon={Receipt}>
            {result ? (
              <>
                <DataRow
                  label="Checking actual"
                  amount={result.summary.checkingActual}
                />
                <DataRow
                  label="Total outflows"
                  amount={result.summary.totalOutflows}
                />
                <DataRow
                  label="Buffers"
                  amount={result.buffers.reduce(
                    (s, b) => s + b.available,
                    0
                  )}
                />
                <DataRow
                  label="Required in checking"
                  amount={result.summary.requiredInChecking}
                />
              </>
            ) : (
              <EmptyRow message={noPrimaryMessage} />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
