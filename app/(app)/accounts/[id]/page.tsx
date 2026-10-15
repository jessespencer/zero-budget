import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAccountWithTransactions,
  getPayCardSourceAccounts,
  getStartingBalanceImpact,
} from "./actions";
import {
  getTransactions,
  getAccountsAndCategories,
  getPayees,
  countTransactionsOutsideRange,
  countUncategorizedTransactions,
} from "@/app/(app)/transactions/actions";
import { TransactionsClient } from "@/components/transactions/transactions-client";
import { TransactionBanner } from "@/components/transactions/transaction-banner";
import { Badge } from "@/components/ui/badge";
import { AccountMenu } from "@/components/accounts/account-menu";
import { PayCardButton } from "@/components/accounts/pay-card-button";
import { QuickAdd } from "@/components/transactions/quick-add";
import { Currency } from "@/components/shared/currency";
import { monthKeyToRange } from "@/lib/format";
import { roundCents } from "@/lib/db-utils";
import {
  parseTxRangeCookie,
  resolveTxRange,
  TX_RANGE_COOKIE_NAME,
} from "@/lib/tx-range-cookie";

type AccountPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    search?: string;
    category?: string;
    sortBy?: string;
    sortDir?: string;
    from?: string;
    start?: string;
    end?: string;
    range?: string;
  }>;
};

export default async function AccountPage({
  params,
  searchParams,
}: AccountPageProps) {
  const { id } = await params;
  const sp = await searchParams;

  // Default range comes from the user's last picked View filter (stored in
  // the zero:tx-range cookie). Falls back to "this month" on first visit so
  // we never render thousands of rows by surprise. URL params (?start, ?end,
  // ?range=all) still win — that keeps deep links from the audit grid intact.
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const cookieStore = await cookies();
  const parsedRange = parseTxRangeCookie(cookieStore.get(TX_RANGE_COOKIE_NAME)?.value);
  // Presets ("This month", etc.) re-resolve against `now` here, so the range
  // follows the calendar instead of freezing to the month it was picked in.
  const savedRange = parsedRange ? resolveTxRange(parsedRange, now) : null;
  const defaultRange = savedRange ?? { start: currentMonthKey, end: currentMonthKey };
  const isExplicitAll = sp.range === "all";
  const effectiveStart = isExplicitAll ? null : (sp.start ?? defaultRange.start);
  const effectiveEnd = isExplicitAll ? null : (sp.end ?? defaultRange.end);
  const startRange = effectiveStart ? monthKeyToRange(effectiveStart) : null;
  const endRange = effectiveEnd ? monthKeyToRange(effectiveEnd) : null;

  const [
    { account },
    transactions,
    { accounts, categories, categoryGroups, earliestTransactionYear },
    payees,
    hiddenCount,
    payCardSourceAccounts,
    uncategorizedCount,
    startingBalanceImpact,
  ] = await Promise.all([
    getAccountWithTransactions(id),
    getTransactions({
      accountId: id,
      search: sp.search,
      categoryId: sp.category,
      startDate: startRange?.startDate,
      endDate: endRange?.endDate,
      sortBy: sp.sortBy as "date" | "account" | "payee" | "category" | "amount" | undefined,
      sortDir: sp.sortDir as "asc" | "desc" | undefined,
    }),
    getAccountsAndCategories(),
    getPayees(),
    countTransactionsOutsideRange({
      accountId: id,
      categoryId: sp.category,
      search: sp.search,
      startDate: startRange?.startDate ?? null,
      endDate: endRange?.endDate ?? null,
    }),
    getPayCardSourceAccounts(id),
    // All-time uncategorized count for this account — ignores the active
    // filter so the banner surfaces out-of-range rows that need categorizing.
    countUncategorizedTransactions(id),
    // Drives the figure in the Convert confirm. Cheap (one indexed SUM) and
    // needed on first paint, so it rides along here rather than loading when
    // the dialog opens.
    getStartingBalanceImpact(id),
  ]);

  if (!account) notFound();

  const balance = Number(account.current_balance);
  // Round to cents before driving the color so float drift (-1e-9) doesn't
  // paint a zero balance red. Mirrors what formatCurrency displays.
  const balanceCents = roundCents(balance);
  const isFilteringUncategorized = sp.category === "uncategorized";
  const cameFromInsights = sp.from === "insights";

  return (
    <div className="flex flex-col h-full">
      <Suspense>
        <TransactionBanner
          uncategorizedCount={uncategorizedCount}
          isFilteringUncategorized={isFilteringUncategorized}
        />
      </Suspense>

      {/* Account header */}
      {/* 88px like every other page header, so switching pages doesn't jump. */}
      <div className="flex items-center justify-between px-6 h-[88px] border-b border-border bg-accent/40">
        <div className="flex items-center gap-3">
          {cameFromInsights && (
            <Link
              href="/insights"
              aria-label="Back to insights"
              className="size-8 rounded-md inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
          )}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <h1 className="page-title leading-none">{account.name}</h1>
              <Badge className="uppercase tracking-[0.06em]">
                {account.type.replace("_", " ")}
              </Badge>
              {/* Closing no longer navigates away, so this is what tells the
                  user the button worked. It's also the only marker if they
                  arrive here from the sidebar's Closed section. */}
              {account.archived ? (
                <Badge intent="warning" className="uppercase tracking-[0.06em]">
                  Closed
                </Badge>
              ) : null}
            </div>
            <div
              className={cn(
                "text-[15px] font-medium tabular-nums tracking-[-0.01em] leading-none",
                balanceCents >= 0 ? "text-muted-foreground" : "text-negative"
              )}
            >
              {/* Scoped to the account so switching accounts doesn't flash. */}
              <Currency amount={balance} colorize={false} smallCents={false} flash={id} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AccountMenu
            account={account}
            transactionCount={transactions.length}
            triggerVariant="kebab"
            categories={categories}
            categoryGroups={categoryGroups}
            startingBalanceImpact={startingBalanceImpact}
          />
          {account.type === "credit_card" && (
            <PayCardButton
              cardId={account.id}
              cardName={account.name}
              currentBalance={Number(account.current_balance)}
              sourceAccounts={payCardSourceAccounts}
            />
          )}
          <QuickAdd
            accounts={accounts}
            categories={categories}
            categoryGroups={categoryGroups}
            payees={payees}
          />
        </div>
      </div>

      <TransactionsClient
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        payees={payees}
        lockedAccountId={account.id}
        earliestTransactionYear={earliestTransactionYear}
        hiddenCount={hiddenCount}
        defaultRange={defaultRange}
      />
    </div>
  );
}
