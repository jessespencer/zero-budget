"use client";

import { Sidebar } from "@/components/shared/sidebar";
import { useAutoCollapse } from "@/components/shared/use-auto-collapse";
import { QuickAdd } from "@/components/transactions/quick-add";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Account } from "@/lib/types";

type AppShellProps = {
  accounts: Account[];
  /**
   * Archived accounts, for the sidebar's Closed section. Deliberately separate
   * from `accounts` so nothing downstream (QuickAdd below, transfer plan,
   * budget toolbars) has to start filtering `archived` that wasn't already.
   */
  closedAccounts: Account[];
  uncategorizedByAccount: Record<string, number>;
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  payees: { id: string; name: string; default_category_id: string | null }[];
  children: React.ReactNode;
};

export function AppShell({
  accounts,
  closedAccounts,
  uncategorizedByAccount,
  categories,
  categoryGroups,
  payees,
  children,
}: AppShellProps) {
  const [collapsed, toggleCollapsed] = useAutoCollapse();

  const quickAddAccounts = accounts
    .filter((a) => !a.archived)
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      is_budget_account: a.is_budget_account,
    }));

  return (
    <ToastProvider>
      <div className="flex h-[calc(100dvh-var(--zero-banner-h,0px)-var(--zero-privacy-banner-h,0px))]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:bg-background focus:text-foreground focus:px-4 focus:py-2 focus:rounded-lg focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        {/* Shared provider so sweeping down the collapsed rail opens each
            next icon's tooltip instantly instead of re-waiting the delay. */}
        <TooltipProvider delay={300}>
          <Sidebar
            accounts={accounts}
            closedAccounts={closedAccounts}
            uncategorizedByAccount={uncategorizedByAccount}
            payees={payees}
            categories={categories}
            categoryGroups={categoryGroups}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapsed}
          />
        </TooltipProvider>
        <main id="main-content" className="flex-1 overflow-auto relative outline-none" tabIndex={-1}>
          {children}
          {/* Global FAB — bottom-right of main content */}
          <div className="fixed bottom-6 right-6 z-50">
            <QuickAdd
              accounts={quickAddAccounts}
              categories={categories}
              categoryGroups={categoryGroups}
              payees={payees}
              fab
            />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
