import { revalidatePath } from "next/cache";

/**
 * Invalidate every page that renders the money a mutation moved.
 *
 * All of these call sites used to call `revalidatePath("/")` and nothing else,
 * which names no payload at all: `app/page.tsx` is a bare `redirect("/budget")`
 * with no data of its own. What made it appear to work is that Next blows away
 * the whole client Router Cache for *any* `revalidatePath` call from a Server
 * Action — so the invalidation was a side effect rather than something the call
 * sites asked for.
 *
 * That blanket sweep is still what does the work today, because the `(app)`
 * segment is `force-dynamic` and so holds no full route cache to purge. The
 * point of naming the paths is that the intent survives: if the segment ever
 * stops being force-dynamic, these are the pages that go stale, and a literal
 * `"/"` would silently keep none of them fresh.
 *
 * `/accounts` is deliberately absent — there is no such route. Account data
 * lives at `/accounts/[id]`, which needs the "page" type to match every
 * instance.
 *
 * Lives in `lib/` rather than in a `"use server"` module so both
 * `transfer-plan/actions.ts` and `accounts/[id]/actions.ts` can share it: an
 * actions module may only export async server functions, so a helper exported
 * from one of them can't be imported by the other. Closing an account writes
 * the same Ready-to-assign adjustment `updateAccountBalanceWithSnapshot` does,
 * so it owes the same invalidation — before this was shared, close named a
 * narrower subset and Insights and Transfer plan were the first to go stale.
 */
export function revalidateMoneyPages() {
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/transfer-plan");
  revalidatePath("/insights");
  revalidatePath("/accounts/[id]", "page");
}
