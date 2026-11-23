import { getRealDb, resolveDbPath } from "./db";
import { isDemoMode } from "./demo-config";
import { demoModeExpiresAt } from "./demo-mode";

export type DemoModeStatus = {
  /** False on the public demo server, where the switch makes no sense. */
  available: boolean;
  /** When demo mode ends (epoch ms), or null when it's off. */
  expiresAt: number | null;
};

/** For layouts: whether to show the Demo mode banner and which Settings item. */
export function getDemoModeStatus(): DemoModeStatus {
  // The public demo never opens a real database — don't start now.
  if (isDemoMode()) return { available: false, expiresAt: null };
  return { available: true, expiresAt: demoModeExpiresAt(getRealDb(), resolveDbPath()) };
}
