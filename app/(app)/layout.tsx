import { AppShell } from "./app-shell";
import { getPayees } from "./transactions/actions";
import { catchUpDueSchedules } from "@/lib/schedules-catchup";
import { getDb, DEFAULT_USER_ID } from "@/lib/db";
import { mapRows } from "@/lib/db-utils";
import type { Account } from "@/lib/types";

// The (app) tree is a single-user, DB-backed surface — every page reads
// from SQLite per-request and many leaf components call useSearchParams().
// Static prerender was never meaningful here and Next.js 15 refuses to
// prerender pages whose subtree calls useSearchParams() without a Suspense
// wrapper. Forcing dynamic at the layout level covers the whole segment.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Post any due schedules before this layout reads balances below — otherwise
  // the sidebar renders pre-post balances on the very load that posts them.
  //
  // Lives here rather than on /schedules so "Auto-post when due" means what it
  // says: catch-up happens on app load regardless of which route you land on.
  // /schedules calls the same helper for the soft-navigation case; it's
  // request-cached, so a hard load of that route still scans only once.
  await catchUpDueSchedules();

  const db = getDb();

  const accounts = mapRows<Account>(
    db
      .prepare(
        "SELECT * FROM accounts WHERE user_id = ? AND archived = 0 ORDER BY sort_order"
      )
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );

  // Closed accounts come down as a SEPARATE list rather than widening the query
  // above. Every consumer downstream of `accounts` — QuickAdd, transfer plan,
  // the budget selection toolbar — assumes that prop is already free of
  // archived rows, and there are eight such filter sites. A second prop keeps
  // that assumption true and confines the change to the sidebar.
  //
  // Sorted by name, not sort_order: the Closed section has no drag handle, so
  // sort_order there is whatever it happened to be on the day it closed.
  const closedAccounts = mapRows<Account>(
    db
      .prepare(
        "SELECT * FROM accounts WHERE user_id = ? AND archived = 1 ORDER BY name COLLATE NOCASE"
      )
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );

  const uncategorizedRows = db
    .prepare(
      `SELECT account_id, COUNT(*) AS count FROM transactions
       WHERE user_id = ? AND category_id IS NULL AND is_split_parent = 0
         AND transfer_account_id IS NULL
       GROUP BY account_id`
    )
    .all(DEFAULT_USER_ID) as { account_id: string; count: number }[];
  const uncategorizedByAccount = Object.fromEntries(
    uncategorizedRows.map((r) => [r.account_id, r.count])
  );

  const categories = db
    .prepare(
      "SELECT id, name, category_group_id FROM categories WHERE user_id = ? AND archived = 0 ORDER BY sort_order"
    )
    .all(DEFAULT_USER_ID) as { id: string; name: string; category_group_id: string }[];

  const categoryGroups = (
    db
      .prepare(
        "SELECT id, name, is_income, is_system FROM category_groups WHERE user_id = ? ORDER BY sort_order"
      )
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  ).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    is_income: row.is_income === 1 || row.is_income === true,
    is_system: row.is_system === 1 || row.is_system === true,
  }));

  const payees = await getPayees();

  return (
    <AppShell
      accounts={accounts}
      closedAccounts={closedAccounts}
      uncategorizedByAccount={uncategorizedByAccount}
      categories={categories}
      categoryGroups={categoryGroups}
      payees={payees}
    >
      {children}
    </AppShell>
  );
}
