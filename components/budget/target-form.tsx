"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { DateInput } from "@/components/shared/date-input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import type { Target, TargetFrequency } from "@/lib/types";
import type { TargetInput } from "@/app/(app)/budget/actions";

type TargetFormProps = {
  target: Target | null;
  onSave: (data: TargetInput) => void;
  onDelete?: () => void;
  onCancel: () => void;
  /** The save is in flight — lock the button so it can't double-submit. */
  saving?: boolean;
};

type GoalType = "set_aside" | "fill_up_to" | "have_balance";

function deriveChip(target: Target | null): TargetFrequency {
  if (!target) return "monthly";
  // Custom target types always open in Custom
  if (target.type === "spending" || target.type === "savings_balance") return "custom";
  // monthly_funding inherits its chip from the stored frequency so a target
  // saved through Custom + Set aside (no date) reopens on the Custom tab
  // instead of silently collapsing to Monthly.
  if (target.type === "monthly_funding") {
    if (target.frequency === "weekly") return "weekly";
    if (target.frequency === "custom") return "custom";
    return "monthly";
  }
  // target_by_date + frequency=yearly → Yearly chip; other dates → Custom
  if (target.type === "target_by_date" && target.frequency === "yearly") return "yearly";
  return "custom";
}

function deriveGoalType(target: Target | null): GoalType {
  if (!target) return "set_aside";
  switch (target.type) {
    case "savings_balance":
      return "have_balance";
    case "spending":
      return "fill_up_to";
    case "monthly_funding":
    case "target_by_date":
    default:
      return "set_aside";
  }
}

const goalDescriptions: Record<GoalType, { useFor: string; behavior: string }> = {
  set_aside: {
    useFor: "Use for: bills, subscriptions, saving over time",
    behavior: "Add this amount each month, regardless of the current balance.",
  },
  fill_up_to: {
    useFor: "Use for: gasoline, fun money, dining out",
    behavior: "Use what is already in this category and fill it up to this amount.",
  },
  have_balance: {
    useFor: "Use for: long-term savings",
    behavior: "Reach this amount over time. No deadline pressure.",
  },
};

function defaultYearOutDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultMonthOutDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthsBetween(isoDate: string): number {
  const [y, m] = isoDate.split("-").map(Number);
  const now = new Date();
  return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1)) + 1;
}

