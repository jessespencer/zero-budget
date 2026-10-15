"use client";

import { FlashOnChange } from "./flash-on-change";
import { useEffect, useState, useTransition } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { roundCents } from "@/lib/db-utils";
import { APP_VERSION, AUTHOR_NAME, AUTHOR_URL } from "@/lib/version";
import { SettingsMenu } from "./settings-menu";
import { AboutDialog } from "./about-dialog";
import {
  LayoutGrid,
  PieChart,
  Receipt,
  CalendarClock,
  ArrowLeftRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ArchiveRestore,
  Plus,
  Loader2,
} from "lucide-react";
import type { Account, AccountType } from "@/lib/types";
import { AccountMenu } from "@/components/accounts/account-menu";
import { AddAccountDialog } from "@/components/accounts/add-account-dialog";
import { reopenAccount } from "@/app/(app)/accounts/[id]/actions";
import { useToast } from "@/components/ui/toast";
import { TruncatedText } from "./truncated-text";
import { SidebarTooltip } from "./sidebar-tooltip";

type SidebarProps = {
  accounts: Account[];
  /** Archived accounts — rendered in the collapsed "Closed" section. */
  closedAccounts: Account[];
  uncategorizedByAccount: Record<string, number>;
  // Threaded straight through to the footer SettingsMenu (Manage payees dialog).
  payees: { id: string; name: string; default_category_id: string | null }[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
  collapsed: boolean;
  onToggleCollapse: () => void;
};

const navItems = [
  { href: "/budget", label: "Budget", icon: LayoutGrid },
  { href: "/insights", label: "Insights", icon: PieChart },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/schedules", label: "Schedules", icon: CalendarClock },
  { href: "/transfer-plan", label: "Transfer plan", icon: ArrowLeftRight },
];

// Canonical render order for sidebar sections. Sentence-case titles per
// CLAUDE.md. Checking, cash, and savings are merged into one "Cash" section
// since they're all spendable cash to the user. Within each section,
// accounts sort alphabetically by name.
//
// "closed" is a SectionKey for the open/collapsed state only — it groups by
// `archived`, not by account type, so it has no SECTION_ORDER entry and never
// appears in `grouped`.
type TypeSectionKey = "cash" | "credit_card" | "other";
type SectionKey = TypeSectionKey | "closed";
const SECTION_ORDER: { key: TypeSectionKey; title: string; types: AccountType[] }[] = [
  { key: "cash", title: "Cash", types: ["checking", "cash", "savings"] },
  { key: "credit_card", title: "Credit card", types: ["credit_card"] },
  { key: "other", title: "Other", types: ["other"] },
];

export function Sidebar({ accounts, closedAccounts, uncategorizedByAccount, payees, categories, categoryGroups, collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [, startTransition] = useTransition();
  const { toast } = useToast();
  // "closed" starts collapsed — it's an archive, not part of the daily view.
  const [sectionOpen, setSectionOpen] = useState<Record<SectionKey, boolean>>(() => ({
    cash: true,
    credit_card: true,
    other: true,
    closed: false,
  }));

  // Reopening is reversible and its effect lands somewhere the user isn't
  // looking (the account jumps back to its type section, which may be scrolled
  // out of view or collapsed), so the toast is the acknowledgement. Not
  // destructive, so no confirm and no undo entry — closing again is the undo.
  const handleReopen = (account: Account) => {
    startTransition(async () => {
      try {
        const result = await reopenAccount(account.id);
        if (result.ok === false) {
          toast({ message: `Couldn't reopen ${account.name}`, variant: "error" });
          return;
        }
        toast({ message: `${account.name} reopened` });
      } catch {
        toast({ message: `Couldn't reopen ${account.name}`, variant: "error" });
      }
    });
  };

  // 260517-vxf: include tracking-only accounts inline within their existing
  // type section. No visual differentiation in the sidebar — once configured,
  // tracking accounts behave like any other account (transactions hit the
  // budget normally; only the starting balance is excluded from RTA). The
  // "Tracking only" chip in the account header is the one place we surface
  // the state.
  const visibleAccounts = accounts.filter((a) => !a.archived);

  const grouped: Record<TypeSectionKey, Account[]> = {
    cash: [],
    credit_card: [],
    other: [],
  };
  for (const section of SECTION_ORDER) {
    const typeSet = new Set(section.types);
    grouped[section.key] = visibleAccounts
      .filter((a) => typeSet.has(a.type))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  // Arriving at an account (from Insights, a link, the URL bar) whose section
  // is collapsed used to leave it hidden — open that section so the active row
  // is actually there to see. Runs on navigation only, so a section the user
  // collapses afterwards stays collapsed.
  const activeAccountId = pathname.startsWith("/accounts/")
    ? pathname.slice("/accounts/".length)
    : null;
  useEffect(() => {
    if (!activeAccountId) return;
    const key: SectionKey | undefined = closedAccounts.some((a) => a.id === activeAccountId)
      ? "closed"
      : SECTION_ORDER.find(({ key }) => grouped[key].some((a) => a.id === activeAccountId))?.key;
    if (key) setSectionOpen((s) => (s[key] ? s : { ...s, [key]: true }));
    // Only on navigation — not when balances (and so `grouped`) refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId]);

  return (
    <aside
      className={cn(
        "flex flex-col h-full sticky top-[calc(var(--zero-banner-h,0px)+var(--zero-privacy-banner-h,0px))] bg-sidebar border-r border-sidebar-border overflow-hidden transition-[width] duration-200",
        collapsed ? "w-[60px]" : "w-[260px]"
      )}
    >
      {/* Logo + collapse toggle */}
      <div className={cn("flex items-center justify-between pt-5 pb-4 h-[68px]", collapsed ? "px-0 justify-center" : "px-5")}>
        {collapsed ? (
          <SidebarTooltip label="Expand sidebar" collapsed>
            <button
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0 text-primary hover:bg-primary/25 transition-colors mx-auto"
            >
              <ChevronsRight className="h-6 w-6" aria-hidden="true" />
            </button>
          </SidebarTooltip>
        ) : (
          <>
            <Link href="/budget" className="flex items-center gap-2.5">
              {/* The Z disc, matching the launch site's header (site/styles.css
                  .brand-mark): dark green, lime ring and glow. The sidebar is
                  dark in both themes, so the fixed greens hold up in light mode. */}
              <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-[radial-gradient(circle_at_30%_25%,#1f3a16,#0c180a)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_35%,transparent),0_0_18px_-4px_color-mix(in_oklch,var(--primary)_55%,transparent)]">
                <span className="text-primary font-extrabold text-[15px] leading-none">Z</span>
              </div>
              <span className="text-[15px] font-semibold tracking-[-0.01em] text-sidebar-foreground">
                Zero
              </span>
            </Link>
            <button
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              className="text-sidebar-foreground-muted hover:text-sidebar-foreground transition-colors"
            >
              <ChevronsLeft className="h-6 w-6" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" className="space-y-0.5 px-3">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <SidebarTooltip key={item.href} label={item.label} collapsed={collapsed}>
              <Link
                href={item.href}
                aria-label={collapsed ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center rounded-full text-[15px] font-medium transition-colors h-14",
                  collapsed ? "justify-center px-0" : "gap-3 px-3",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <Icon className="h-6 w-6 shrink-0" strokeWidth={isActive ? 2 : 1.5} aria-hidden="true" />
                {!collapsed && item.label}
                {!collapsed && <NavPendingSpinner />}
              </Link>
            </SidebarTooltip>
          );
        })}
      </nav>

      {/* Divider */}
      <div className={cn("my-3 h-px bg-sidebar-border", collapsed ? "mx-2" : "mx-5")} />

      {/* Accounts */}
      {!collapsed && (
        <div className="flex-1 px-3 overflow-auto">
          {SECTION_ORDER.map(({ key, title }) => {
            const list = grouped[key];
            if (list.length === 0) return null;
            const total = list.reduce((sum, a) => sum + Number(a.current_balance), 0);
            return (
              <AccountAccordion
                key={key}
                title={title}
                accounts={list}
                total={total}
                open={sectionOpen[key]}
                onToggle={() => setSectionOpen((s) => ({ ...s, [key]: !s[key] }))}
                pathname={pathname}
                uncategorizedByAccount={uncategorizedByAccount}
              />
            );
          })}
          {/* Closed accounts. Renders a count, not a total: everything in here
              is zeroed on the way out, so a "$0.00" total would be noise. Same
              treatment as the Hidden section on /budget. */}
          {closedAccounts.length > 0 && (
            <AccountAccordion
              title="Closed"
              accounts={closedAccounts}
              count={closedAccounts.length}
              open={sectionOpen.closed}
              onToggle={() =>
                setSectionOpen((s) => ({ ...s, closed: !s.closed }))
              }
              pathname={pathname}
              uncategorizedByAccount={uncategorizedByAccount}
              onReopen={handleReopen}
            />
          )}
          <button
            onClick={() => setAddAccountOpen(true)}
            className="flex items-center gap-1.5 px-3 w-full rounded-full text-[14px] font-normal h-9 text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-colors"
          >
            <Plus className="h-4 w-4 shrink-0" />
            Add account
          </button>
        </div>
      )}

      {collapsed && <div className="flex-1" />}

      {/* Footer */}
      {/* No space-y here: Base UI appends hidden focus-guard spans next to the
          trigger while its menu is open, and space-y's margin on the no-longer-last
          button shifts the footer 4px on every open/close. */}
      <div className={cn("p-3 border-t border-sidebar-border", collapsed && "flex flex-col items-center")}>
        <SettingsMenu
          collapsed={collapsed}
          payees={payees}
          categories={categories}
          categoryGroups={categoryGroups}
          onOpenAbout={() => setAboutOpen(true)}
        />
        {/* Version + author credit. Margin lives on this div rather than a
            parent space-y for the focus-guard reason above. */}
        <div
          className={cn(
            "mt-1 text-[11px] leading-none text-sidebar-foreground-muted",
            collapsed ? "text-center" : "px-3 truncate"
          )}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              title={`Zero v${APP_VERSION} — built by ${AUTHOR_NAME}`}
              className="hover:text-sidebar-foreground transition-colors"
            >
              v{APP_VERSION}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setAboutOpen(true)}
                title="About Zero"
                className="hover:text-sidebar-foreground hover:underline transition-colors"
              >
                v{APP_VERSION}
              </button>{" "}
              &middot; Built by{" "}
              <a
                href={AUTHOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-sidebar-foreground hover:underline transition-colors"
              >
                {AUTHOR_NAME}
              </a>
            </>
          )}
        </div>
      </div>
      <AddAccountDialog open={addAccountOpen} onOpenChange={setAddAccountOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </aside>
  );
}

// Shows on the nav item whose page is loading. Server pages here fetch before
// rendering, so a click used to leave the old page frozen with no sign the
// navigation took. useLinkStatus needs no Suspense boundary (a route-level
// loading.tsx delayed hydration and broke ?category= deep links).
function NavPendingSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2
      aria-hidden="true"
      className="ml-auto h-4 w-4 animate-spin text-sidebar-foreground-muted animate-in fade-in delay-150 fill-mode-backwards"
    />
  );
}

function scrollActiveIntoView(el: HTMLDivElement | null) {
  el?.scrollIntoView({ block: "nearest" });
}

function AccountAccordion({
  title,
  accounts,
  total,
  count,
  open,
  onToggle,
  pathname,
  uncategorizedByAccount,
  onReopen,
}: {
  title: string;
  accounts: Account[];
  /** Trailing figure for a live section. Ignored when `count` is given. */
  total?: number;
  /** Trailing figure for the Closed section — a count, not money. */
  count?: number;
  open: boolean;
  onToggle: () => void;
  pathname: string;
  uncategorizedByAccount: Record<string, number>;
  /**
   * When present, rows render muted and swap the hover-revealed pencil menu
   * for a Reopen button. This is what makes the section an archive rather than
   * just another group.
   */
  onReopen?: (account: Account) => void;
}) {
  const fmt = useMaskedCurrency();
  const isArchive = onReopen !== undefined;
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-2 group/header"
      >
        <div className="flex items-center gap-1.5">
          <ChevronDown
            className={cn(
              "h-4 w-4 text-sidebar-foreground-muted transition-transform",
              !open && "-rotate-90"
            )}
          />
          <h3 className="text-sm font-medium text-sidebar-foreground">
            {title}
          </h3>
        </div>
        {count !== undefined ? (
          <span className="text-sm font-medium tabular-nums text-sidebar-foreground-muted">
            {count}
          </span>
        ) : (
          <FlashOnChange
            value={total ?? 0}
            className={cn(
              "text-sm font-medium tabular-nums zero-amount",
              roundCents(total ?? 0) < 0
                ? "text-sidebar-foreground-negative"
                : "text-sidebar-foreground"
            )}
          >
            {fmt(total ?? 0)}
          </FlashOnChange>
        )}
      </button>
      {open &&
        accounts.map((account) => {
          const bal = Number(account.current_balance);
          const isZero = roundCents(bal) === 0;
          const isNegative = roundCents(bal) < 0;
          const hasUncategorized = (uncategorizedByAccount[account.id] ?? 0) > 0;
          const isActive = pathname === `/accounts/${account.id}`;
          return (
            <div
              key={account.id}
              // Keep the active account visible in a long, scrolled list.
              ref={isActive ? scrollActiveIntoView : undefined}
              className="group relative rounded-full"
            >
              {/*
                Link covers the whole row; AccountMenu is a sibling so its
                trigger doesn't route clicks through the anchor. The status
                dot and the pencil trigger share the same 16×16 column at
                px-3 — exactly under the header's chevron — so the name
                aligns flush with the group title. CSS swap: dot fades out
                on group-hover (and while the menu is open), the pencil
                fades in. Same column = no horizontal shift.
              */}
              <Link
                href={`/accounts/${account.id}`}
                className={cn(
                  "flex items-center gap-1.5 px-3 rounded-full text-[14px] transition-colors min-w-0 h-9",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
                  isZero && !isActive && "opacity-50",
                  // Archive rows are muted regardless of balance, and give up
                  // the icon column — there's no uncategorized dot worth
                  // showing on an account nothing new can land in.
                  isArchive && !isActive && "opacity-60"
                )}
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 h-4 w-4 flex items-center justify-center transition-opacity group-hover:opacity-0 group-has-[[data-popup-open]]:opacity-0"
                >
                  {hasUncategorized && (
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                  )}
                </span>
                <TruncatedText className="font-normal" side="right">{account.name}</TruncatedText>
                <FlashOnChange
                  value={bal}
                  className={cn(
                    "ml-auto text-[13px] tabular-nums shrink-0 zero-amount",
                    isNegative && "text-sidebar-foreground-negative"
                  )}
                >
                  {fmt(bal)}
                </FlashOnChange>
              </Link>
              {/* Pencil overlay — sibling of the Link, sits over the dot
                  column. In the archive it's a Reopen button instead: every
                  other item in that menu (Adjust balance, Reconcile, Set as
                  primary) is meaningless on a closed account. */}
              <span className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 z-10">
                {onReopen ? (
                  <button
                    type="button"
                    aria-label={`Reopen ${account.name}`}
                    title={`Reopen ${account.name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onReopen(account);
                    }}
                    className={cn(
                      "absolute inset-0 flex items-center justify-center rounded-full",
                      "text-sidebar-foreground-muted hover:text-sidebar-foreground",
                      "opacity-0 pointer-events-none transition-opacity",
                      "group-hover:opacity-100 group-hover:pointer-events-auto",
                      "focus-visible:opacity-100 focus-visible:pointer-events-auto"
                    )}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <AccountMenu
                    account={account}
                    triggerVariant="pencil"
                    showReconcile={false}
                  />
                )}
              </span>
            </div>
          );
        })}
    </div>
  );
}
