import type {
  SplitDraftItem,
  SplitDraftState,
} from "@/components/transactions/transactions-client";

// Pure split-allocation math, extracted from transaction-table.tsx so it can
// be unit-tested in isolation (it used to be two un-exported helpers living
// inside the table component). Behavior is unchanged by the move.

/**
 * How much of the parent amount is not yet allocated to a split line.
 * A result of 0 (to the cent) means the split is balanced.
 */
export function splitRemainingAmount(splitDraft: SplitDraftState): number {
  const sum = splitDraft.items.reduce((acc, item) => acc + item.amount, 0);
  return splitDraft.parentAmount - sum;
}

/**
 * Distribute the unallocated remainder across the split lines. Empty (zero)
 * lines absorb it evenly using integer cents (last line takes the rounding
 * remainder so the parts always sum to the parent to the cent); if there are
 * no empty lines, the remainder is added to the last line.
 */
export function autoDistributeSplits(splitDraft: SplitDraftState): SplitDraftItem[] {
  const remaining = splitRemainingAmount(splitDraft);
  const items = splitDraft.items.map((item) => ({ ...item }));
  const emptyItems = items.filter((i) => i.amount === 0);

  if (emptyItems.length > 0) {
    // Distribute evenly across empty splits using integer cents
    const remainingCents = Math.round(remaining * 100);
    const perItemCents = Math.floor(remainingCents / emptyItems.length);
    let distributed = 0;
    emptyItems.forEach((item, idx) => {
      if (idx === emptyItems.length - 1) {
        item.amount = (remainingCents - distributed) / 100;
      } else {
        item.amount = perItemCents / 100;
        distributed += perItemCents;
      }
    });
  } else {
    // No empty splits — add remainder to the last split
    items[items.length - 1].amount += remaining;
  }
  return items;
}
