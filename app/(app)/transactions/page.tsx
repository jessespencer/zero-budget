import { Suspense } from "react";
import { cookies } from "next/headers";
import {
  getTransactions,
  getAccountsAndCategories,
  getPayees,
  countTransactionsOutsideRange,
  countUncategorizedTransactions,
} from "./actions";
import { TransactionsClient } from "@/components/transactions/transactions-client";
import { TransactionBanner } from "@/components/transactions/transaction-banner";
import { monthKeyToRange } from "@/lib/format";
import {
  parseTxRangeCookie,
  resolveTxRange,
  TX_RANGE_COOKIE_NAME,
} from "@/lib/tx-range-cookie";

type TransactionsPageProps = {
  searchParams: Promise<{
    search?: string;
    category?: string;
    sortBy?: string;
    sortDir?: string;
    start?: string;
    end?: string;
    date?: string;
    range?: string;
    import_source?: string;
    source_group?: string;
    source_category?: string;
  }>;
};

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  const params = await searchParams;

  // Default range comes from the user's last picked View filter (cookie).
  // Falls back to "this month" on first visit so we don't render every
  // transaction by surprise. URL params still override — that keeps the
  // audit grid's drill-down links working. Mirrors /accounts/[id].
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const cookieStore = await cookies();
  const parsedRange = parseTxRangeCookie(cookieStore.get(TX_RANGE_COOKIE_NAME)?.value);
  // Presets ("This month", etc.) re-resolve against `now` here, so the range
  // follows the calendar instead of freezing to the month it was picked in.
  const savedRange = parsedRange ? resolveTxRange(parsedRange, now) : null;
  const defaultRange = savedRange ?? { start: currentMonthKey, end: currentMonthKey };
  const isExplicitAll = params.range === "all";
  const effectiveStart = isExplicitAll ? null : (params.start ?? defaultRange.start);
  const effectiveEnd = isExplicitAll ? null : (params.end ?? defaultRange.end);

  const startRange = effectiveStart ? monthKeyToRange(effectiveStart) : null;
  const endRange = effectiveEnd ? monthKeyToRange(effectiveEnd) : null;

  // `?date=YYYY-MM-DD` drills to a single day (the insights Calendar tab links
  // here). It overrides the month range — the `t.date >= ? AND t.date <= ?`
  // filter already works at day precision; only the param parsing was month-locked.
  const singleDay =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;
  const filterStartDate = singleDay ?? startRange?.startDate;
  const filterEndDate = singleDay ?? endRange?.endDate;
  const importSource =
    params.import_source === "everydollar" || params.import_source === "ynab"
      ? params.import_source
      : undefined;

  const [
    transactions,
    { accounts, categories, categoryGroups, earliestTransactionYear },
    payees,
    hiddenCount,
    uncategorizedCount,
  ] = await Promise.all([
    getTransactions({
      search: params.search,
      categoryId: params.category,
      startDate: filterStartDate,
      endDate: filterEndDate,
      importSource,
      sourceGroup: params.source_group,
      sourceCategory: params.source_category,
      sortBy: params.sortBy as "date" | "account" | "payee" | "category" | "amount" | undefined,
      sortDir: params.sortDir as "asc" | "desc" | undefined,
    }),
    getAccountsAndCategories(),
    getPayees(),
    countTransactionsOutsideRange({
      categoryId: params.category,
      importSource,
      sourceGroup: params.source_group,
      sourceCategory: params.source_category,
      search: params.search,
      startDate: filterStartDate ?? null,
      endDate: filterEndDate ?? null,
    }),
    // All-time uncategorized count — deliberately ignores the active filter so
    // the banner surfaces out-of-range rows that need categorizing.
    countUncategorizedTransactions(),
  ]);

  const isFilteringUncategorized = params.category === "uncategorized";

  return (
    <div className="flex flex-col h-full">
      <Suspense>
        <TransactionBanner
          uncategorizedCount={uncategorizedCount}
          isFilteringUncategorized={isFilteringUncategorized}
        />
      </Suspense>
      <TransactionsClient
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        payees={payees}
        earliestTransactionYear={earliestTransactionYear}
        hiddenCount={hiddenCount}
        defaultRange={defaultRange}
        renderHeader
      />
    </div>
  );
}
