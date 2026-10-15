import type {
  BudgetMonth,
  Category,
  CategoryGroup,
  CategoryGroupWithCategories,
  CategoryWithBudget,
  MonthlyBudget,
  Target,
  Transaction,
  TransactionSplit,
} from "./types";
import { STARTING_BALANCE_CATEGORY_ID } from "./db";
import { availableCents } from "./db-utils";

// Trailing-window length for the Auto-assign panel's "Average assigned/spent"
// suggestions. Mirrors the (now-removed) per-category server action.
const AUTO_ASSIGN_AVG_MONTHS = 3;

export type BudgetInput = {
  month: string; // "2026-04-01"
  categoryGroups: CategoryGroup[];
  categories: Category[];
  monthlyBudgets: MonthlyBudget[]; // ALL months, incl. future — future-month rows feed `futureAssigned`
  transactions: Transaction[]; // ALL transactions up to end of current month
  splits: TransactionSplit[];
  targets: Target[];
  // Earliest month the budget engine treats as "live" envelope data. Anything
  // with date/month strictly before this is historical and invisible to
  // available, RTA, totalAssigned, totalIncome, and the overspending cascade.
  // Omit to disable the cutoff (default for tests; production passes the
  // app_settings value via lib/app-settings.ts).
  budgetStartMonth?: string;
  // User-entered income forecast for this month, or null/undefined when unset.
  // Passed straight through to BudgetMonth.expectedIncome — the engine does no
  // math with it (it's a display/planning value, not part of RTA).
  expectedIncome?: number | null;
};

/**
 * Core budget computation. This implements the envelope mechanic:
 *
 * - Available = cumulative assigned + cumulative activity (rolls over month to month)
 * - Ready to Assign = total income - total assigned - overspent deduction
 * - Overspent categories from prior month deduct from Ready to Assign
 */
