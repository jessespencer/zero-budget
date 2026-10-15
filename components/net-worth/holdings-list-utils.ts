import type { Account, AccountType, TrackedAsset, TrackedAssetType } from "@/lib/types";

/**
 * A tracked asset augmented with the most-recent `tracked_asset_history.recorded_at`
 * timestamp (ISO date string YYYY-MM-DD), or null when no history exists.
 * Server side populates this from the trackedAssetLastUpdated map.
 */
export type TrackedAssetWithLast = TrackedAsset & {
  lastRecordedAt?: string | null;
};

export type HoldingGroupKey =
  | "cash"
  | "credit_cards"
  | "investments"
  | "retirement"
  | "real_estate"
  | "crypto"
  | "vehicles"
  | "other";

export type HoldingGroupSpec = {
  key: HoldingGroupKey;
  label: string;
  accountTypes: AccountType[];
  assetTypes: TrackedAssetType[];
};

/**
 * Canonical render order for holdings groups. Sentence-case labels per
 * CLAUDE.md. Mirrors components/shared/sidebar.tsx TYPE_SECTION_ORDER intent
 * but adds the tracked-asset dimension and merges checking/savings/cash into
 * a single "Cash and checking" bucket per SPEC requirement 7.
 */
export const GROUP_ORDER: HoldingGroupSpec[] = [
  {
    key: "cash",
    label: "Cash and checking",
    accountTypes: ["checking", "savings", "cash"],
    assetTypes: [],
  },
  {
    key: "credit_cards",
    label: "Credit cards",
    accountTypes: ["credit_card"],
    assetTypes: [],
  },
  {
    key: "investments",
    label: "Investments",
    accountTypes: [],
    assetTypes: ["investment"],
  },
  {
    key: "retirement",
    label: "Retirement",
    accountTypes: [],
    assetTypes: ["retirement"],
  },
  {
    key: "real_estate",
    label: "Real estate",
    accountTypes: [],
    assetTypes: ["real_estate"],
  },
  {
    key: "crypto",
    label: "Crypto",
    accountTypes: [],
    assetTypes: ["crypto"],
  },
  {
    key: "vehicles",
    label: "Vehicles",
    accountTypes: [],
    assetTypes: ["vehicle"],
  },
  {
    key: "other",
    label: "Other",
    accountTypes: ["other"],
    assetTypes: ["other"],
  },
];

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Checking",
  cash: "Cash",
  savings: "Savings",
  credit_card: "Credit card",
  other: "Other",
};

const ASSET_TYPE_LABEL: Record<TrackedAssetType, string> = {
  investment: "Investment",
  retirement: "Retirement",
  real_estate: "Real estate",
  crypto: "Crypto",
  vehicle: "Vehicle",
  other: "Other",
};

export type HoldingRow = {
  kind: "account" | "asset";
  id: string;
  name: string;
  typeLabel: string;
  balance: number;
  href: string;
  /** Whole-day count since last update. Only set for tracked-asset rows. */
  lastUpdatedDays?: number | null;
};

export type HoldingGroup = {
  key: HoldingGroupKey;
  label: string;
  total: number;
  items: HoldingRow[];
};

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const recorded = Date.UTC(y, m - 1, d);
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const diff = Math.round((todayUtc - recorded) / (1000 * 60 * 60 * 24));
  return diff < 0 ? 0 : diff;
}

/**
 * Group accounts + tracked assets into the eight canonical holdings groups.
 * Archived rows are excluded. Each group is returned in canonical order even
 * when empty — the render layer hides empty groups.
 */
export function groupItems(
  accounts: Account[],
  trackedAssets: TrackedAssetWithLast[]
): HoldingGroup[] {
  const activeAccounts = accounts.filter((a) => !a.archived);
  const activeAssets = trackedAssets.filter((a) => !a.archived);

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  return GROUP_ORDER.map((spec) => {
    const accountItems: HoldingRow[] = activeAccounts
      .filter((a) => spec.accountTypes.includes(a.type))
      .sort(byName)
      .map((a) => ({
        kind: "account" as const,
        id: a.id,
        name: a.name,
        typeLabel: ACCOUNT_TYPE_LABEL[a.type],
        balance: Number(a.current_balance),
        href: `/accounts/${a.id}?from=insights`,
      }));

    const assetItems: HoldingRow[] = activeAssets
      .filter((a) => spec.assetTypes.includes(a.asset_type))
      .sort(byName)
      .map((a) => ({
        kind: "asset" as const,
        id: a.id,
        name: a.name,
        typeLabel: ASSET_TYPE_LABEL[a.asset_type],
        balance: Number(a.current_value),
        href: `/assets/${a.id}`,
        lastUpdatedDays: daysSince(a.lastRecordedAt ?? null),
      }));

    const items = [...accountItems, ...assetItems];
    const total = items.reduce((sum, i) => sum + i.balance, 0);
    return { key: spec.key, label: spec.label, total, items };
  });
}

export const __test_groupItems = groupItems;
