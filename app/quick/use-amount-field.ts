"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  evaluateAmountExpression,
  toAmountOperator,
} from "@/lib/amount-expression";
import {
  EMPTY_AMOUNT_ENTRY,
  amountEntryExpression,
  amountEntryFromNumber,
  amountEntryKey,
  amountEntryText,
  type AmountEntry,
} from "@/lib/quick-add-utils";

/** Map typed characters to reducer keys: operators canonicalised, the rest as-is. */
function toAmountKeys(text: string, allowMaths: boolean): string[] {
  return [...text]
    .map((c) => toAmountOperator(c) ?? c)
    .filter((k) => allowMaths || toAmountOperator(k) === null);
}

/**
 * State and input wiring for a /quick amount field: plain dollars, plus
 * arithmetic typed inside the field when `allowMaths` (see `AmountEntry` in
 * lib/quick-add-utils). `cents` is always the evaluated total, so callers never
 * see the expression.
 */
export function useAmountField({ allowMaths }: { allowMaths: boolean }) {
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_AMOUNT_ENTRY);
  const inputRef = useRef<HTMLInputElement>(null);
  const text = amountEntryText(entry);
  const total = evaluateAmountExpression(amountEntryExpression(entry)) ?? 0;
  const cents = Math.round(total * 100);

  const press = (keys: string[]) => setEntry((prev) => keys.reduce(amountEntryKey, prev));

  // Every edit arrives as the browser's new value. Rather than trust the caret
  // to be at the end (a touch-key tap or a stray tap in the field can move it),
  // work out what was typed from the caret position and apply it at the end of
  // the expression — keys always act on the operand being typed. Diffing the
  // value rather than reading keydown is what makes a phone keypad work: its
  // keydowns don't reliably name the key.
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    const grew = next.length - text.length;
    if (next === "") {
      setEntry(EMPTY_AMOUNT_ENTRY);
    } else if (next.length === 1 && text.length > 1) {
      // Everything selected and typed over: start again from that key.
      setEntry(toAmountKeys(next, allowMaths).reduce(amountEntryKey, EMPTY_AMOUNT_ENTRY));
    } else if (grew <= 0) {
      // A deletion: one Backspace — a character removed anywhere maps to the last one.
      press(["Backspace"]);
    } else {
      const caret = e.target.selectionEnd ?? next.length;
      const added = next.slice(Math.max(0, caret - grew), caret);
      // A paste into an empty field is a whole amount ("$1,200", "12.50+3"),
      // not keystrokes to apply one at a time.
      const pasted = !text && added.length > 1 ? evaluateAmountExpression(added) : null;
      if (pasted !== null && pasted > 0) {
        setEntry(amountEntryFromNumber(pasted));
      } else {
        press(toAmountKeys(added, allowMaths));
      }
    }
  };

  // Keep a collapsed caret at the end, so the next edit is an append. A real
  // selection is left alone so select-all-and-retype still works.
  const onSelect = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const end = el.value.length;
    if (el.selectionStart === el.selectionEnd && el.selectionStart !== end) {
      el.setSelectionRange(end, end);
    }
  };

  // The value is rebuilt on every keystroke, which can drop the caret
  // mid-text; put it back at the end.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && document.activeElement === el) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [text]);

  // Stable, so callers can use them in effects.
  const reset = useCallback(() => setEntry(EMPTY_AMOUNT_ENTRY), []);
  const setAmount = useCallback(
    (amount: number) => setEntry(amountEntryFromNumber(amount)),
    []
  );

  return {
    inputRef,
    text,
    cents,
    hasMaths: entry.terms.length > 0,
    press,
    onChange,
    onSelect,
    reset,
    setAmount,
  };
}