export function computeBudgetMonth(input: BudgetInput): BudgetMonth {
  const {
    month,
    categoryGroups,
    categories,
    monthlyBudgets,
    transactions,
    splits,
    targets,
    budgetStartMonth,
    expectedIncome,
  } = input;

  // Sentinel that compares "less than every real ISO date" when no cutoff is
  // configured — keeps every guard below as a simple `>= cutoff` check.
  const cutoff = budgetStartMonth ?? "0000-01-01";

  const monthDate = new Date(month + "T00:00:00");
  const monthEnd = new Date(monthDate);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setDate(0); // last day of current month

  const prevMonthDate = new Date(monthDate);
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);

  const monthStr = month;
  const monthEndStr = formatDateStr(monthEnd);
  const prevMonthStr = formatDateStr(prevMonthDate);

  // Build target lookup
  const targetMap = new Map<string, Target>();
  for (const t of targets) {
    targetMap.set(t.category_id, t);
  }

  // Find income category group
  const incomeGroupIds = new Set(
    categoryGroups.filter((g) => g.is_income).map((g) => g.id)
  );
  const incomeCategoryIds = new Set(
    categories.filter((c) => incomeGroupIds.has(c.category_group_id)).map((c) => c.id)
  );

  // ── Per-category calculations ──────────────────────────

  // Build transaction lookup for O(1) split parent resolution
  const txnById = new Map<string, Transaction>();
  for (const txn of transactions) {
    txnById.set(txn.id, txn);
  }

  // Activity for the current month per category
  const currentMonthActivity = new Map<string, number>();
  // Cumulative activity (all time through end of current month) per category
  const cumulativeActivity = new Map<string, number>();

  for (const txn of transactions) {
    if (txn.is_split_parent) continue; // splits handled separately

    const catId = txn.category_id;
    if (!catId) continue;

    const txnDate = txn.date;
    if (txnDate < cutoff) continue;
    const amount = Number(txn.amount);

    // Cumulative (all time up through current month)
    if (txnDate <= monthEndStr) {
      cumulativeActivity.set(catId, (cumulativeActivity.get(catId) ?? 0) + amount);
    }

    // Current month only
    if (txnDate >= monthStr && txnDate <= monthEndStr) {
      currentMonthActivity.set(catId, (currentMonthActivity.get(catId) ?? 0) + amount);
    }
  }

  // Handle splits
  for (const split of splits) {
    const parent = txnById.get(split.parent_transaction_id);
    if (!parent) continue;
    if (!split.category_id) continue;

    const txnDate = parent.date;
    if (txnDate < cutoff) continue;
    const amount = Number(split.amount);
    const catId = split.category_id;

    if (txnDate <= monthEndStr) {
      cumulativeActivity.set(catId, (cumulativeActivity.get(catId) ?? 0) + amount);
    }

    if (txnDate >= monthStr && txnDate <= monthEndStr) {
      currentMonthActivity.set(catId, (currentMonthActivity.get(catId) ?? 0) + amount);
    }
  }

  // Cumulative assigned per category (all months up to and including current)
  const cumulativeAssigned = new Map<string, number>();
  // Current month assigned
  const currentMonthAssigned = new Map<string, number>();

  for (const mb of monthlyBudgets) {
    if (mb.month < cutoff) continue;
    const amount = Number(mb.assigned);
    if (mb.month <= monthStr) {
      cumulativeAssigned.set(
        mb.category_id,
        (cumulativeAssigned.get(mb.category_id) ?? 0) + amount
      );
    }
    if (mb.month === monthStr) {
      currentMonthAssigned.set(mb.category_id, amount);
    }
  }

  // ── Overspent from prior month ─────────────────────────

  // To calculate overspent from prior month, we need available at end of prior month
  // Available at end of prior month = cumulative assigned through prior month + cumulative activity through prior month
  let overspentLastMonth = 0;

  if (prevMonthStr >= "2000-01-01") {
    const prevMonthEnd = new Date(monthDate);
    prevMonthEnd.setDate(0); // last day of previous month
    const prevMonthEndStr = formatDateStr(prevMonthEnd);

    // Pre-aggregate assigned through previous month per category
    const prevCumAssignedMap = new Map<string, number>();
    for (const mb of monthlyBudgets) {
      if (mb.month < cutoff) continue;
      if (mb.month <= prevMonthStr) {
        prevCumAssignedMap.set(
          mb.category_id,
          (prevCumAssignedMap.get(mb.category_id) ?? 0) + Number(mb.assigned)
        );
      }
    }

    // Pre-aggregate activity through previous month per category
    const prevCumActivityMap = new Map<string, number>();
    for (const txn of transactions) {
      if (txn.is_split_parent) continue;
      if (txn.date < cutoff) continue;
      if (txn.category_id && txn.date <= prevMonthEndStr) {
        prevCumActivityMap.set(
          txn.category_id,
          (prevCumActivityMap.get(txn.category_id) ?? 0) + Number(txn.amount)
        );
      }
    }
    for (const split of splits) {
      const parent = txnById.get(split.parent_transaction_id);
      if (!split.category_id) continue;
      if (!parent || parent.date < cutoff) continue;
      if (parent.date <= prevMonthEndStr) {
        prevCumActivityMap.set(
          split.category_id,
          (prevCumActivityMap.get(split.category_id) ?? 0) + Number(split.amount)
        );
      }
    }

    const systemCategoryIds = new Set(
      categories
        .filter((c) =>
          categoryGroups.some((g) => g.id === c.category_group_id && g.is_system)
        )
        .map((c) => c.id)
    );

    for (const cat of categories) {
      if (incomeCategoryIds.has(cat.id)) continue;
      if (systemCategoryIds.has(cat.id)) continue;
      // Round before the sign test (see availableCents): a category funded to
      // exactly break-even lands at ~-1e-13, and summing those residuals across
      // every category deducted ghost sub-cents from Ready to Assign. The
      // rounded value is also what gets accumulated, so the deduction matches
      // the overspend the grid displays.
      const prevAvailable = availableCents(
        (prevCumAssignedMap.get(cat.id) ?? 0) + (prevCumActivityMap.get(cat.id) ?? 0)
      );
      if (prevAvailable < 0) {
        overspentLastMonth += Math.abs(prevAvailable);
      }
    }
  }

  // ── Opening credit-card debt ──────────────────────────
  //
  // Symmetric counterpart to the cash-side income flow. Cash account starting
  // balances are stamped READY_TO_ASSIGN_CATEGORY_ID and live in an is_income
  // group, so they're already swept into `totalIncome` below. Credit-card
  // opening debts are stamped STARTING_BALANCE_CATEGORY_ID (a system,
  // non-income category — see migration 017 / quick task 260515-n1a), which
  // means without this subtraction they are invisible to the engine. Without
  // it, RTA overstates by the sum of opening CC debts (seen in practice: a
  // card opened with a large debt and RTA was off by exactly that amount).
  //
  // Money is REAL per CLAUDE.md — accumulate raw floats here, round only at
  // display time.
  let openingCcDebt = 0;
  for (const txn of transactions) {
    if (txn.is_split_parent) continue;
    if (txn.category_id !== STARTING_BALANCE_CATEGORY_ID) continue;
    if (txn.date < cutoff) continue;
    const amount = Number(txn.amount);
    if (amount >= 0) continue;
    if (txn.date > monthEndStr) continue;
    openingCcDebt += Math.abs(amount);
  }

  // ── Auto-assign metrics (historical assign/spend windows) ──────────
  //
  // Backs the category panel's Auto-assign suggestions. Computed here from the
  // arrays the engine already holds, so the panel needs no per-click fetch.
  // Windows match the previous per-category SQL exactly and stay cutoff-agnostic
  // (history before budgetStartMonth still informs suggestions, as it did when
  // this was a raw query):
  //   last month:      month == prevMonthStr / date in [prevMonthStr, monthStr)
  //   trailing window: month/date in [windowStartStr, monthStr)  (3 months)
  const windowStartDate = new Date(monthDate);
  windowStartDate.setMonth(windowStartDate.getMonth() - AUTO_ASSIGN_AVG_MONTHS);
  const windowStartStr = formatDateStr(windowStartDate);

  const assignedLastByCat = new Map<string, number>();
  const assignedWindowByCat = new Map<string, number>();
  for (const mb of monthlyBudgets) {
    const amount = Number(mb.assigned);
    if (mb.month === prevMonthStr) {
      assignedLastByCat.set(mb.category_id, (assignedLastByCat.get(mb.category_id) ?? 0) + amount);
    }
    if (mb.month >= windowStartStr && mb.month < monthStr) {
      assignedWindowByCat.set(mb.category_id, (assignedWindowByCat.get(mb.category_id) ?? 0) + amount);
    }
  }

  const spentLastByCat = new Map<string, number>();
  const spentWindowByCat = new Map<string, number>();
  const addSpend = (catId: string, date: string, amount: number) => {
    if (date >= prevMonthStr && date < monthStr) {
      spentLastByCat.set(catId, (spentLastByCat.get(catId) ?? 0) + amount);
    }
    if (date >= windowStartStr && date < monthStr) {
      spentWindowByCat.set(catId, (spentWindowByCat.get(catId) ?? 0) + amount);
    }
  };
  for (const txn of transactions) {
    if (txn.is_split_parent) continue;
    if (!txn.category_id) continue;
    addSpend(txn.category_id, txn.date, Number(txn.amount));
  }
  for (const split of splits) {
    if (!split.category_id) continue;
    const parent = txnById.get(split.parent_transaction_id);
    if (!parent) continue;
    addSpend(split.category_id, parent.date, Number(split.amount));
  }

  // ── Build category rows ────────────────────────────────

  const categoryRows = new Map<string, CategoryWithBudget>();

  for (const cat of categories) {
    const assigned = currentMonthAssigned.get(cat.id) ?? 0;
    const activity = currentMonthActivity.get(cat.id) ?? 0;
    const available =
      (cumulativeAssigned.get(cat.id) ?? 0) + (cumulativeActivity.get(cat.id) ?? 0);

    categoryRows.set(cat.id, {
      ...cat,
      assigned,
      activity,
      available,
      cumulative_assigned: cumulativeAssigned.get(cat.id) ?? 0,
      target: targetMap.get(cat.id) ?? null,
      autoAssign: {
        assignedLastMonth: assignedLastByCat.get(cat.id) ?? 0,
        spentLastMonth: Math.max(0, -(spentLastByCat.get(cat.id) ?? 0)),
        averageAssigned: (assignedWindowByCat.get(cat.id) ?? 0) / AUTO_ASSIGN_AVG_MONTHS,
        averageSpent: Math.max(0, -(spentWindowByCat.get(cat.id) ?? 0) / AUTO_ASSIGN_AVG_MONTHS),
      },
    });
  }

  // ── Build group rows ───────────────────────────────────

  const groups: CategoryGroupWithCategories[] = categoryGroups
    .filter((g) => !g.is_income && !g.is_system && !g.archived)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((group) => {
      const groupCategories = categories
        .filter((c) => c.category_group_id === group.id && !c.archived)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => categoryRows.get(c.id)!)
        .filter(Boolean);

      return {
        ...group,
        categories: groupCategories,
        groupAssigned: groupCategories.reduce((sum, c) => sum + c.assigned, 0),
        groupActivity: groupCategories.reduce((sum, c) => sum + c.activity, 0),
        groupAvailable: groupCategories.reduce((sum, c) => sum + c.available, 0),
      };
    });

  // ── Hidden (archived) categories ───────────────────────
  //
  // Archived categories vanish from the active group loop above (line ~269
  // filters !c.archived). Surface them here for the grid's "Hidden categories"
  // group. Same exclusions as the active loop: skip income and system groups
  // (a category is system if its group has is_system). Each carries its full
  // budget data from the categoryRows Map (built over ALL categories above).
  const systemGroupIds = new Set(
    categoryGroups.filter((g) => g.is_system).map((g) => g.id)
  );

  // ── Hidden (archived) groups ───────────────────────────
  //
  // A group hidden via category_groups.archived=1 disappears from the active
  // grid (filtered above) and is surfaced here as a whole block. We list EVERY
  // child (active AND individually-archived) because the entire group is hidden,
  // so a child has no visible group to live under. Group totals computed like
  // the active loop (:277-279). Build this FIRST so we can dedupe the flat
  // hiddenCategories list against it.
  const hiddenGroups: CategoryGroupWithCategories[] = categoryGroups
    .filter((g) => !g.is_income && !g.is_system && g.archived)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((group) => {
      const groupCategories = categories
        .filter((c) => c.category_group_id === group.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => categoryRows.get(c.id)!)
        .filter(Boolean);

      return {
        ...group,
        categories: groupCategories,
        groupAssigned: groupCategories.reduce((sum, c) => sum + c.assigned, 0),
        groupActivity: groupCategories.reduce((sum, c) => sum + c.activity, 0),
        groupAvailable: groupCategories.reduce((sum, c) => sum + c.available, 0),
      };
    });

  const hiddenGroupIds = new Set(hiddenGroups.map((g) => g.id));

  // Flat hidden categories: individually-archived categories whose GROUP is
  // still visible. Excludes children of hidden groups (deduped above) so a
  // category does not double-appear while its group is hidden. Once the group
  // is unhidden it leaves hiddenGroups, the dedupe lifts, and a still-archived
  // child correctly returns to this flat list — no bookkeeping required.
  const hiddenCategories: CategoryWithBudget[] = categories
    .filter(
      (c) =>
        c.archived &&
        !incomeGroupIds.has(c.category_group_id) &&
        !systemGroupIds.has(c.category_group_id) &&
        !hiddenGroupIds.has(c.category_group_id)
    )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => categoryRows.get(c.id)!)
    .filter(Boolean);

  // ── Ready to Assign ────────────────────────────────────

  // Total income = all positive transactions in income categories, all time through current month
  let totalIncome = 0;
  for (const txn of transactions) {
    if (txn.is_split_parent) continue;
    if (txn.date < cutoff) continue;
    if (txn.category_id && incomeCategoryIds.has(txn.category_id) && txn.date <= monthEndStr) {
      totalIncome += Number(txn.amount);
    }
  }

  // Total assigned = sum of all assigned across all non-income categories, all months through current
  let totalAssigned = 0;
  for (const mb of monthlyBudgets) {
    if (mb.month < cutoff) continue;
    if (mb.month <= monthStr && !incomeCategoryIds.has(mb.category_id)) {
      totalAssigned += Number(mb.assigned);
    }
  }

  // Future-month assignments = non-income assignments in months strictly AFTER
  // the current month. Same cutoff + income-exclusion guards as totalAssigned;
  // only the month comparison flips to strictly-after. Raw float sum (no
  // intermediate rounding — money-as-float discipline). Clamp to >=0 so a
  // net-negative future can't inflate an earlier month.
  let futureAssignedRaw = 0;
  for (const mb of monthlyBudgets) {
    if (mb.month < cutoff) continue;
    if (mb.month > monthStr && !incomeCategoryIds.has(mb.category_id)) {
      futureAssignedRaw += Number(mb.assigned);
    }
  }
  const futureAssigned = Math.max(0, futureAssignedRaw);

  // Single pool: a positive Ready-to-assign drains toward zero by money
  // already assigned in later months, floored at zero. A genuinely over-assigned
  // current month (cur < 0) keeps its true negative — never floored.
  const cur = totalIncome - totalAssigned - overspentLastMonth - openingCcDebt;
  const readyToAssign = cur < 0 ? cur : Math.max(0, cur - futureAssigned);

  // Current month income = activity in income categories for this month only
  let currentMonthIncome = 0;
  for (const catId of incomeCategoryIds) {
    currentMonthIncome += currentMonthActivity.get(catId) ?? 0;
  }

  // Current month assigned = sum of assignments made in this month only,
  // excluding income categories — matches the totalAssigned exclusion so the
  // popover's signed-decomposition identity holds at integer-cent precision.
  let currentMonthAssignedSum = 0;
  for (const [catId, amount] of currentMonthAssigned) {
    if (incomeCategoryIds.has(catId)) continue;
    currentMonthAssignedSum += amount;
  }

  return {
    month: monthStr,
    readyToAssign,
    groups,
    hiddenCategories,
    hiddenGroups,
    totalIncome,
    totalAssigned,
    overspentLastMonth,
    currentMonthIncome,
    currentMonthAssigned: currentMonthAssignedSum,
    expectedIncome: expectedIncome ?? null,
    openingCcDebt,
    futureAssigned,
  };
}

function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