export function TargetForm({ target, onSave, onDelete, onCancel, saving = false }: TargetFormProps) {
  const fmt = useMaskedCurrency();
  const { hidden } = useAmountsHidden();
  const initialChip = deriveChip(target);
  // For new targets opening on Custom, default to the open-ended goal — the cadence
  // chips already cover monthly Set aside, so Custom's natural use is open-ended.
  const initialGoalType: GoalType = !target && initialChip === "custom"
    ? "have_balance"
    : deriveGoalType(target);

  const [chip, setChip] = useState<TargetFrequency>(initialChip);
  const [goalType, setGoalType] = useState<GoalType>(initialGoalType);
  const [amount, setAmount] = useState(target?.target_amount?.toString() ?? "");
  const [dueByDate, setDueByDate] = useState(
    target?.target_date ?? (initialChip === "yearly" ? defaultYearOutDate() : "")
  );
  // Track whether the user has explicitly chosen a goalType so we can apply
  // smart defaults when entering Custom for the first time without clobbering
  // an existing user choice on later chip toggles.
  const [goalTypeTouched, setGoalTypeTouched] = useState(!!target);

  const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, "")) || 0;

  // For Custom + set_aside / fill_up_to we expose the date control.
  // have_balance has no date in any chip.
  const customAllowsDate = goalType !== "have_balance";

  const handleChipChange = (next: TargetFrequency) => {
    setChip(next);
    if (next === "yearly" && !dueByDate) {
      setDueByDate(defaultYearOutDate());
    }
    // First time entering Custom on a new target, default to open-ended.
    if (next === "custom" && !goalTypeTouched) {
      setGoalType("have_balance");
    }
  };

  const handleGoalTypeChange = (next: GoalType) => {
    setGoalType(next);
    setGoalTypeTouched(true);
  };

  const handleSave = () => {
    // Privacy lock: amounts hidden, so no target is saved.
    if (hidden) return;
    if (parsedAmount <= 0) return;

    let type: TargetInput["type"];
    let storedAmount = parsedAmount;
    let targetDate: string | null = null;
    let monthlyContribution: number | null = null;
    const frequency: TargetFrequency = chip;

    switch (chip) {
      case "weekly":
        type = "monthly_funding";
        // Convert weekly to monthly equivalent for storage
        storedAmount = Math.round(parsedAmount * (52 / 12) * 100) / 100;
        monthlyContribution = storedAmount;
        break;
      case "monthly":
        type = "monthly_funding";
        monthlyContribution = parsedAmount;
        break;
      case "yearly":
        type = "target_by_date";
        targetDate = dueByDate || defaultYearOutDate();
        monthlyContribution = monthsBetween(targetDate) > 0
          ? parsedAmount / monthsBetween(targetDate)
          : parsedAmount;
        break;
      case "custom":
      default: {
        const effectiveDate = customAllowsDate ? dueByDate : "";
        switch (goalType) {
          case "have_balance":
            type = "savings_balance";
            break;
          case "fill_up_to":
            type = "spending";
            if (effectiveDate) {
              const months = monthsBetween(effectiveDate);
              monthlyContribution = months > 0 ? parsedAmount / months : parsedAmount;
              targetDate = effectiveDate;
            }
            break;
          case "set_aside":
          default:
            if (effectiveDate) {
              type = "target_by_date";
              targetDate = effectiveDate;
              const months = monthsBetween(effectiveDate);
              monthlyContribution = months > 0 ? parsedAmount / months : parsedAmount;
            } else {
              type = "monthly_funding";
              monthlyContribution = parsedAmount;
            }
            break;
        }
        break;
      }
    }

    onSave({
      type,
      frequency,
      target_amount: storedAmount,
      target_date: targetDate,
      monthly_contribution: monthlyContribution,
      // Yearly is a recurring cadence by definition (peer of Weekly/Monthly) —
      // it always repeats. One-time dated goals live under the Custom chip.
      recurring: chip === "yearly",
    });
  };

  const formattedAmount = parsedAmount > 0 ? fmt(parsedAmount) : "$0.00";
  const weeklyMonthlyEquivalent = parsedAmount > 0
    ? fmt(Math.round(parsedAmount * (52 / 12) * 100) / 100)
    : "$0.00";

  return (
    <div className="space-y-4">
      <Tabs value={chip} onValueChange={(v) => handleChipChange(v as TargetFrequency)}>
        <TabsList className="w-full">
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="yearly">Yearly</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>
      </Tabs>

      <FieldLabel label={chip === "weekly" ? "I need (per week)" : "Amount"}>
        <AmountInput value={amount} onChange={setAmount} hidden={hidden} />
      </FieldLabel>

      {chip === "weekly" && (
        <p className="text-xs text-muted-foreground/70">
          Equivalent to {weeklyMonthlyEquivalent} per month.
        </p>
      )}

      {chip === "monthly" && (
        <p className="text-xs text-muted-foreground/70">
          Set aside {formattedAmount} every month, regardless of the current balance.
        </p>
      )}

      {chip === "yearly" && (
        <>
          <FieldLabel label="By">
            <DateInput
              value={dueByDate}
              onChange={(e) => setDueByDate(e.target.value)}
              className="w-full"
            />
          </FieldLabel>
          <p className="text-xs text-muted-foreground/70">
            Repeats every year. For a one-time goal, use Custom.
          </p>
        </>
      )}

      {chip === "custom" && (
        <>
          <FieldLabel label="I want to">
            <Select value={goalType} onValueChange={(v) => v && handleGoalTypeChange(v as GoalType)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {goalType === "set_aside"
                    ? `Set aside ${formattedAmount}`
                    : goalType === "fill_up_to"
                      ? `Fill up to ${formattedAmount}`
                      : `Have a balance of ${formattedAmount}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <GoalOption value="set_aside" label={`Set aside ${formattedAmount}`} />
                <GoalOption value="fill_up_to" label={`Fill up to ${formattedAmount}`} />
                <GoalOption value="have_balance" label={`Have a balance of ${formattedAmount}`} />
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground/70 pt-1">
              {goalDescriptions[goalType].useFor}
            </p>
            <p className="text-xs text-muted-foreground/70">
              {goalDescriptions[goalType].behavior}
            </p>
          </FieldLabel>

          {customAllowsDate && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
                <Switch
                  checked={Boolean(dueByDate)}
                  onCheckedChange={(checked) => {
                    setDueByDate(checked ? defaultMonthOutDate() : "");
                  }}
                />
                Due by date
              </label>
              {dueByDate ? (
                <FieldLabel label="Due on">
                  <DateInput
                    value={dueByDate}
                    onChange={(e) => setDueByDate(e.target.value)}
                    className="w-full"
                  />
                </FieldLabel>
              ) : null}
            </div>
          )}
        </>
      )}

      <div className="flex items-center pt-2 border-t border-border/50">
        {onDelete && (
          <button
            onClick={onDelete}
            className="flex items-center gap-1 text-sm text-destructive hover:text-destructive/80 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={hidden || saving || parsedAmount <= 0}>
            {saving ? "Saving…" : "Save target"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GoalOption({ value, label }: { value: GoalType; label: string }) {
  const desc = goalDescriptions[value];
  return (
    <SelectItem value={value}>
      <div className="flex flex-col gap-0.5 py-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{desc.useFor}</span>
      </div>
    </SelectItem>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function AmountInput({
  value,
  onChange,
  hidden,
}: {
  value: string;
  onChange: (v: string) => void;
  hidden: boolean;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        type="text"
        inputMode="decimal"
        value={hidden ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hidden ? "••••••" : "0.00"}
        disabled={hidden}
        className="pl-7 w-full"
      />
    </div>
  );
}
