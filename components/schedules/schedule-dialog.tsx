"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CategoryCombobox } from "@/components/shared/category-combobox";
import { AccountCombobox } from "@/components/shared/account-combobox";
import {
  createSchedule,
  updateSchedule,
} from "@/app/(app)/schedules/actions";
import { DateInput } from "@/components/shared/date-input";
import { FieldGroup } from "@/components/ui/field-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { CircleHelp } from "lucide-react";
import type { ScheduledTransactionWithDetails, ScheduleFrequency } from "@/lib/types";
import { fieldClass } from "@/lib/utils";
import { parseMoneyInput, roundCents } from "@/lib/db-utils";
import { useAmountsHidden } from "@/components/shared/privacy-provider";

type ScheduleInitialValues = {
  accountId?: string;
  payee?: string;
  amount?: number;
  categoryId?: string;
  memo?: string;
};

type ScheduleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string; type: string; is_budget_account: boolean }[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  schedule?: ScheduledTransactionWithDetails | null;
  initialValues?: ScheduleInitialValues | null;
};

const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "once", label: "Once" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "" is the stored value for "don't shift", so it stays a real option rather
// than a placeholder — Select renders the label for it like any other.
const WEEKEND_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "before", label: "Move to Friday" },
  { value: "after", label: "Move to Monday" },
];

function deriveDayParts(isoDate: string): { dayOfMonth: string; dayOfWeek: string } | null {
  const parts = isoDate.split("-").map(Number);
  if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  return {
    dayOfMonth: String(d),
    dayOfWeek: String(new Date(Date.UTC(y, m - 1, d)).getUTCDay()),
  };
}


