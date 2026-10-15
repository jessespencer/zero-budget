import { getMonthKey } from "@/lib/format";
import { getBudgetData } from "@/app/(app)/budget/actions";
import { computeBudgetMonth } from "@/lib/budget-engine";
import { getDb, DEFAULT_USER_ID } from "@/lib/db";
import { mapRows } from "@/lib/db-utils";
import type { Account } from "@/lib/types";
import { TransferPlanClient } from "@/components/transfer-plan/transfer-plan-client";
import { getTransferPlanActuals } from "./actions";

export default async function TransferPlanPage() {
  const month = getMonthKey();
  const data = await getBudgetData(month);
  const budgetMonth = computeBudgetMonth(data);

  const db = getDb();
  const accounts = mapRows<Account>(
    db
      .prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY sort_order")
      .all(DEFAULT_USER_ID) as Record<string, unknown>[]
  );

  const savedActuals = await getTransferPlanActuals(month);

  return (
    <div className="flex flex-col h-full">
      <TransferPlanClient
        budgetMonth={budgetMonth}
        accounts={accounts}
        savedActuals={savedActuals}
        month={month}
      />
    </div>
  );
}
