"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Privacy ("demo") mode — a client-only toggle that masks every monetary value
 * in the app with "$••••••" placeholders (hide-amounts). No DB
 * writes; the state lives in localStorage so it survives reloads and
 * navigation.
 *
 * Anti-flash: a blocking inline script in the root layout reads the persisted
 * value and stamps `data-amounts-hidden="1"` on <html> before first paint. A
 * CSS rule (globals.css) blurs `.zero-amount` spans while hidden AND not yet
 * hydrated, so server-rendered real numbers are never briefly readable on a
 * hard reload. Once this provider mounts it adds `.zero-hydrated` to <html>,
 * lifting the blur exactly as React swaps the text to real "$••••••" strings.
 */

export const AMOUNTS_HIDDEN_KEY = "zero-amounts-hidden";

type PrivacyContextValue = {
  hidden: boolean;
  setHidden: (value: boolean) => void;
  toggle: () => void;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe default: server always renders `false` (real numbers), and the
  // first client render must match to avoid a hydration mismatch. The effect
  // below flips it to the persisted value; the CSS blur covers the gap.
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    const persisted =
      document.documentElement.dataset.amountsHidden === "1" ||
      readPersisted();
    if (persisted) setHiddenState(true);
    // Mark hydration complete so the anti-flash blur rule stops applying.
    document.documentElement.classList.add("zero-hydrated");
  }, []);

  const setHidden = useCallback((value: boolean) => {
    setHiddenState(value);
    document.documentElement.dataset.amountsHidden = value ? "1" : "0";
    try {
      window.localStorage.setItem(AMOUNTS_HIDDEN_KEY, value ? "1" : "0");
    } catch {
      // Private-mode / disabled storage — masking still works for the session.
    }
  }, []);

  const toggle = useCallback(
    () => setHidden(!hidden),
    [hidden, setHidden]
  );

  return (
    <PrivacyContext.Provider value={{ hidden, setHidden, toggle }}>
      {children}
    </PrivacyContext.Provider>
  );
}

function readPersisted(): boolean {
  try {
    return window.localStorage.getItem(AMOUNTS_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Read privacy state. Safe to call outside the provider (returns a permanently
 * visible, no-op toggle) so leaf components never crash if rendered in an
 * isolated tree (tests, storybook-style previews).
 */
export function useAmountsHidden(): PrivacyContextValue {
  return (
    useContext(PrivacyContext) ?? {
      hidden: false,
      setHidden: () => {},
      toggle: () => {},
    }
  );
}
