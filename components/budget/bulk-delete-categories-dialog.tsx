"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const UNCATEGORIZED_VALUE = "__uncategorized__";

export type ReassignOption = {
  id: string;
  name: string;
  groupName: string;
};

type BulkDeleteCategoriesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryCount: number;
  groupCount: number;
  transactionCount: number;
  reassignOptions: ReassignOption[];
  onConfirm: (reassignToCategoryId: string | null) => void;
  pending?: boolean;
  // Set when the selection has assign history. The server refuses a delete
  // that would drop it — the budget rows have nowhere to go, and losing them
  // inflates Ready to Assign by whatever was already spent — so the picker
  // stops offering "leave uncategorized" and Delete stays disabled until a
  // destination is chosen.
  requireReassign?: boolean;
};

export function BulkDeleteCategoriesDialog({
  open,
  onOpenChange,
  categoryCount,
  groupCount,
  transactionCount,
  reassignOptions,
  onConfirm,
  pending = false,
  requireReassign = false,
}: BulkDeleteCategoriesDialogProps) {
  const [reassignTo, setReassignTo] = useState<string>(UNCATEGORIZED_VALUE);

  // Reset selection whenever the dialog opens fresh. When a destination is
  // required there is no safe default to preselect — an empty value is what
  // keeps Delete disabled until the user actually chooses.
  useEffect(() => {
    if (open) setReassignTo(requireReassign ? "" : UNCATEGORIZED_VALUE);
  }, [open, requireReassign]);

  const groupedOptions = groupOptionsByGroup(reassignOptions);

  const title = buildTitle(categoryCount, groupCount);
  const description = buildDescription(
    categoryCount,
    groupCount,
    transactionCount,
    requireReassign
  );

  const showReassign =
    (transactionCount > 0 || requireReassign) && reassignOptions.length > 0;
  // Nothing to reassign *to* — the user's only route is to hide instead, so
  // say that rather than presenting a Delete button that will fail server-side.
  const blocked = requireReassign && reassignOptions.length === 0;
  const canDelete = !blocked && (!requireReassign || reassignTo !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {blocked ? (
          <p className="text-[13px] text-negative">
            There is no other category to move this budget history to. Hide it
            instead — hiding returns its balance to Ready to Assign and keeps
            the history intact.
          </p>
        ) : null}

        {showReassign ? (
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-foreground">
              {requireReassign
                ? "Move transactions and budget history to"
                : "Reassign transactions to"}
            </label>
            <Select value={reassignTo} onValueChange={(v) => setReassignTo(v ?? UNCATEGORIZED_VALUE)}>
              <SelectTrigger className="w-full">
                {/* Base UI renders the raw value unless given children to map
                    it back to a label — a bare <SelectValue /> put a category
                    UUID in the trigger the moment anything real was picked.
                    Every other Select in the app passes this mapping. */}
                <SelectValue placeholder="Choose a category…">
                  {reassignTo === UNCATEGORIZED_VALUE
                    ? "Leave uncategorized"
                    : reassignOptions.find((o) => o.id === reassignTo)?.name ??
                      "Choose a category…"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {requireReassign ? null : (
                  <SelectItem value={UNCATEGORIZED_VALUE}>
                    Leave uncategorized
                  </SelectItem>
                )}
                {groupedOptions.map((g) => (
                  <SelectGroup key={g.groupName}>
                    <SelectLabel>{g.groupName}</SelectLabel>
                    {g.options.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !canDelete}
            onClick={() => {
              onConfirm(
                reassignTo === UNCATEGORIZED_VALUE || reassignTo === ""
                  ? null
                  : reassignTo
              );
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildTitle(categoryCount: number, groupCount: number): string {
  if (groupCount > 0 && categoryCount > 0) {
    return `Delete ${groupCount} ${plural(groupCount, "group", "groups")} and ${categoryCount} ${plural(categoryCount, "category", "categories")}?`;
  }
  if (groupCount > 0) {
    return `Delete ${groupCount} ${plural(groupCount, "group", "groups")}?`;
  }
  return `Delete ${categoryCount} ${plural(categoryCount, "category", "categories")}?`;
}

function buildDescription(
  categoryCount: number,
  groupCount: number,
  transactionCount: number,
  requireReassign: boolean
): string {
  const parts: string[] = [];
  if (groupCount > 0 && categoryCount > 0) {
    parts.push("This will permanently delete the selected groups and categories.");
  } else if (groupCount > 0) {
    parts.push("This will permanently delete the selected groups.");
  } else {
    parts.push("This will permanently delete the selected categories.");
  }
  if (requireReassign) {
    // Says why the choice can't be skipped. Without it the disabled Delete
    // button reads as a bug rather than a guard.
    parts.push(
      transactionCount > 0
        ? `${transactionCount} ${plural(transactionCount, "transaction", "transactions")} and the budget history move to the category you choose. A destination is required — dropping the history would add money to Ready to Assign that was already spent.`
        : "The budget history moves to the category you choose. A destination is required — dropping it would add money to Ready to Assign that was already spent."
    );
  } else if (transactionCount > 0) {
    parts.push(
      `${transactionCount} ${plural(transactionCount, "transaction", "transactions")} will be reassigned to the category you choose, or become uncategorized.`
    );
  } else {
    parts.push("No transactions are affected.");
  }
  return parts.join(" ");
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function groupOptionsByGroup(
  options: ReassignOption[]
): { groupName: string; options: ReassignOption[] }[] {
  const map = new Map<string, ReassignOption[]>();
  for (const opt of options) {
    const arr = map.get(opt.groupName) ?? [];
    arr.push(opt);
    map.set(opt.groupName, arr);
  }
  return Array.from(map, ([groupName, opts]) => ({ groupName, options: opts }));
}
