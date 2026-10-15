import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { PrivacyProvider } from "@/components/shared/privacy-provider";
import { ToastProvider } from "@/components/ui/toast";
import type { ReactElement, ReactNode } from "react";

/**
 * Render a client component with the providers the app wraps it in.
 *
 * This is the call-site test tier. The action tests in __tests__/unit/actions/
 * prove the server action leaves the database correct; these prove the button
 * actually calls it — pushes an undo entry, fires a toast, catches a rejection,
 * rolls back on failure. CLAUDE.md's system-visibility rules are all call-site
 * rules, so this is the only tier that can check them.
 *
 * Server actions should be mocked here. A component test that reaches a real
 * database is an action test wearing a costume, and slow besides.
 */

type Options = Omit<RenderOptions, "wrapper"> & {
  /**
   * Start in privacy mode. PrivacyProvider reads the pre-paint dataset flag on
   * mount, which is the same path the blocking inline script in the root layout
   * uses — so this exercises masking the way a real reload does rather than by
   * poking at context.
   */
  amountsHidden?: boolean;
};

export function renderWithProviders(
  ui: ReactElement,
  { amountsHidden = false, ...options }: Options = {}
): RenderResult {
  document.documentElement.dataset.amountsHidden = amountsHidden ? "1" : "0";

  // ToastProvider is mounted app-wide in app/(app)/app-shell.tsx, and useToast
  // throws without it — so any component that reports a failure needs it here
  // too. Toasts render into a portal on document.body; assert with
  // screen.getByRole("status").
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <PrivacyProvider>{children}</PrivacyProvider>
      </ToastProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

/**
 * A promise you resolve by hand, for asserting on what happens *while* a server
 * action is still in flight — pending states, and whether an undo entry gets
 * pushed before the write is confirmed.
 */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
