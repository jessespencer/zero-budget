import type {
  Account,
  Category,
  CategoryGroup,
  MonthlyBudget,
  Target,
  Transaction,
  TransactionSplit,
  ScheduledTransaction,
} from "@/lib/types";

const USER_ID = "00000000-0000-0000-0000-000000000000";
let counter = 0;
const id = () => `test-${String(++counter).padStart(4, "0")}`;
const ts = () => "2026-01-01T00:00:00.000Z";

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: id(),
    user_id: USER_ID,
    name: "Checking",
    type: "checking",
    institution: null,
    current_balance: 0,
    is_budget_account: true,
    is_debt: false,
    sort_order: 0,
    archived: false,
    plaid_item_id: null,
    is_primary: false,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

export function makeCategoryGroup(overrides: Partial<CategoryGroup> = {}): CategoryGroup {
  return {
    id: id(),
    user_id: USER_ID,
    name: "Bills",
    sort_order: 0,
    archived: false,
    is_income: false,
    is_system: false,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

export function makeCategory(
  groupId: string,
  overrides: Partial<Category> = {}
): Category {
  return {
    id: id(),
    category_group_id: groupId,
    user_id: USER_ID,
    name: "Rent",
    sort_order: 0,
    archived: false,
    allocation_account_id: null,
    is_buffer: false,
    pinned_quick: false,
    notes: "",
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: id(),
    user_id: USER_ID,
    account_id: "acct-1",
    date: "2026-04-15",
    payee: "Grocery Store",
    memo: null,
    amount: -50,
    category_id: null,
    transfer_account_id: null,
    cleared: false,
    approved: true,
    is_split_parent: false,
    is_envelope_movement: false,
    source: null,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

export function makeSplit(overrides: Partial<TransactionSplit> = {}): TransactionSplit {
  return {
    id: id(),
    parent_transaction_id: "parent-1",
    category_id: "cat-1",
    amount: -25,
    memo: null,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

export function makeMonthlyBudget(overrides: Partial<MonthlyBudget> = {}): MonthlyBudget {
  return {
    id: id(),
    user_id: USER_ID,
    category_id: "cat-1",
    month: "2026-04-01",
    assigned: 0,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

export function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: id(),
    user_id: USER_ID,
    category_id: "cat-1",
    type: "monthly_funding",
    frequency: "monthly",
    target_amount: 100,
    target_date: null,
    monthly_contribution: null,
    priority: null,
    recurring: false,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

export function makeSchedule(overrides: Partial<ScheduledTransaction> = {}): ScheduledTransaction {
  return {
    id: id(),
    user_id: USER_ID,
    name: "Monthly rent",
    account_id: "acct-1",
    payee: "Landlord",
    category_id: null,
    amount: -1500,
    memo: null,
    frequency: "monthly",
    interval: 1,
    start_date: "2026-01-01",
    end_date: null,
    day_of_month: 1,
    day_of_week: null,
    skip_weekend: null,
    next_date: "2026-05-01",
    posts_transaction: true,
    completed: false,
    created_at: ts(),
    updated_at: ts(),
    ...overrides,
  };
}

/** Reset the auto-increment counter (call in beforeEach for deterministic IDs) */
export function resetFixtureCounter(): void {
  counter = 0;
}
