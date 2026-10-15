import { describe, it, expect, beforeEach } from "vitest";
import {
  computeTransferPlan,
  type TransferPlanInput,
} from "@/lib/transfer-engine";
import {
  makeAccount,
  makeCategory,
  makeCategoryGroup,
  resetFixtureCounter,
} from "../../setup/fixtures";
import type {
  CategoryWithBudget,
  CategoryGroupWithCategories,
  BudgetMonth,
} from "@/lib/types";

/** Build a CategoryWithBudget from a base category plus budget numbers. */
function budgetCat(
  groupId: string,
  overrides: {
    id?: string;
    name?: string;
    allocation_account_id?: string | null;
    is_buffer?: boolean;
    available?: number;
    assigned?: number;
    activity?: number;
  } = {}
): CategoryWithBudget {
  const cat = makeCategory(groupId, {
    id: overrides.id,
    name: overrides.name,
    allocation_account_id: overrides.allocation_account_id ?? null,
    is_buffer: overrides.is_buffer ?? false,
  });
  return {
    ...cat,
    assigned: overrides.assigned ?? 0,
    activity: overrides.activity ?? 0,
    available: overrides.available ?? 0,
    cumulative_assigned: 0,
    target: null,
    autoAssign: {
      assignedLastMonth: 0,
      spentLastMonth: 0,
      averageAssigned: 0,
      averageSpent: 0,
    },
  };
}

/** Build a CategoryGroupWithCategories. */
function budgetGroup(
  id: string,
  categories: CategoryWithBudget[]
): CategoryGroupWithCategories {
  const group = makeCategoryGroup({ id });
  return {
    ...group,
    categories,
    groupAssigned: categories.reduce((s, c) => s + c.assigned, 0),
    groupActivity: categories.reduce((s, c) => s + c.activity, 0),
    groupAvailable: categories.reduce((s, c) => s + c.available, 0),
  };
}

/** Build a minimal BudgetMonth. */
function makeBudgetMonth(
  groups: CategoryGroupWithCategories[] = []
): BudgetMonth {
  return {
    month: "2026-05-01",
    readyToAssign: 0,
    groups,
    hiddenCategories: [],
    hiddenGroups: [],
    totalIncome: 0,
    totalAssigned: 0,
    overspentLastMonth: 0,
    currentMonthIncome: 0,
    currentMonthAssigned: 0,
    expectedIncome: null,
    openingCcDebt: 0,
    futureAssigned: 0,
  };
}

/** Build a minimal TransferPlanInput. */
function transferInput(
  overrides: Partial<TransferPlanInput> = {}
): TransferPlanInput {
  return {
    budgetMonth: makeBudgetMonth(),
    accounts: [],
    actualBalances: new Map(),
    ...overrides,
  };
}

