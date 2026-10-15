import { getQuickAddData } from "@/app/(app)/transactions/actions";
import { QuickAddForm } from "./quick-add-form";

// /quick reads live accounts/categories/recents from SQLite on every load —
// without this it would be statically prerendered against the build-time DB
// and never re-query. /quick lives outside the (app) segment that already
// force-dynamics, so the declaration has to live here too.
export const dynamic = "force-dynamic";

export default async function QuickPage() {
  const data = await getQuickAddData();
  return <QuickAddForm {...data} />;
}
