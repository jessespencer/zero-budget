import { Suspense } from "react";
import { cookies } from "next/headers";
import { getMonthKey } from "@/lib/format";
import { getBudgetData } from "./actions";
import { computeBudgetMonth } from "@/lib/budget-engine";
import { getDb, DEFAULT_USER_ID } from "@/lib/db";
import { mapRows } from "@/lib/db-utils";
import type { Account } from "@/lib/types";
import { BudgetHeader } from "@/components/budget/budget-header";
import { BudgetTable } from "@/components/budget/budget-table";
import { SetupChecklist } from "@/components/budget/setup-checklist";
import { getOnboardingState } from "@/lib/onboarding";
import {
  BUDGET_OVERVIEW_COOKIE,
  BUDGET_VIEW_COOKIE,
  parseBudgetView,
  parseOverviewDocked,
} from "@/components/budget/budget-view";

// Pre-hydration script: reads the user's collapsed-groups preference from
// localStorage and injects a <style> tag before the table HTML is parsed,
// so the initial paint reflects collapsed state. Without this, the SSR'd
// markup (everything expanded) flashes briefly before React hydrates and
// the layout effect inside BudgetTable applies the saved state.
//
// Only emits CSS rules for UUIDs that match the standard category id
// pattern — defensive against any tampered localStorage value.
const PRE_HYDRATE_SCRIPT = `
(function () {
  try {
    var raw = localStorage.getItem('zero:budget:expanded-groups');
    if (!raw) return;
    var stored = JSON.parse(raw);
    var rules = [];
    var safe = /^[a-zA-Z0-9-]+$/;
    for (var id in stored) {
      if (stored[id] === false && safe.test(id)) {
        // Hide the children container.
        rules.push('[data-budget-group="' + id + '"] [data-budget-group-children]{display:none}');
        // Un-rotate the chevron — the SSR'd HTML applies rotate-90 because
        // the React state defaults to expanded; without this the caret
        // briefly points down before hydration reverts it.
        rules.push('[data-budget-group="' + id + '"] [data-budget-group-chevron]{transform:none}');
      }
    }
    if (!rules.length) return;
    var style = document.createElement('style');
    style.setAttribute('data-budget-prehydrate', '');
    style.textContent = rules.join('');
    document.head.appendChild(style);
  } catch (e) { /* ignore */ }
})();
`;

type BudgetPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function BudgetPage({ searchParams }: BudgetPageProps) {
  const params = await searchParams;
  const month = params.month || getMonthKey();
  const cookieStore = await cookies();
  const initialView = parseBudgetView(cookieStore.get(BUDGET_VIEW_COOKIE)?.value);
  const initialOverviewDocked = parseOverviewDocked(
    cookieStore.get(BUDGET_OVERVIEW_COOKIE)?.value
  );
  const data = await getBudgetData(month);
  const budget = computeBudgetMonth(data);
  const db = getDb();
  const accounts = mapRows<Account>(
    db.prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY sort_order")
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );
  // Aggregate active credit-card debt for the header indicator. Stored as a
  // negative number (post-260515-k43); the header displays |creditCardDebt|
  // and hides when >= 0 (no cards, no debt, or — defensively — paid ahead).
  const creditCardDebt = (
    db
      .prepare(
        "SELECT COALESCE(SUM(current_balance), 0) AS total FROM accounts WHERE user_id = ? AND type = 'credit_card' AND archived = 0"
      )
      .get(DEFAULT_USER_ID) as { total: number }
  ).total;
  const onboarding = getOnboardingState();

  return (
    <div className="flex flex-col h-full">
      <script dangerouslySetInnerHTML={{ __html: PRE_HYDRATE_SCRIPT }} />
      <Suspense>
        <BudgetHeader
          readyToAssign={budget.readyToAssign}
          creditCardDebt={creditCardDebt}
          month={budget.month}
          currentMonthIncome={budget.currentMonthIncome}
          currentMonthAssigned={budget.currentMonthAssigned}
          currentMonthActivity={budget.groups
            .flatMap((g) => g.categories)
            .reduce((sum, c) => sum + c.activity, 0)}
          totalIncome={budget.totalIncome}
          totalAssigned={budget.totalAssigned}
          overspentLastMonth={budget.overspentLastMonth}
          openingCcDebt={budget.openingCcDebt}
          futureAssigned={budget.futureAssigned}
        />
      </Suspense>
      {onboarding && (
        <SetupChecklist
          state={onboarding}
          readyToAssign={budget.readyToAssign}
          totalIncome={budget.totalIncome}
        />
      )}
      <BudgetTable
        budget={budget}
        accounts={accounts}
        initialView={initialView}
        initialOverviewDocked={initialOverviewDocked}
      />
    </div>
  );
}