export function ScheduleDialog({
  open,
  onOpenChange,
  accounts,
  categories,
  categoryGroups,
  schedule,
  initialValues,
}: ScheduleDialogProps) {
  const isEdit = !!schedule;
  const [isPending, startTransition] = useTransition();
  const { hidden } = useAmountsHidden();

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [payee, setPayee] = useState("");
  const [isExpense, setIsExpense] = useState(true);
  const [amount, setAmount] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [memo, setMemo] = useState("");
  const [frequency, setFrequency] = useState<ScheduleFrequency>("monthly");
  const [interval, setInterval] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState("");
  const [skipWeekend, setSkipWeekend] = useState("");
  const [postsTransaction, setPostsTransaction] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && schedule) {
      const amt = Number(schedule.amount);
      setName(schedule.name || "");
      setAccountId(schedule.account_id);
      setPayee(schedule.payee || "");
      setIsExpense(amt < 0);
      setAmount(String(Math.abs(amt)));
      setCategoryId(schedule.category_id || "");
      setMemo(schedule.memo || "");
      setFrequency(schedule.frequency);
      setInterval(String(schedule.interval));
      const fallback = deriveDayParts(schedule.start_date);
      setDayOfMonth(
        schedule.day_of_month != null ? String(schedule.day_of_month) : fallback?.dayOfMonth ?? ""
      );
      setDayOfWeek(
        schedule.day_of_week != null ? String(schedule.day_of_week) : fallback?.dayOfWeek ?? ""
      );
      setStartDate(schedule.start_date);
      setEndDate(schedule.end_date || "");
      setSkipWeekend(schedule.skip_weekend || "");
      setPostsTransaction(schedule.posts_transaction);
      setError("");
    } else if (open && !schedule) {
      resetForm();
      if (initialValues) {
        if (initialValues.accountId) setAccountId(initialValues.accountId);
        if (initialValues.payee) setPayee(initialValues.payee);
        if (initialValues.categoryId) setCategoryId(initialValues.categoryId);
        if (initialValues.memo) setMemo(initialValues.memo);
        if (initialValues.amount != null) {
          setIsExpense(initialValues.amount < 0);
          setAmount(String(roundCents(Math.abs(initialValues.amount))));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule?.id]);

  const resetForm = () => {
    setName("");
    setAccountId(accounts[0]?.id || "");
    setPayee("");
    setIsExpense(true);
    setAmount("");
    setCategoryId("");
    setMemo("");
    setFrequency("monthly");
    setInterval("1");
    const today = todayStr();
    const todayParts = deriveDayParts(today);
    setDayOfMonth(todayParts?.dayOfMonth ?? "");
    setDayOfWeek(todayParts?.dayOfWeek ?? "");
    setStartDate(today);
    setEndDate("");
    setSkipWeekend("");
    setPostsTransaction(true);
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Privacy lock: amounts hidden, so the schedule isn't saved.
    if (hidden) return;
    const numAmount = parseMoneyInput(amount);
    if (!numAmount) {
      setError("Enter a valid amount.");
      return;
    }
    if (!accountId) {
      setError("Please select an account");
      return;
    }
    setError("");

    const signedAmount = isExpense ? -Math.abs(numAmount) : Math.abs(numAmount);

    startTransition(async () => {
      try {
        const data = {
          name: name || undefined,
          account_id: accountId,
          payee: payee || undefined,
          category_id: categoryId || undefined,
          amount: signedAmount,
          memo: memo || undefined,
          frequency,
          interval: parseInt(interval) || 1,
          start_date: startDate,
          end_date: endDate || undefined,
          day_of_month: showDayOfMonth && dayOfMonth ? parseInt(dayOfMonth) : undefined,
          day_of_week: showDayOfWeek && dayOfWeek ? parseInt(dayOfWeek) : undefined,
          skip_weekend: skipWeekend || undefined,
          posts_transaction: postsTransaction,
        };

        if (isEdit && schedule) {
          await updateSchedule(schedule.id, data);
        } else {
          await createSchedule(data);
        }
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  };

  const groupedCategories = categoryGroups
    .filter((g) => !g.is_income && !g.is_system)
    .map((group) => ({
      ...group,
      items: categories.filter((c) => c.category_group_id === group.id),
    }))
    .filter((g) => g.items.length > 0);

  const incomeCategories = categoryGroups
    .filter((g) => g.is_income)
    .flatMap((g) => categories.filter((c) => c.category_group_id === g.id));

  const showDayOfMonth = frequency === "monthly" || frequency === "yearly";
  const showDayOfWeek = frequency === "weekly" || frequency === "biweekly";
  const showInterval = frequency !== "once" && frequency !== "biweekly";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit schedule" : "Add schedule"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {/* Expense/Income toggle */}
          <div className="relative flex p-1 rounded-xl border border-input dark:bg-input" role="group" aria-label="Transaction type">
            <div
              className={`absolute top-1 bottom-1 w-[calc(50%-0.25rem)] rounded-lg bg-primary/15 shadow-sm ring-1 ring-primary/25 transition-transform duration-200 ease-in-out ${
                isExpense ? "translate-x-0" : "translate-x-[calc(100%+0.25rem)]"
              }`}
            />
            <button
              type="button"
              onClick={() => setIsExpense(true)}
              aria-pressed={isExpense}
              className={`relative z-10 flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors duration-200 ${
                isExpense ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              Expense
            </button>
            <button
              type="button"
              onClick={() => setIsExpense(false)}
              aria-pressed={!isExpense}
              className={`relative z-10 flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors duration-200 ${
                !isExpense ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              Income
            </button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-negative">{error}</p>
          )}

          {/* Amount */}
          <div className="rounded-xl border border-input py-6">
            <label htmlFor="sched-amount" className="sr-only">Amount</label>
            <input
              id="sched-amount"
              type="text"
              inputMode="decimal"
              placeholder={hidden ? "$••••••" : "$0.00"}
              value={
                hidden
                  ? ""
                  : amount
                    ? amountFocused
                      ? `$${amount}`
                      : `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : ""
              }
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onFocus={() => setAmountFocused(true)}
              onBlur={() => setAmountFocused(false)}
              // Deliberately not `required`. The handleSubmit guard below
              // already rejects an empty amount -- and rejects "0" and "."
              // besides, which `required` cannot see -- and it reports through
              // the same styled error every other field in this dialog uses.
              // With `required` the browser blocked submission first, so an
              // empty amount got a native bubble while $0 got our error.
              autoFocus
              disabled={hidden}
              className="w-full text-center text-4xl font-bold tracking-tight bg-transparent outline-none placeholder:text-muted-foreground/40"
            />
          </div>

          {/* Name + Account */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sched-name" className="sr-only">Name</label>
              <input
                id="sched-name"
                placeholder="Schedule name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={fieldClass}
              />
            </div>
            <AccountCombobox
              value={accountId}
              accounts={accounts}
              onChange={setAccountId}
              placeholder="Select account"
            />
          </div>

          {/* Payee */}
          <div>
            <label htmlFor="sched-payee" className="sr-only">Payee</label>
            <input
              id="sched-payee"
              placeholder={isExpense ? "Payee" : "Source"}
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              className={fieldClass}
            />
          </div>

          {/* Category */}
          <CategoryCombobox
            value={categoryId}
            groupedCategories={isExpense ? groupedCategories : []}
            incomeCategories={!isExpense ? incomeCategories : []}
            onChange={setCategoryId}
          />

          {/* Frequency row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sched-frequency" className="sr-only">Frequency</label>
              <Select
                value={frequency}
                onValueChange={(v) => v && setFrequency(v as ScheduleFrequency)}
              >
                <SelectTrigger id="sched-frequency" className="w-full h-10">
                  <SelectValue>
                    {FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showInterval && (
              <div>
                <label htmlFor="sched-interval" className="sr-only">Every N periods</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">Every</span>
                  <input
                    id="sched-interval"
                    type="number"
                    min="1"
                    max="365"
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                    className={fieldClass + " w-16"}
                  />
                  <span className="text-sm text-muted-foreground">
                    {frequency === "daily" ? "day(s)" :
                     frequency === "weekly" ? "week(s)" :
                     frequency === "monthly" ? "month(s)" :
                     "year(s)"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Day-of constraints */}
          <div className="grid grid-cols-2 gap-3">
            {showDayOfMonth && (
              <FieldGroup label="Day of month" htmlFor="sched-dom">
                {/* Values stay strings: dayOfMonth is state-as-string, and a
                    numeric SelectItem value would never match it. */}
                <Select
                  value={dayOfMonth}
                  onValueChange={(v) => v && setDayOfMonth(v)}
                >
                  <SelectTrigger id="sched-dom" className="w-full h-10">
                    <SelectValue>
                      {dayOfMonth === "-1" ? "Last day" : dayOfMonth}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                      </SelectItem>
                    ))}
                    <SelectItem value="-1">Last day</SelectItem>
                  </SelectContent>
                </Select>
              </FieldGroup>
            )}
            {showDayOfWeek && (
              <FieldGroup label="Day of week" htmlFor="sched-dow">
                <Select
                  value={dayOfWeek}
                  onValueChange={(v) => v && setDayOfWeek(v)}
                >
                  <SelectTrigger id="sched-dow" className="w-full h-10">
                    <SelectValue>{DAY_NAMES[Number(dayOfWeek)]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_NAMES.map((dayName, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {dayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldGroup>
            )}
            <FieldGroup
              htmlFor="sched-skip-weekend"
              label={
                <>
                  Weekend handling
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">
                      <CircleHelp className="h-3.5 w-3.5 text-muted-foreground/40" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]">
                      If a scheduled date falls on a weekend, shift it to the nearest weekday instead.
                    </TooltipContent>
                  </Tooltip>
                </>
              }
            >
              <Select
                value={skipWeekend}
                onValueChange={(v) => setSkipWeekend(v ?? "")}
              >
                <SelectTrigger id="sched-skip-weekend" className="w-full h-10">
                  <SelectValue>
                    {WEEKEND_OPTIONS.find((o) => o.value === skipWeekend)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {WEEKEND_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldGroup>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label="Start date" htmlFor="sched-start">
              <DateInput
                id="sched-start"
                value={startDate}
                onChange={(e) => {
                  const value = e.target.value;
                  setStartDate(value);
                  const parts = deriveDayParts(value);
                  if (parts) {
                    setDayOfMonth(parts.dayOfMonth);
                    setDayOfWeek(parts.dayOfWeek);
                  }
                }}
                required
              />
            </FieldGroup>
            <FieldGroup label="End date" htmlFor="sched-end" optional>
              <DateInput
                id="sched-end"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </FieldGroup>
          </div>

          {/* Memo */}
          <div>
            <label htmlFor="sched-memo" className="sr-only">Note</label>
            <input
              id="sched-memo"
              placeholder="Add a note (optional)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className={fieldClass}
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <label className="flex items-center gap-2.5 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={postsTransaction}
                onChange={(e) => setPostsTransaction(e.target.checked)}
                className="rounded accent-primary"
              />
              Auto-post when due
            </label>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={hidden || isPending} aria-busy={isPending}>
                {isPending ? "Saving..." : isEdit ? "Save" : "Add schedule"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
