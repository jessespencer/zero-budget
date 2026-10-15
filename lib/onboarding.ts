import { getDb, DEFAULT_USER_ID } from "./db";
import { getSetting } from "./app-settings";

// First-run setup checklist (SEED-001). Every step but the last is derived
// from real data, so the checklist can't drift from what's actually set up.
// The two flags live in app_settings and are only ever written by server
// actions fired from the checklist itself — never during render.
export const ONBOARDING_DISMISSED_KEY = "onboarding_dismissed";
export const ONBOARDING_TRANSFER_PLAN_SEEN_KEY = "onboarding_transfer_plan_seen";

export type OnboardingAccount = { id: string; name: string };

export type OnboardingState = {
  /** Open accounts that could become primary — on-budget, not credit cards. */
  primaryCandidates: OnboardingAccount[];
  accountCount: number;
  primaryAccountName: string | null;
  /** A spending group exists — it may still be empty. */
  hasGroups: boolean;
  hasCategories: boolean;
  transferPlanSeen: boolean;
};

/** Null once the checklist is dismissed (migration 030 pre-dismisses existing installs). */
export function getOnboardingState(): OnboardingState | null {
  if (getSetting(ONBOARDING_DISMISSED_KEY) === "1") return null;
  const db = getDb();

  const accounts = db
    .prepare(
      `SELECT id, name, type, is_budget_account, is_primary FROM accounts
       WHERE user_id = ? AND archived = 0 ORDER BY sort_order`
    )
    .all(DEFAULT_USER_ID) as {
    id: string;
    name: string;
    type: string;
    is_budget_account: number;
    is_primary: number;
  }[];

  const { count: categoryCount } = db
    .prepare(
      `SELECT COUNT(*) AS count FROM categories c
       JOIN category_groups g ON g.id = c.category_group_id
       WHERE c.user_id = ? AND g.is_system = 0 AND g.is_income = 0`
    )
    .get(DEFAULT_USER_ID) as { count: number };

  const { count: groupCount } = db
    .prepare(
      `SELECT COUNT(*) AS count FROM category_groups
       WHERE user_id = ? AND is_system = 0 AND is_income = 0`
    )
    .get(DEFAULT_USER_ID) as { count: number };

  return {
    primaryCandidates: accounts
      .filter((a) => a.type !== "credit_card" && a.is_budget_account === 1)
      .map(({ id, name }) => ({ id, name })),
    accountCount: accounts.length,
    primaryAccountName: accounts.find((a) => a.is_primary === 1)?.name ?? null,
    hasGroups: groupCount > 0,
    hasCategories: categoryCount > 0,
    transferPlanSeen: getSetting(ONBOARDING_TRANSFER_PLAN_SEEN_KEY) === "1",
  };
}