describe("computeTransferPlan", () => {
  beforeEach(() => resetFixtureCounter());

  // ── Empty input ──────────────────────────────────────────

  it("throws when no primary account exists", () => {
    expect(() => computeTransferPlan(transferInput())).toThrow(
      "No primary account found"
    );
  });

  // ── Savings transfers ────────────────────────────────────

  it("computes savings transfer for account with allocated categories", () => {
    const savingsAcct = makeAccount({
      id: "savings-1",
      name: "Emergency Fund",
      type: "savings",
      current_balance: 600,
    });
    const primaryAcct = makeAccount({
      id: "checking-1",
      name: "Checking",
      type: "checking",
      is_primary: true,
      current_balance: 10000,
    });

    const cat1 = budgetCat("g1", {
      id: "c1",
      name: "Emergency",
      allocation_account_id: "savings-1",
      available: 500,
    });
    const cat2 = budgetCat("g1", {
      id: "c2",
      name: "Vacation",
      allocation_account_id: "savings-1",
      available: 300,
    });
    const group = budgetGroup("g1", [cat1, cat2]);

    const result = computeTransferPlan(
      transferInput({
        budgetMonth: makeBudgetMonth([group]),
        accounts: [primaryAcct, savingsAcct],
        actualBalances: new Map([["savings-1", 600]]),
      })
    );

    expect(result.savingsTransfers).toHaveLength(1);
    expect(result.savingsTransfers[0].accountId).toBe("savings-1");
    expect(result.savingsTransfers[0].accountName).toBe("Emergency Fund");
    expect(result.savingsTransfers[0].allocatedTotal).toBe(800);
    expect(result.savingsTransfers[0].actualBalance).toBe(600);
    expect(result.savingsTransfers[0].transferAmount).toBe(200);
  });

  // ── Credit card payments ─────────────────────────────────

  it("computes credit card payment as absolute current_balance", () => {
    const primaryAcct = makeAccount({
      id: "checking-1",
      type: "checking",
      is_primary: true,
      current_balance: 10000,
    });
    const ccAcct = makeAccount({
      id: "cc-1",
      name: "Visa",
      type: "credit_card",
      current_balance: -1500,
    });

    const result = computeTransferPlan(
      transferInput({
        accounts: [primaryAcct, ccAcct],
      })
    );

    expect(result.creditCardPayments).toHaveLength(1);
    expect(result.creditCardPayments[0].accountId).toBe("cc-1");
    expect(result.creditCardPayments[0].accountName).toBe("Visa");
    expect(result.creditCardPayments[0].currentBalance).toBe(-1500);
    expect(result.creditCardPayments[0].paymentDue).toBe(1500);
  });

  // ── Buffer categories ────────────────────────────────────

  it("lists buffer categories with available amounts", () => {
    const cat1 = budgetCat("g1", {
      id: "buf-1",
      name: "Car fund",
      is_buffer: true,
      available: 1000,
    });
    const cat2 = budgetCat("g1", {
      id: "buf-2",
      name: "Home repair",
      is_buffer: true,
      available: 200,
    });
    const group = budgetGroup("g1", [cat1, cat2]);

    const primaryAcct = makeAccount({
      id: "checking-1",
      type: "checking",
      is_primary: true,
    });

    const result = computeTransferPlan(
      transferInput({
        budgetMonth: makeBudgetMonth([group]),
        accounts: [primaryAcct],
      })
    );

    expect(result.buffers).toHaveLength(2);
    expect(result.buffers[0].categoryId).toBe("buf-1");
    expect(result.buffers[0].categoryName).toBe("Car fund");
    expect(result.buffers[0].available).toBe(1000);
    expect(result.buffers[1].categoryId).toBe("buf-2");
    expect(result.buffers[1].available).toBe(200);
  });

  // ── NULL allocation = primary account ────────────────────

  it("treats NULL allocation_account_id as primary account", () => {
    const primaryAcct = makeAccount({
      id: "checking-1",
      type: "checking",
      is_primary: true,
      current_balance: 5000,
    });
    const savingsAcct = makeAccount({
      id: "savings-1",
      type: "savings",
      current_balance: 1000,
    });

    // This category has no allocation -- should NOT generate a savings transfer
    const unallocated = budgetCat("g1", {
      id: "c1",
      name: "Groceries",
      allocation_account_id: null,
      available: 400,
    });
    const group = budgetGroup("g1", [unallocated]);

    const result = computeTransferPlan(
      transferInput({
        budgetMonth: makeBudgetMonth([group]),
        accounts: [primaryAcct, savingsAcct],
      })
    );

    // No savings transfers should exist because the category is unallocated
    expect(result.savingsTransfers).toHaveLength(0);
  });

  it("treats allocation_account_id matching primary account as primary", () => {
    const primaryAcct = makeAccount({
      id: "checking-1",
      type: "checking",
      is_primary: true,
      current_balance: 5000,
    });

    // Category explicitly allocated to primary -- should NOT generate a savings transfer
    const allocatedToPrimary = budgetCat("g1", {
      id: "c1",
      name: "Rent",
      allocation_account_id: "checking-1",
      available: 1500,
    });
    const group = budgetGroup("g1", [allocatedToPrimary]);

    const result = computeTransferPlan(
      transferInput({
        budgetMonth: makeBudgetMonth([group]),
        accounts: [primaryAcct],
      })
    );

    expect(result.savingsTransfers).toHaveLength(0);
  });

  // ── Summary computation ──────────────────────────────────

  it("computes summary correctly", () => {
    const primaryAcct = makeAccount({
      id: "checking-1",
      type: "checking",
      is_primary: true,
      current_balance: 10000,
    });
    const savingsAcct = makeAccount({
      id: "savings-1",
      name: "Savings",
      type: "savings",
      current_balance: 2000,
    });
    const ccAcct = makeAccount({
      id: "cc-1",
      name: "Visa",
      type: "credit_card",
      current_balance: -1500,
    });

    const savingsCat = budgetCat("g1", {
      id: "c1",
      allocation_account_id: "savings-1",
      available: 2800,
    });
    const bufferCat = budgetCat("g1", {
      id: "buf-1",
      is_buffer: true,
      available: 1200,
    });
    const group = budgetGroup("g1", [savingsCat, bufferCat]);

    const result = computeTransferPlan(
      transferInput({
        budgetMonth: makeBudgetMonth([group]),
        accounts: [primaryAcct, savingsAcct, ccAcct],
        actualBalances: new Map([
          ["checking-1", 10000],
          ["savings-1", 2000],
        ]),
      })
    );

    // savings transfer = 2800 - 2000 = 800
    // credit card payment = 1500
    // totalOutflows = 800 + 1500 = 2300
    // buffer total = 1200
    // requiredInChecking = 2300 + 1200 = 3500
    // remaining = 10000 - 3500 = 6500
    expect(result.summary.checkingActual).toBe(10000);
    expect(result.summary.totalOutflows).toBe(2300);
    expect(result.summary.requiredInChecking).toBe(3500);
    expect(result.summary.remaining).toBe(6500);
  });

  // ── Multiple accounts ────────────────────────────────────

  it("produces separate transfer entries for multiple savings accounts", () => {
    const primaryAcct = makeAccount({
      id: "checking-1",
      type: "checking",
      is_primary: true,
    });
    const savings1 = makeAccount({
      id: "savings-1",
      name: "Emergency",
      type: "savings",
      current_balance: 1000,
    });
    const savings2 = makeAccount({
      id: "savings-2",
      name: "Vacation",
      type: "savings",
      current_balance: 500,
    });

    const cat1 = budgetCat("g1", {
      id: "c1",
      allocation_account_id: "savings-1",
      available: 1500,
    });
    const cat2 = budgetCat("g1", {
      id: "c2",
      allocation_account_id: "savings-2",
      available: 800,
    });
    const group = budgetGroup("g1", [cat1, cat2]);

    const result = computeTransferPlan(
      transferInput({
        budgetMonth: makeBudgetMonth([group]),
        accounts: [primaryAcct, savings1, savings2],
        actualBalances: new Map([
          ["savings-1", 1000],
          ["savings-2", 500],
        ]),
      })
    );

    expect(result.savingsTransfers).toHaveLength(2);

    const t1 = result.savingsTransfers.find((t) => t.accountId === "savings-1");
    const t2 = result.savingsTransfers.find((t) => t.accountId === "savings-2");

    expect(t1).toBeDefined();
    expect(t1!.transferAmount).toBe(500); // 1500 - 1000
    expect(t2).toBeDefined();
    expect(t2!.transferAmount).toBe(300); // 800 - 500
  });

  // ── Default actual balance ───────────────────────────────

  it("defaults actual balance to current_balance when not in map", () => {
    const primaryAcct = makeAccount({
      id: "checking-1",
      type: "checking",
      is_primary: true,
      current_balance: 5000,
    });
    const savingsAcct = makeAccount({
      id: "savings-1",
      name: "Savings",
      type: "savings",
      current_balance: 3000,
    });

    const cat = budgetCat("g1", {
      id: "c1",
      allocation_account_id: "savings-1",
      available: 3500,
    });
    const group = budgetGroup("g1", [cat]);

    // No entry in actualBalances for savings-1
    const result = computeTransferPlan(
      transferInput({
        budgetMonth: makeBudgetMonth([group]),
        accounts: [primaryAcct, savingsAcct],
        actualBalances: new Map(), // empty -- should default to current_balance
      })
    );

    expect(result.savingsTransfers).toHaveLength(1);
    expect(result.savingsTransfers[0].actualBalance).toBe(3000);
    expect(result.savingsTransfers[0].transferAmount).toBe(500); // 3500 - 3000
  });
});
