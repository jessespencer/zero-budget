"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field-group";
import { CategoryCombobox } from "@/components/shared/category-combobox";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import { useToast } from "@/components/ui/toast";
import { availableCents, roundCents } from "@/lib/db-utils";
import { cn, fieldClass } from "@/lib/utils";
import {
  moveMoneyBetweenCategoriesWithSnapshot,
  restoreMoveMoneySnapshot,
  type MoveMoneySnapshot,
} from "@/app/(app)/budget/actions";
import type { MutationEntry, MutationId } from "@/lib/use-undo-redo";

type Destination = { id: string; name: string; groupName: string };

type MoveMoneyPopoverProps = {
  sourceCategoryId: string;
  sourceCategoryName: string;
  sourceAvailable: number;
  month: string;
  destinations: Destination[];
  readyToAssignLabel?: string;
  onMutate: (entry: MutationEntry) => MutationId;
  undoEntry: (id: MutationId) => void;
  children: React.ReactNode;
};

const RTA_SENTINEL = "RTA" as const;

export function MoveMoneyPopover({
  sourceCategoryId,
  sourceCategoryName,
  sourceAvailable,
  month,
  destinations,
  readyToAssignLabel = "Ready to Assign",
  onMutate,
  undoEntry,
  children,
}: MoveMoneyPopoverProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(() =>
    String(roundCents(sourceAvailable))
  );
  const [destCategoryId, setDestCategoryId] = useState<string>(RTA_SENTINEL);
  const [isMoving, startTransition] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);
  const fmt = useMaskedCurrency();
  const { hidden } = useAmountsHidden();
  const { toast } = useToast();

  // Reshape destinations into CategoryCombobox's groupedCategories input.
  // Ready to Assign is pinned as a single-item synthetic group at the top.
  // The parent already pre-sorted (visible groups in display order, source
  // excluded), so insertion order here is the render order.
  const groupedCategories = useMemo(() => {
    const groups: { id: string; name: string; items: { id: string; name: string }[] }[] = [
      {
        id: RTA_SENTINEL,
        name: readyToAssignLabel,
        items: [{ id: RTA_SENTINEL, name: readyToAssignLabel }],
      },
    ];
    const byName = new Map<string, { id: string; name: string }[]>();
    for (const dest of destinations) {
      let bucket = byName.get(dest.groupName);
      if (!bucket) {
        bucket = [];
        byName.set(dest.groupName, bucket);
        groups.push({ id: dest.groupName, name: dest.groupName, items: bucket });
      }
      bucket.push({ id: dest.id, name: dest.name });
    }
    return groups;
  }, [destinations, readyToAssignLabel]);

  // On open, prefill the amount with source available (rounded for display)
  // and reset the destination to RTA (pinned at the top). Focus + select-all
  // the amount input on the next tick — mirrors the AssignInput pattern.
  useEffect(() => {
    if (!open) return;
    setAmount(String(roundCents(sourceAvailable)));
    setDestCategoryId(RTA_SENTINEL);
    const timer = setTimeout(() => {
      amountRef.current?.focus();
      amountRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [open, sourceAvailable]);

  const parsed = parseFloat(amount);
  // The TYPED amount stays unrounded — $5.001 against $5.00 still surfaces the
  // warning. The SOURCE is rounded (see availableCents): it's an engine float
  // sum, so a break-even category sits at ~-1e-13 and moving $0 would otherwise
  // warn "This will overspend by $0.00". parsed === NaN ("" or "-") = no overspend.
  const overspendBy = Number.isFinite(parsed)
    ? parsed - availableCents(sourceAvailable)
    : 0;

  const destLabel = useMemo(() => {
    if (destCategoryId === RTA_SENTINEL) return readyToAssignLabel;
    const found = destinations.find((d) => d.id === destCategoryId);
    return found?.name ?? readyToAssignLabel;
  }, [destCategoryId, destinations, readyToAssignLabel]);

  const submit = () => {
    // Privacy lock: amounts hidden, so no money is moved.
    if (hidden) {
      setOpen(false);
      return;
    }
    const value = Number.isFinite(parsed) ? parsed : 0;
    if (value === 0 || !destCategoryId) {
      setOpen(false);
      return;
    }

    const moveArgs = {
      sourceCategoryId,
      destCategoryId: destCategoryId as string | "RTA",
      amount: value,
      month,
    };

    startTransition(async () => {
      try {
        const snapshot: MoveMoneySnapshot =
          await moveMoneyBetweenCategoriesWithSnapshot(moveArgs);
        // Close only once the move lands. setOpen used to fire synchronously
        // outside this callback, so a rejected move (the action's own
        // same-source/destination and non-finite-amount guards, or a DB error)
        // still closed the popover with nothing to say the money never moved.
        setOpen(false);
        const entryId = onMutate({
          label: `Move ${fmt(value)} from "${sourceCategoryName}" to "${destLabel}"`,
          forward: async () => {
            await moveMoneyBetweenCategoriesWithSnapshot(moveArgs);
          },
          backward: async () => {
            await restoreMoveMoneySnapshot(snapshot);
          },
        });
        // Both pills move, but the destination (or Ready to assign) is often
        // scrolled off-screen — acknowledge it, and undo *this* move rather than
        // whatever is on top of the stack.
        toast({
          message: `Moved ${fmt(value)} from "${sourceCategoryName}" to "${destLabel}".`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        // Keep the popover open so the user can correct the input and retry.
        toast({
          message: `Couldn't move money from "${sourceCategoryName}" to "${destLabel}". Nothing was moved.`,
          variant: "error",
        });
      }
    });
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit();
  };

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={children as React.ReactElement} />
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-[340px] gap-0"
      >
        <form onSubmit={handleFormSubmit} onKeyDown={handleFormKeyDown}>
          <div className="flex flex-col gap-0.5">
            <div className="font-heading text-lg leading-none font-extrabold">
              Move money
            </div>
            <div className="text-sm text-muted-foreground truncate">
              From {sourceCategoryName}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <FieldGroup label="Move" htmlFor="move-money-amount">
              <input
                ref={amountRef}
                id="move-money-amount"
                type="text"
                inputMode="decimal"
                value={hidden ? "" : amount}
                placeholder={hidden ? "$••••••" : undefined}
                disabled={hidden}
                onChange={(e) => setAmount(e.target.value)}
                className={cn(fieldClass, "text-right tabular-nums")}
              />
            </FieldGroup>

            <FieldGroup label="To">
              <CategoryCombobox
                value={destCategoryId}
                groupedCategories={groupedCategories}
                onChange={(id) => setDestCategoryId(id || RTA_SENTINEL)}
                placeholder="Choose destination"
              />
            </FieldGroup>

            {/* Placeholder area keeps height stable whether or not the
                warning is shown so the action row doesn't jump. */}
            <div className="min-h-[18px] text-sm text-warning tabular-nums">
              {overspendBy > 0
                ? `This will overspend by ${fmt(overspendBy)}`
                : ""}
            </div>
          </div>

          <div className="-mx-4 -mb-4 mt-4 flex justify-end gap-2 rounded-b-2xl border-t bg-muted/50 p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={hidden || isMoving}>
              {isMoving ? "Moving…" : "Move"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
