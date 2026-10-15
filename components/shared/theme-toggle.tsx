"use client";

import { useEffect, useState } from "react";
import { Palette } from "lucide-react";
import { ThemeDialog } from "@/components/shared/theme-dialog";
import { cn } from "@/lib/utils";

export function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={collapsed ? "Theme" : undefined}
        className={cn(
          "flex items-center rounded-full text-[13px] text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors",
          collapsed ? "justify-center p-2.5" : "gap-2 px-2.5 py-[7px] w-full"
        )}
      >
        <Palette className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        {!collapsed && "Theme"}
      </button>

      <ThemeDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
