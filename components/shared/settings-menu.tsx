"use client";

import { useEffect, useState } from "react";
import { Settings, SunMoon, Users, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAmountsHidden } from "@/components/shared/privacy-provider";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { SidebarTooltip } from "@/components/shared/sidebar-tooltip";
import { ThemeDialog } from "@/components/shared/theme-dialog";
import { ManagePayeesDialog } from "@/components/transactions/manage-payees-dialog";

// Inline prop shapes mirror ManagePayeesDialog's so the data threads straight
// through from AppShell → Sidebar → SettingsMenu with no remapping.
type PayeeItem = { id: string; name: string; default_category_id: string | null };

type SettingsMenuProps = {
  collapsed: boolean;
  payees: PayeeItem[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
};

// Sidebar-bottom global launcher. Replaces the standalone Theme toggle with a
// gear "Settings" button whose popover opens the three workspace dialogs
// (theme, payees, export). The menu closes on item select (Base UI default);
// each dialog is then driven by its own controlled-open state below.
export function SettingsMenu({
  collapsed,
  payees,
  categories,
  categoryGroups,
}: SettingsMenuProps) {
  const { hidden: amountsHidden, toggle: toggleAmounts } = useAmountsHidden();
  const [mounted, setMounted] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [payeesOpen, setPayeesOpen] = useState(false);

  // Match ThemeToggle's mounted guard so next-themes hydration lines up.
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <>
      {/* modal={false}: the default modal menu scroll-locks <body> (overflow:
          hidden), which shifts the layout ~4px and makes the trigger + popup
          jump on open. A sidebar launcher doesn't need modal behavior. */}
      <DropdownMenu modal={false}>
        <SidebarTooltip label="Settings" collapsed={collapsed}>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={collapsed ? "Settings" : undefined}
                className={cn(
                  // Same recipe as the top-level nav items in sidebar.tsx.
                  "flex items-center rounded-full text-[15px] font-medium transition-colors h-14 w-full text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                  collapsed ? "justify-center px-0" : "gap-3 px-3"
                )}
              />
            }
          >
            <Settings className="h-6 w-6 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            {!collapsed && "Settings"}
          </DropdownMenuTrigger>
        </SidebarTooltip>
        <DropdownMenuContent side="top" align="start" className="min-w-[180px]">
          <DropdownMenuItem onClick={() => setThemeOpen(true)}>
            <SunMoon className="h-3.5 w-3.5" />
            Theme
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPayeesOpen(true)}>
            <Users className="h-3.5 w-3.5" />
            Manage payees
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleAmounts}>
            {amountsHidden ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            {amountsHidden ? "Show amounts" : "Hide amounts"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ThemeDialog open={themeOpen} onOpenChange={setThemeOpen} />

      {/* Manage payees — controlled via the props added in Task 1 (no default trigger). */}
      <ManagePayeesDialog
        open={payeesOpen}
        onOpenChange={setPayeesOpen}
        payees={payees}
        categories={categories}
        categoryGroups={categoryGroups}
      />

    </>
  );
}
