// ============================================================
// Database row types
// ============================================================

export type AccountType =
  | "checking"
  | "cash"
  | "savings"
  | "credit_card"
  | "other";

export type TargetType =
  | "monthly_funding"
  | "savings_balance"
  | "target_by_date"
  | "spending";

export type Account = {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  current_balance: number;
  is_budget_account: boolean;
  is_debt: boolean;
  sort_order: number;
  archived: boolean;
  plaid_item_id: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

export type CategoryGroup = {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  // Group-level hide/unhide (migration 024, SEED-021 follow-up). A group with
  // archived=1 vanishes from the active budget grid and surfaces in the Hidden
  // section. mapRow converts the 0/1 INTEGER to a boolean automatically.
  archived: boolean;
  is_income: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  category_group_id: string;
  user_id: string;
  name: string;
  sort_order: number;
  archived: boolean;
  allocation_account_id: string | null;
  is_buffer: boolean;
  pinned_quick: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type MonthlyBudget = {
  id: string;
  user_id: string;
  category_id: string;
  month: string; // ISO date string, always 1st of month
  assigned: number;
  created_at: string;
  updated_at: string;
};

export type TransactionSource = "quick" | "desktop" | "import";

export type Transaction = {
  id: string;
  user_id: string;
  account_id: string;
  date: string;
  payee: string | null;
  memo: string | null;
  amount: number;
  category_id: string | null;
  transfer_account_id: string | null;
  cleared: boolean;
  approved: boolean;
  is_split_parent: boolean;
  // Envelope-allocation rows from the historical import (migration
  // 020). True for `fund`-type rows where money was moved into a sinking
  // fund rather than spent. Spending-analytics surfaces should filter these
  // out to avoid double-counting (allocate $1 to Truck fund, then spend $1
  // on the truck — only the spend is real spending).
  is_envelope_movement: boolean;
  // Provenance flag (migration 018). NULL for pre-018 rows; new writes stamp
  // 'quick' (/quick PWA), 'desktop' (every other in-app write), or 'import'
  // (CSV importer). See SEED-014.
  source: TransactionSource | null;
  created_at: string;
  updated_at: string;
};

export type TransactionSplit = {
  id: string;
  parent_transaction_id: string;
  category_id: string | null;
  amount: number;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

export type TargetFrequency = "weekly" | "monthly" | "yearly" | "custom";

export type Target = {
  id: string;
  user_id: string;
  category_id: string;
  type: TargetType;
  frequency: TargetFrequency;
  target_amount: number;
  target_date: string | null;
  monthly_contribution: number | null;
  priority: number | null;
  // Opt-in "repeat every year" flag for Yearly (target_by_date) targets. When
  // true the effective deadline rolls forward by whole years and progress is
  // measured against the current envelope balance so the fund refills each cycle.
  recurring: boolean;
  created_at: string;
  updated_at: string;
};

// ============================================================
// Tracked assets (Phase 8 — manually-tracked non-budget holdings)
// ============================================================

export type TrackedAssetType =
  | "investment"
  | "retirement"
  | "real_estate"
  | "crypto"
  | "vehicle"
  | "other";

export type TrackedAsset = {
  id: string;
  user_id: string;
  name: string;
  asset_type: TrackedAssetType;
  current_value: number;
  notes: string | null;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type TrackedAssetHistory = {
  id: string;
  asset_id: string;
  value: number;
  recorded_at: string;
  note: string | null;
  created_at: string;
};

export type Payee = {
  id: string;
  user_id: string;
  name: string;
  default_category_id: string | null;
  created_at: string;
  updated_at: string;
};

// ============================================================
// Scheduled transactions
// ============================================================

export type ScheduleFrequency =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "yearly"
  | "once";

export type ScheduledTransaction = {
  id: string;
  user_id: string;
  name: string | null;
  account_id: string;
  payee: string | null;
  category_id: string | null;
  amount: number;
  memo: string | null;
  frequency: ScheduleFrequency;
  interval: number;
  start_date: string;
  end_date: string | null;
  day_of_month: number | null;
  day_of_week: number | null;
  skip_weekend: string | null;
  next_date: string;
  posts_transaction: boolean;
  completed: boolean;
  created_at: string;
  updated_at: string;
};

export type ScheduledTransactionWithDetails = ScheduledTransaction & {
  account_name: string;
  category_name: string | null;
  has_paid_transaction: boolean;
};

export type ScheduleStatus =
  | "completed"
  | "paid"
  | "due"
  | "upcoming"
  | "missed"
  | "scheduled";

// ============================================================
// Derived / composite types for UI
// ============================================================

// Historical assign/spend figures backing the category panel's Auto-assign
// suggestions. Precomputed by the budget engine (in-memory, from the same
// monthlyBudgets/transactions already loaded) so the panel needs no per-click
// fetch. Spend figures are positive magnitudes (stored negative in the DB).
export type CategoryAutoAssignMetrics = {
  assignedLastMonth: number;
  spentLastMonth: number;
  averageAssigned: number;
  averageSpent: number;
};

export type CategoryWithBudget = Category & {
  assigned: number;
  activity: number;
  available: number;
  cumulative_assigned: number;
  target: Target | null;
  autoAssign: CategoryAutoAssignMetrics;
};

export type CategoryGroupWithCategories = CategoryGroup & {
  categories: CategoryWithBudget[];
  groupAssigned: number;
  groupActivity: number;
  groupAvailable: number;
};

export type BudgetMonth = {
  month: string; // "2026-04-01"
  readyToAssign: number;
  groups: CategoryGroupWithCategories[];
  // Archived non-income, non-system categories surfaced in the budget grid's
  // collapsible "Hidden categories" group (never in their original group).
  // Deduplicated against hiddenGroups: a category whose GROUP is hidden is
  // listed under that group below, not here.
  hiddenCategories: CategoryWithBudget[];
  // Archived non-income, non-system groups surfaced in the Hidden section as
  // collapsible blocks with ALL their categories nested (display-only). A group
  // is hidden via category_groups.archived=1; its children's own archived flag
  // is irrelevant to its visibility while the group is hidden (SEED-021 group-level).
  hiddenGroups: CategoryGroupWithCategories[];
  totalIncome: number;
  totalAssigned: number;
  overspentLastMonth: number;
  currentMonthIncome: number;
  // Sum of assignments made *in this month only* across non-income categories.
  // Mirrors the exclusion semantics of totalAssigned so that the popover's
  // signed-decomposition identity (inflow - assigned + carryover - overspent
  // === readyToAssign) holds at integer-cent precision.
  currentMonthAssigned: number;
  // User-entered income forecast for this month ("Cost to be me" card), or null
  // when no forecast row exists. Distinct from currentMonthIncome, which is the
  // income actually recorded so far. Sourced from monthly_income_forecast.
  expectedIncome: number | null;
  // Sum of |amount| over transactions where category_id === STARTING_BALANCE_CATEGORY_ID
  // && amount < 0 && date <= monthEndStr. Cash starting balances flow into totalIncome
  // via READY_TO_ASSIGN_CATEGORY_ID income-category txns; credit-card opening debts
  // are stamped STARTING_BALANCE_CATEGORY_ID (a non-income system category) and would
  // otherwise be invisible to the engine — RTA would silently over-count by the sum
  // of opening CC debts. Subtracting this term restores symmetry with the cash side.
  openingCcDebt: number;
  // Clamped (>=0) sum of non-income assignments in months strictly after the
  // current month. Drains a positive Ready-to-assign toward zero (single
  // pool), floored so a future over-assignment can't push a past month negative.
  futureAssigned: number;
};

// Split with joined category name (for display)
export type TransactionSplitWithCategory = TransactionSplit & {
  category_name: string | null;
};

// Transaction with joined display names
export type TransactionWithDetails = Transaction & {
  account_name: string;
  category_name: string | null;
  category_group_name: string | null;
  split_count?: number;
  splits?: TransactionSplitWithCategory[];
};
