export type BudgetView = "grid" | "simple";

// A cookie rather than localStorage so the server renders the chosen view on
// first paint — no grid-then-simple flash on reload. Lives outside the
// "use client" toggle so budget/page.tsx can call parseBudgetView.
export const BUDGET_VIEW_COOKIE = "zero-budget-view";

export function parseBudgetView(value: string | undefined): BudgetView {
  return value === "simple" ? "simple" : "grid";
}

export function persistBudgetView(view: BudgetView) {
  document.cookie = `${BUDGET_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
}

// Whether the overview panel is docked at 1400px+. Below that it's always a
// drawer, so this only decides the wide layout. Cookie for the same no-flash
// reason as the view.
export const BUDGET_OVERVIEW_COOKIE = "zero-budget-overview";

export function parseOverviewDocked(value: string | undefined): boolean {
  return value !== "hidden";
}

export function persistOverviewDocked(docked: boolean) {
  document.cookie = `${BUDGET_OVERVIEW_COOKIE}=${docked ? "docked" : "hidden"}; path=/; max-age=31536000; samesite=lax`;
}
