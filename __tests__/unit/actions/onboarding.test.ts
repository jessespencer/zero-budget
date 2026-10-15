import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  clearTestDb();
  db.close();
});

const isPrimary = (id: string) =>
  (db.prepare("SELECT is_primary FROM accounts WHERE id = ?").get(id) as { is_primary: number })
    .is_primary === 1;

const spendingCategoryCount = () =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM categories c
         JOIN category_groups g ON g.id = c.category_group_id
         WHERE g.is_system = 0 AND g.is_income = 0`
      )
      .get() as { n: number }
  ).n;

describe("createAccount primary default", () => {
  it("makes the first checking account primary", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const id = await createAccount({ name: "Checking", type: "checking" });
    expect(isPrimary(id)).toBe(true);
  });

  it("never moves the primary flag off an existing primary account", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const first = await createAccount({ name: "Checking", type: "checking" });
    const second = await createAccount({ name: "Joint checking", type: "checking" });
    expect(isPrimary(first)).toBe(true);
    expect(isPrimary(second)).toBe(false);
  });

  it("leaves savings, credit cards, and tracking-only checking non-primary", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const savings = await createAccount({ name: "Savings", type: "savings" });
    const card = await createAccount({ name: "Card", type: "credit_card" });
    const tracking = await createAccount({ name: "Old checking", type: "checking", onBudget: false });
    expect([savings, card, tracking].map(isPrimary)).toEqual([false, false, false]);
  });
});

describe("addStarterCategories", () => {
  it("adds the starter groups with their categories in order", async () => {
    const { addStarterCategories } = await import("@/app/(app)/budget/actions");
    expect(await addStarterCategories()).toEqual({ ok: true });

    const groups = db
      .prepare(
        "SELECT name FROM category_groups WHERE is_system = 0 AND is_income = 0 ORDER BY sort_order"
      )
      .all() as { name: string }[];
    expect(groups.map((g) => g.name)).toEqual(["Bills", "Everyday", "Savings goals"]);
    expect(spendingCategoryCount()).toBe(14);
  });

  it("refuses to add a second copy once any spending category exists", async () => {
    const { addStarterCategories } = await import("@/app/(app)/budget/actions");
    await addStarterCategories();
    expect(await addStarterCategories()).toEqual({ ok: false, reason: "has_categories" });
    expect(spendingCategoryCount()).toBe(14);
  });
});

describe("getOnboardingState", () => {
  it("reports an empty install as having nothing set up", async () => {
    const { getOnboardingState } = await import("@/lib/onboarding");
    expect(getOnboardingState()).toEqual({
      primaryCandidates: [],
      accountCount: 0,
      primaryAccountName: null,
      hasGroups: false,
      hasCategories: false,
      transferPlanSeen: false,
    });
  });

  it("ticks steps off from real data as setup progresses", async () => {
    const { createAccount } = await import("@/app/(app)/accounts/[id]/actions");
    const { addStarterCategories, markOnboardingTransferPlanSeen } = await import(
      "@/app/(app)/budget/actions"
    );
    const { getOnboardingState } = await import("@/lib/onboarding");

    await createAccount({ name: "Checking", type: "checking", currentBalance: 1000 });
    await createAccount({ name: "Card", type: "credit_card" });
    await addStarterCategories();
    await markOnboardingTransferPlanSeen();

    const state = getOnboardingState();
    expect(state).toMatchObject({
      accountCount: 2,
      primaryAccountName: "Checking",
      hasGroups: true,
      hasCategories: true,
      transferPlanSeen: true,
    });
    // Credit cards can't anchor the transfer plan, so they're never offered.
    expect(state?.primaryCandidates.map((a) => a.name)).toEqual(["Checking"]);
  });

  it("counts an empty group as started but not done", async () => {
    const { addCategoryGroup } = await import("@/app/(app)/budget/actions");
    const { getOnboardingState } = await import("@/lib/onboarding");
    await addCategoryGroup("Housing");
    expect(getOnboardingState()).toMatchObject({ hasGroups: true, hasCategories: false });
  });

  it("returns null once dismissed", async () => {
    const { dismissOnboarding } = await import("@/app/(app)/budget/actions");
    const { getOnboardingState } = await import("@/lib/onboarding");
    await dismissOnboarding();
    expect(getOnboardingState()).toBeNull();
  });
});
