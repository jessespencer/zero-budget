import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";

// Server-action tests for the per-row history endpoints introduced by Wave 4:
//   updateTrackedAssetHistoryRowWithSnapshot / restoreTrackedAssetHistoryRowSnapshot
//   deleteTrackedAssetHistoryRowWithSnapshot / restoreTrackedAssetHistoryRowDeleteSnapshot
//
// Mirrors the pattern in tracked-asset-actions.test.ts: dynamic action imports
// so vitest's next/cache mock applies first, in-memory DB harness per test.

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  clearTestDb();
  db.close();
});

const assetRow = (id: string) =>
  db.prepare("SELECT * FROM tracked_assets WHERE id = ?").get(id) as
    | { current_value: number; updated_at: string }
    | undefined;

const historyRows = (assetId: string) =>
  db
    .prepare(
      "SELECT * FROM tracked_asset_history WHERE asset_id = ? ORDER BY recorded_at ASC, created_at ASC"
    )
    .all(assetId) as {
    id: string;
    asset_id: string;
    value: number;
    recorded_at: string;
    note: string | null;
    created_at: string;
  }[];

async function seedAssetWithHistory(name = "Brokerage") {
  const { createTrackedAsset, updateTrackedAssetValueWithSnapshot } =
    await import("@/app/(app)/assets/actions");
  const id = await createTrackedAsset({
    name,
    asset_type: "investment",
    initial_value: 1000,
    recorded_at: "2026-01-01",
  });
  // Add two more history rows to give edit/delete something interesting.
  await updateTrackedAssetValueWithSnapshot(id, {
    value: 1500,
    recorded_at: "2026-03-01",
  });
  await updateTrackedAssetValueWithSnapshot(id, {
    value: 2000,
    recorded_at: "2026-05-01",
  });
  return id;
}

describe("updateTrackedAssetHistoryRowWithSnapshot", () => {
  it("updates value and resyncs asset.current_value when editing the latest row", async () => {
    const assetId = await seedAssetWithHistory();
    const before = historyRows(assetId);
    const latestRow = before[before.length - 1]; // 2026-05-01 / $2000
    expect(assetRow(assetId)?.current_value).toBe(2000);

    const { updateTrackedAssetHistoryRowWithSnapshot } = await import(
      "@/app/(app)/assets/[id]/actions"
    );
    const snap = await updateTrackedAssetHistoryRowWithSnapshot(latestRow.id, {
      value: 2500,
    });

    expect(snap.previousValue).toBe(2000);
    expect(snap.previousAssetCurrentValue).toBe(2000);
    expect(snap.assetId).toBe(assetId);

    const after = historyRows(assetId);
    expect(after.find((r) => r.id === latestRow.id)?.value).toBe(2500);
    expect(assetRow(assetId)?.current_value).toBe(2500);
  });

  it("does NOT bump current_value when editing an older (non-latest) row", async () => {
    const assetId = await seedAssetWithHistory();
    const rows = historyRows(assetId);
    const middle = rows[1]; // 2026-03-01 / $1500
    expect(assetRow(assetId)?.current_value).toBe(2000);

    const { updateTrackedAssetHistoryRowWithSnapshot } = await import(
      "@/app/(app)/assets/[id]/actions"
    );
    await updateTrackedAssetHistoryRowWithSnapshot(middle.id, { value: 1750 });

    // current_value still pinned to the latest row (2000) — the middle edit
    // doesn't move it.
    expect(assetRow(assetId)?.current_value).toBe(2000);
    const updated = historyRows(assetId).find((r) => r.id === middle.id);
    expect(updated?.value).toBe(1750);
  });

  it("changing recorded_at can swap which row is latest, updating current_value", async () => {
    const assetId = await seedAssetWithHistory();
    const rows = historyRows(assetId);
    const middle = rows[1]; // 2026-03-01 / $1500
    expect(assetRow(assetId)?.current_value).toBe(2000);

    const { updateTrackedAssetHistoryRowWithSnapshot } = await import(
      "@/app/(app)/assets/[id]/actions"
    );
    // Re-date the middle row to 2026-06-01 — now newer than 2026-05-01.
    await updateTrackedAssetHistoryRowWithSnapshot(middle.id, {
      recorded_at: "2026-06-01",
    });

    // current_value should now be the middle row's value ($1500).
    expect(assetRow(assetId)?.current_value).toBe(1500);
  });

  it("restoreTrackedAssetHistoryRowSnapshot reverses the edit byte-for-byte", async () => {
    const assetId = await seedAssetWithHistory();
    const rows = historyRows(assetId);
    const latest = rows[rows.length - 1]; // $2000 / 2026-05-01
    const beforeAsset = assetRow(assetId)!;

    const {
      updateTrackedAssetHistoryRowWithSnapshot,
      restoreTrackedAssetHistoryRowSnapshot,
    } = await import("@/app/(app)/assets/[id]/actions");
    const snap = await updateTrackedAssetHistoryRowWithSnapshot(latest.id, {
      value: 9999,
      note: "wrong",
    });
    expect(assetRow(assetId)?.current_value).toBe(9999);

    await restoreTrackedAssetHistoryRowSnapshot(snap);

    const restored = historyRows(assetId).find((r) => r.id === latest.id);
    expect(restored?.value).toBe(2000);
    expect(restored?.note).toBe(latest.note);
    expect(assetRow(assetId)?.current_value).toBe(beforeAsset.current_value);
    expect(assetRow(assetId)?.updated_at).toBe(beforeAsset.updated_at);
  });
});

