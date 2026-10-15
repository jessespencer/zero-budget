import type { BudgetMonth, Account, CategoryWithBudget } from "./types";
import { roundCents } from "./db-utils";

export type TransferPlanInput = {
  budgetMonth: BudgetMonth;
  accounts: Account[];
  actualBalances: Map<string, number>;
};

export type SavingsTransfer = {
  accountId: string;
  accountName: string;
  allocatedTotal: number;
  actualBalance: number;
  transferAmount: number;
};

export type CreditCardPayment = {
  accountId: string;
  accountName: string;
  currentBalance: number;
  paymentDue: number;
};

export type BufferItem = {
  categoryId: string;
  categoryName: string;
  available: number;
};

export type TransferSummary = {
  checkingActual: number;
  totalOutflows: number;
  requiredInChecking: number;
  remaining: number;
};

export type TransferPlanResult = {
  savingsTransfers: SavingsTransfer[];
  creditCardPayments: CreditCardPayment[];
  buffers: BufferItem[];
  summary: TransferSummary;
};

/**
 * Pure computation: given budget data, accounts, and actual balances,
 * returns exactly how much to transfer where.
 *
 * No DB access, no side effects.
 */
export function computeTransferPlan(input: TransferPlanInput): TransferPlanResult {
  const { budgetMonth, accounts, actualBalances } = input;

  // 1. Find primary account (required)
  const primaryAccount = accounts.find((a) => a.is_primary);
  if (!primaryAccount) {
    throw new Error("No primary account found. Mark one checking account as primary.");
  }
  const primaryId = primaryAccount.id;

  // 2. Flatten all categories from budget groups
  const allCategories: CategoryWithBudget[] = budgetMonth.groups.flatMap(
    (g) => g.categories
  );

  // 3. Build savings transfers for non-primary, non-credit-card accounts
  const savingsTransfers: SavingsTransfer[] = [];
  for (const account of accounts) {
    if (account.type === "credit_card" || account.is_primary || account.id === primaryId || account.archived || !account.is_budget_account) {
      continue;
    }

    const allocated = allCategories.filter(
      (c) => c.allocation_account_id === account.id
    );
    if (allocated.length === 0) continue;

    const allocatedTotal = allocated.reduce((sum, c) => sum + c.available, 0);
    const actualBalance = actualBalances.get(account.id) ?? account.current_balance;

    savingsTransfers.push({
      accountId: account.id,
      accountName: account.name,
      allocatedTotal: roundCents(allocatedTotal),
      actualBalance: roundCents(actualBalance),
      transferAmount: roundCents(Math.max(0, allocatedTotal - actualBalance)),
    });
  }

  // 4. Build credit card payments (active budget cards only)
  const creditCardPayments: CreditCardPayment[] = accounts
    .filter((a) => a.type === "credit_card" && !a.archived && a.is_budget_account)
    .map((a) => {
      const balance = actualBalances.get(a.id) ?? a.current_balance;
      return {
        accountId: a.id,
        accountName: a.name,
        currentBalance: roundCents(balance),
        paymentDue: roundCents(Math.max(0, -balance)),
      };
    });

  // 5. Build buffer list
  const buffers: BufferItem[] = allCategories
    .filter((c) => c.is_buffer)
    .map((c) => ({
      categoryId: c.id,
      categoryName: c.name,
      available: roundCents(c.available),
    }));

  // 6. Compute summary
  const checkingActual = roundCents(
    actualBalances.get(primaryAccount.id) ?? primaryAccount.current_balance
  );

  const totalOutflows = roundCents(
    savingsTransfers.reduce((s, t) => s + t.transferAmount, 0) +
      creditCardPayments.reduce((s, p) => s + p.paymentDue, 0)
  );

  const bufferTotal = buffers.reduce((s, b) => s + b.available, 0);
  const requiredInChecking = roundCents(totalOutflows + bufferTotal);
  const remaining = roundCents(checkingActual - requiredInChecking);

  return {
    savingsTransfers,
    creditCardPayments,
    buffers,
    summary: { checkingActual, totalOutflows, requiredInChecking, remaining },
  };
}
