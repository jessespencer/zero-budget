"use server";

import { revalidatePath } from "next/cache";
import { getRealDb, resolveDbPath } from "@/lib/db";
import { isDemoMode } from "@/lib/demo-config";
import { disableDemoMode, enableDemoMode } from "@/lib/demo-mode";

// Demo mode switches the whole app between your budget and the sample
// household (lib/demo-mode.ts). Both actions work on the REAL database — the
// switch is stored there — and invalidate every page, since every page's data
// changes. The caller reloads afterwards so client state (optimistic values,
// the undo stack) never carries ids from one database into the other.

function refuseOnPublicDemo(): void {
  if (isDemoMode()) {
    throw new Error("Demo mode isn't available on the public demo.");
  }
}

export async function startDemoMode(): Promise<void> {
  refuseOnPublicDemo();
  enableDemoMode(getRealDb(), resolveDbPath());
  revalidatePath("/", "layout");
}

export async function stopDemoMode(): Promise<void> {
  refuseOnPublicDemo();
  disableDemoMode(getRealDb(), resolveDbPath());
  revalidatePath("/", "layout");
}
