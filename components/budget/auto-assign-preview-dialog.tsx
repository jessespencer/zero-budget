"use client";

import { useEffect, useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import {
  getFundUnderfundedPreview,
  type FundUnderfundedPreviewRow,
} from "@/app/(app)/budget/actions";

// Verb phrase completing "{n} categories will …". "Fund underfunded" covers
// both overspending (back to zero) and target pace in one pass.
const OUTCOME = "be brought out of the red and up to their monthly target.";
const EMPTY_TEXT =
  "Nothing to fund — no category is overspent or behind its monthly target.";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  onConfirm: () => void;
  pending?: boolean;
};

type Group = {
  group_id: string;
  group_name: string;
  rows: FundUnderfundedPreviewRow[];
};

function groupRows(rows: FundUnderfundedPreviewRow[]): Group[] {
  const order: string[] = [];
  const map = new Map<string, Group>();
  for (const row of rows) {
    let g = map.get(row.group_id);
    if (!g) {
      g = { group_id: row.group_id, group_name: row.group_name, rows: [] };
      map.set(row.group_id, g);
      order.push(row.group_id);
    }
    g.rows.push(row);
  }
  return order.map((id) => map.get(id)!);
}

export function AutoAssignPreviewDialog({
  open,
  onOpenChange,
  month,
  onConfirm,
  pending = false,
}: Props) {
  const [rows, setRows] = useState<FundUnderfundedPreviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoad] = useTransition();
  const fmt = useMaskedCurrency();

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError(null);
    startLoad(async () => {
      try {
        const r = await getFundUnderfundedPreview(month);
        setRows(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load preview");
      }
    });
  }, [open, month]);

  const total = rows?.reduce((sum, r) => sum + r.amount, 0) ?? 0;
  const count = rows?.length ?? 0;
  const groups = rows ? groupRows(rows) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Auto-assign preview</DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-negative">{error}</p>
        ) : isLoading || rows === null ? (
          <p className="text-sm text-muted-foreground">Calculating…</p>
        ) : count === 0 ? (
          <div className="rounded-md border border-border bg-accent/40 p-4 text-sm text-muted-foreground">
            {EMPTY_TEXT}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-md bg-positive/10 ring-1 ring-positive/20 px-4 py-3">
              <CircleCheck className="h-5 w-5 text-positive shrink-0" />
              <p className="text-sm text-foreground">
                <span className="font-semibold">{count}</span>{" "}
                {count === 1 ? "category" : "categories"} will {OUTCOME}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto -mx-6 px-6">
              <div className="space-y-5">
                {groups.map((group) => (
                  <div key={group.group_id}>
                    <div className="text-[13px] font-semibold text-foreground mb-1.5">
                      {group.group_name}
                    </div>
                    <ul className="space-y-1">
                      {group.rows.map((row) => (
                        <li
                          key={row.category_id}
                          className="flex items-baseline justify-between gap-3 text-[13px]"
                        >
                          <span className="text-foreground truncate">
                            {row.category_name}
                          </span>
                          <span className="text-positive tabular-nums zero-amount">
                            +{fmt(row.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-baseline justify-between border-t border-border pt-3 text-[13px]">
              <span className="font-semibold text-foreground">Total</span>
              <span className="font-semibold text-positive tabular-nums zero-amount">
                +{fmt(total)}
              </span>
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending || count === 0 || isLoading}
          >
            Assign money
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
