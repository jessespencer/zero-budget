"use client";

import { createContext, useContext, useTransition } from "react";
import { format } from "date-fns";
import { startDemoMode, stopDemoMode } from "@/app/(app)/demo-mode/actions";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import type { DemoModeStatus } from "@/lib/demo-mode-status";

// Client side of the in-app Demo mode (lib/demo-mode.ts). The layouts read the
// status on the server and hand it down; every control here ends with a full
// page load, so no optimistic value, undo entry or open dialog can carry ids
// from one database into the other.

const DemoModeContext = createContext<DemoModeStatus>({ available: false, expiresAt: null });

export function DemoModeProvider({
  status,
  children,
}: {
  status: DemoModeStatus;
  children: React.ReactNode;
}) {
  return <DemoModeContext.Provider value={status}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode() {
  const status = useContext(DemoModeContext);
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<void>, failure: string) =>
    startTransition(async () => {
      try {
        await action();
        // Land on the budget: the current URL may name an account or
        // category that only exists in the other database.
        window.location.assign("/budget");
      } catch {
        toast({ message: failure, variant: "error" });
      }
    });

  return {
    available: status.available,
    active: status.expiresAt !== null,
    expiresAt: status.expiresAt,
    pending,
    start: () => run(startDemoMode, "Could not start demo mode."),
    stop: () => run(stopDemoMode, "Could not end demo mode."),
  };
}

/** Explains what demo mode does before switching it on. */
export function StartDemoModeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { start } = useDemoMode();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Start demo mode?"
      description="Zero will show a sample household instead of your budget, on every device, until you end it or 4 hours pass. Your budget isn't touched, and anything you change in demo mode is thrown away."
      confirmLabel="Start demo mode"
      destructive={false}
      onConfirm={start}
    />
  );
}

/** Full-width bar above the app while demo mode is on, with the off switch. */
export function DemoModeBanner() {
  const { active, expiresAt, pending, stop } = useDemoMode();
  if (!active || expiresAt === null) return null;

  return (
    <>
      {/* Lets the app shell subtract the bar from its 100dvh height. */}
      <style>{`:root { --zero-demo-mode-banner-h: 2.25rem; }`}</style>
      <div
        role="status"
        aria-label="Demo mode"
        className="flex h-9 shrink-0 items-center justify-center gap-3 bg-info px-3 text-sm text-white dark:text-background"
      >
        <span className="font-semibold uppercase tracking-wider text-xs">Demo mode</span>
        <span className="truncate opacity-90">
          Sample data — changes are thrown away. Ends at{" "}
          <span suppressHydrationWarning>{format(new Date(expiresAt), "h:mm a")}</span>.
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={stop}
          className="shrink-0 rounded-full bg-white/20 px-3 py-0.5 text-xs font-semibold hover:bg-white/30 disabled:opacity-60 dark:bg-background/20 dark:hover:bg-background/30"
        >
          {pending ? "Ending…" : "End demo"}
        </button>
      </div>
    </>
  );
}
