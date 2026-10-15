// Feature gates for post-MVP capabilities.
// Set to `true` to re-enable. Gated code lives alongside the rest of the
// codebase — do NOT delete gated blocks just because the flag is `false`.
// Search the codebase for `FEATURES.BANK_SYNC` / `FEATURES.RECONCILIATION`
// / `FEATURES.HISTORICAL_DATA` to see all gated sections.
//
// HISTORICAL_DATA is opt-in per install via env: set
// NEXT_PUBLIC_ZERO_HISTORICAL_DATA=1 in `.env.local` and rebuild.
// (Off by default; only installs with imported history turn it on.)
export const FEATURES = {
  BANK_SYNC: false, // Approved column, pending section, approve workflow
  RECONCILIATION: false, // Cleared column + bulk clear action
  // (the standalone /reports/reconciliation page was deleted 2026-07-26 —
  //  superseded by reconcileAccountWithSnapshot on the account page)
  HISTORICAL_DATA: process.env.NEXT_PUBLIC_ZERO_HISTORICAL_DATA === "1", // Pre-cutoff year selectors, historical_snapshot reads, audit-grid, Reflect milestone surfaces (SEED-018)
} as const;
