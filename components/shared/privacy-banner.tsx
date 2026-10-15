"use client";

import { X } from "lucide-react";
import { useAmountsHidden } from "./privacy-provider";

/**
 * Top banner shown while amounts are hidden. Mirrors DevModeBanner's sticky
 * pattern and emits `--zero-privacy-banner-h` so full-height containers
 * (app-shell, sidebar, budget detail panel) can subtract it. Sits below the
 * dev banner via `top: var(--zero-banner-h)`.
 *
 * While hidden, amount edits are
 * locked (see the money inputs' `hidden` guards), hence "will not be saved".
 */
export function PrivacyBanner() {
  const { hidden, setHidden } = useAmountsHidden();
  if (!hidden) return null;

  return (
    <>
      <style>{`:root { --zero-privacy-banner-h: 2.75rem; }`}</style>
      <div
        role="status"
        aria-label="Amounts hidden"
        className="sticky top-[var(--zero-banner-h,0px)] z-50 flex h-11 items-center gap-4 bg-primary px-4 text-sm text-primary-foreground"
      >
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="flex items-center gap-1.5 rounded-md bg-primary-foreground/15 px-2.5 py-1 font-medium transition-colors hover:bg-primary-foreground/25"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Unhide
        </button>
        <span>Changes to amounts will not be saved.</span>
      </div>
    </>
  );
}
