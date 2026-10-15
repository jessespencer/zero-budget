"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import type {
  CopyLastMonthMode,
  CopyLastMonthPreview,
} from "@/app/(app)/budget/actions";

type CopyLastMonthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: CopyLastMonthPreview | null;
  onChoose: (mode: CopyLastMonthMode) => void;
};

/**
 * Shown only when copying last month would overwrite amounts already assigned
 * this month. Filling empty categories is the default; replacing is still one
 * click away (and undoable), but never the accidental outcome.
 */
export function CopyLastMonthDialog({
  open,
  onOpenChange,
  preview,
  onChoose,
}: CopyLastMonthDialogProps) {
  const fmt = useMaskedCurrency();
  if (!preview) return null;

  const { overwriteCount, overwriteAssigned, fillCount } = preview;
  const categories = (n: number) => `${n} ${n === 1 ? "category" : "categories"}`;

  const choose = (mode: CopyLastMonthMode) => {
    onOpenChange(false);
    onChoose(mode);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Copy last month&apos;s budget?</DialogTitle>
          <DialogDescription>
            You&apos;ve already assigned{" "}
            <span className="zero-amount font-medium text-foreground">
              {fmt(overwriteAssigned)}
            </span>{" "}
            across {categories(overwriteCount)} this month that last
            month&apos;s amounts would replace.{" "}
            {fillCount > 0
              ? `Filling only empty categories updates ${categories(fillCount)} and keeps your work.`
              : "Every category that last month would fill already has an amount, so filling empty ones changes nothing."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => choose("replace")}>
            Replace all
          </Button>
          <Button disabled={fillCount === 0} onClick={() => choose("fill-empty")}>
            Fill empty only
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
