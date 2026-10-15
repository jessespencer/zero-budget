"use client";

import { useCallback } from "react";
import { formatCurrency, formatCurrencyWhole, maskCurrency } from "@/lib/format";
import { useAmountsHidden } from "./privacy-provider";

/**
 * Currency formatter that respects privacy/demo mode. Use at the ~38 string
 * callsites that build money into a template (chart tick/tooltip formatters,
 * inline `{fmt(x)}` in JSX) rather than rendering the <Currency> component.
 * Returns "$••••••" while amounts are hidden.
 *
 * Wrap the rendered output in a span carrying `.zero-amount` where the value is
 * server-rendered, so the anti-flash blur applies on hard reload.
 */
export function useMaskedCurrency() {
  const { hidden } = useAmountsHidden();
  return useCallback(
    (amount: number) => (hidden ? maskCurrency(amount) : formatCurrency(amount)),
    [hidden]
  );
}

/** Whole-dollar variant (no cents) — mirrors formatCurrencyWhole. */
export function useMaskedCurrencyWhole() {
  const { hidden } = useAmountsHidden();
  return useCallback(
    (amount: number) =>
      hidden ? maskCurrency(amount) : formatCurrencyWhole(amount),
    [hidden]
  );
}