describe("deleteTrackedAssetHistoryRowWithSnapshot", () => {
  it("deletes the row and resyncs current_value to the new latest", async () => {
    const assetId = await seedAssetWithHistory();
    const rows = historyRows(assetId);
    const latest = rows[rows.length - 1]; // $2000 / 2026-05-01
    expect(assetRow(assetId)?.current_value).toBe(2000);

    const { deleteTrackedAssetHistoryRowWithSnapshot } = await import(
      "@/app/(app)/assets/[id]/actions"
    );
    const snap = await deleteTrackedAssetHistoryRowWithSnapshot(latest.id);
    expect(snap).not.toBeNull();

    // Latest is now the 2026-03-01 / $1500 row.
    expect(assetRow(assetId)?.current_value).toBe(1500);
    expect(historyRows(assetId)).toHaveLength(2);
  });

  it("resets current_value to 0 when deleting the only remaining row", async () => {
    const { createTrackedAsset } = await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "Solo",
      asset_type: "other",
      initial_value: 500,
    });
    const only = historyRows(id)[0];

    const { deleteTrackedAssetHistoryRowWithSnapshot } = await import(
      "@/app/(app)/assets/[id]/actions"
    );
    await deleteTrackedAssetHistoryRowWithSnapshot(only.id);

    expect(historyRows(id)).toHaveLength(0);
    expect(assetRow(id)?.current_value).toBe(0);
  });

  it("restoreTrackedAssetHistoryRowDeleteSnapshot re-inserts the row exactly", async () => {
    const assetId = await seedAssetWithHistory();
    const rows = historyRows(assetId);
    const latest = rows[rows.length - 1];
    const beforeAsset = assetRow(assetId)!;

    const {
      deleteTrackedAssetHistoryRowWithSnapshot,
      restoreTrackedAssetHistoryRowDeleteSnapshot,
    } = await import("@/app/(app)/assets/[id]/actions");
    const snap = await deleteTrackedAssetHistoryRowWithSnapshot(latest.id);
    expect(snap).not.toBeNull();
    await restoreTrackedAssetHistoryRowDeleteSnapshot(snap!);

    const restored = historyRows(assetId).find((r) => r.id === latest.id);
    expect(restored).toBeTruthy();
    expect(restored?.value).toBe(latest.value);
    expect(restored?.recorded_at).toBe(latest.recorded_at);
    expect(restored?.note).toBe(latest.note);
    expect(restored?.created_at).toBe(latest.created_at);
    expect(assetRow(assetId)?.current_value).toBe(beforeAsset.current_value);
    expect(assetRow(assetId)?.updated_at).toBe(beforeAsset.updated_at);
  });

  it("does NOT touch budget tables", async () => {
    const assetId = await seedAssetWithHistory();
    const txnCountBefore = db
      .prepare("SELECT COUNT(*) AS c FROM transactions")
      .get() as { c: number };
    const budgetCountBefore = db
      .prepare("SELECT COUNT(*) AS c FROM monthly_budgets")
      .get() as { c: number };
    const catCountBefore = db
      .prepare("SELECT COUNT(*) AS c FROM categories")
      .get() as { c: number };

    const rows = historyRows(assetId);
    const { deleteTrackedAssetHistoryRowWithSnapshot } = await import(
      "@/app/(app)/assets/[id]/actions"
    );
    await deleteTrackedAssetHistoryRowWithSnapshot(rows[0].id);

    const txnCountAfter = db
      .prepare("SELECT COUNT(*) AS c FROM transactions")
      .get() as { c: number };
    const budgetCountAfter = db
      .prepare("SELECT COUNT(*) AS c FROM monthly_budgets")
      .get() as { c: number };
    const catCountAfter = db
      .prepare("SELECT COUNT(*) AS c FROM categories")
      .get() as { c: number };

    expect(txnCountAfter).toEqual(txnCountBefore);
    expect(budgetCountAfter).toEqual(budgetCountBefore);
    expect(catCountAfter).toEqual(catCountBefore);
  });
});
