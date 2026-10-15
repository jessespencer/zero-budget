import { cache } from "react";
import { postDueSchedules } from "@/app/(app)/schedules/actions";

// Both the (app) layout and the /schedules page need to catch up due schedules,
// for different reasons:
//
//   - the layout, so "Auto-post when due" happens on app load no matter which
//     route you land on;
//   - the page, because layouts are NOT re-executed on soft client-side
//     navigation, so a long-lived tab would otherwise never catch up.
//
// On a hard load of /schedules both fire in the same request, and the scan is a
// correlated NOT EXISTS over the transactions table — not something to run
// twice. React's `cache()` is per-request, so the second caller in a given
// render reuses the first call's promise and the work happens exactly once.
//
// `revalidate: false` because both callers run during a render pass, and
// revalidatePath() throws if called during render. It's redundant here anyway:
// the (app) segment is `dynamic = "force-dynamic"`, so every route re-reads
// SQLite per request.
export const catchUpDueSchedules = cache(async () => {
  await postDueSchedules({ revalidate: false });
});
