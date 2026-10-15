import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, setTestDb, clearTestDb } from "../../setup/test-db";

const USER_ID = "00000000-0000-0000-0000-000000000000";

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
    | Record<string, unknown>
    | undefined;

const historyRows = (assetId: string) =>
  db
    .prepare(
      "SELECT * FROM tracked_asset_history WHERE asset_id = ? ORDER BY recorded_at ASC, created_at ASC"
    )
    .all(assetId) as Record<string, unknown>[];

const todayIso = () => new Date().toISOString().slice(0, 10);

describe("createTrackedAsset", () => {
  it("inserts a tracked_assets row plus an initial history row", async () => {
    const { createTrackedAsset } = await import(
      "@/app/(app)/assets/actions"
    );
    const id = await createTrackedAsset({
      name: "Brokerage",
      asset_type: "investment",
      initial_value: 5000.005,
    });

    const row = assetRow(id);
    expect(row).toBeTruthy();
    expect(row?.user_id).toBe(USER_ID);
    expect(row?.name).toBe("Brokerage");
    expect(row?.asset_type).toBe("investment");
    expect(row?.current_value).toBe(5000.01); // rounded
    expect(row?.archived).toBe(0);

    const history = historyRows(id);
    expect(history).toHaveLength(1);
    expect(history[0].value).toBe(5000.01);
    expect(history[0].recorded_at).toBe(todayIso());
  });

  it("uses provided recorded_at when given", async () => {
    const { createTrackedAsset } = await import(
      "@/app/(app)/assets/actions"
    );
    const id = await createTrackedAsset({
      name: "House",
      asset_type: "real_estate",
      initial_value: 200000,
      recorded_at: "2025-01-15",
      note: "Zillow estimate",
    });

    const history = historyRows(id);
    expect(history[0].recorded_at).toBe("2025-01-15");
    expect(history[0].note).toBe("Zillow estimate");
  });

  it("assigns sort_order as max+1", async () => {
    const { createTrackedAsset } = await import(
      "@/app/(app)/assets/actions"
    );
    const a = await createTrackedAsset({
      name: "A",
      asset_type: "crypto",
      initial_value: 1,
    });
    const b = await createTrackedAsset({
      name: "B",
      asset_type: "crypto",
      initial_value: 2,
    });
    const rowA = assetRow(a);
    const rowB = assetRow(b);
    expect(rowB?.sort_order).toBeGreaterThan(rowA?.sort_order as number);
  });

  it("rejects empty name", async () => {
    const { createTrackedAsset } = await import(
      "@/app/(app)/assets/actions"
    );
    await expect(
      createTrackedAsset({
        name: "  ",
        asset_type: "investment",
        initial_value: 1,
      })
    ).rejects.toThrow(/Invalid input/);
  });

  it("rejects non-finite initial_value", async () => {
    const { createTrackedAsset } = await import(
      "@/app/(app)/assets/actions"
    );
    await expect(
      createTrackedAsset({
        name: "X",
        asset_type: "investment",
        initial_value: Number.NaN,
      })
    ).rejects.toThrow(/Invalid input/);
  });
});

describe("getTrackedAssets / getTrackedAssetWithHistory", () => {
  it("returns non-archived assets ordered by sort_order then created_at", async () => {
    const { createTrackedAsset, getTrackedAssets } = await import(
      "@/app/(app)/assets/actions"
    );
    const a = await createTrackedAsset({
      name: "A",
      asset_type: "investment",
      initial_value: 100,
    });
    const b = await createTrackedAsset({
      name: "B",
      asset_type: "crypto",
      initial_value: 50,
    });

    // Archive A — it should not appear in default getTrackedAssets
    db.prepare(
      "UPDATE tracked_assets SET archived = 1 WHERE id = ?"
    ).run(a);

    const assets = await getTrackedAssets();
    expect(assets.map((x) => x.id)).toEqual([b]);
    // Boolean mapping in effect (archived becomes false on returned rows)
    expect(assets[0].archived).toBe(false);
  });

  it("returns asset + history sorted DESC", async () => {
    const {
      createTrackedAsset,
      updateTrackedAssetValueWithSnapshot,
      getTrackedAssetWithHistory,
    } = await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "Crypto",
      asset_type: "crypto",
      initial_value: 1000,
      recorded_at: "2025-01-01",
    });
    await updateTrackedAssetValueWithSnapshot(id, {
      value: 1500,
      recorded_at: "2025-06-01",
    });
    await updateTrackedAssetValueWithSnapshot(id, {
      value: 2000,
      recorded_at: "2025-03-01",
    });

    const { asset, history } = await getTrackedAssetWithHistory(id);
    expect(asset?.id).toBe(id);
    expect(history.map((h) => h.recorded_at)).toEqual([
      "2025-06-01",
      "2025-03-01",
      "2025-01-01",
    ]);
  });
});

describe("updateTrackedAssetValueWithSnapshot + restore", () => {
  it("inserts a history row and updates current_value when recorded_at is latest", async () => {
    const { createTrackedAsset, updateTrackedAssetValueWithSnapshot } =
      await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "X",
      asset_type: "investment",
      initial_value: 1000,
      recorded_at: "2025-01-01",
    });
    const snap = await updateTrackedAssetValueWithSnapshot(id, {
      value: 2000,
      recorded_at: "2025-06-01",
    });

    expect(snap.previousCurrentValue).toBe(1000);
    expect(snap.assetId).toBe(id);
    expect(snap.insertedHistoryId).toBeTruthy();

    const row = assetRow(id);
    expect(row?.current_value).toBe(2000);
    expect(historyRows(id)).toHaveLength(2);
  });

  it("does NOT update current_value when recorded_at is older than existing", async () => {
    const { createTrackedAsset, updateTrackedAssetValueWithSnapshot } =
      await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "X",
      asset_type: "investment",
      initial_value: 1000,
      recorded_at: "2025-06-01",
    });
    await updateTrackedAssetValueWithSnapshot(id, {
      value: 9999,
      recorded_at: "2024-01-01",
    });
    const row = assetRow(id);
    expect(row?.current_value).toBe(1000); // unchanged — backfill
  });

  it("restoreTrackedAssetValueSnapshot deletes the history row and restores current_value + updated_at", async () => {
    const {
      createTrackedAsset,
      updateTrackedAssetValueWithSnapshot,
      restoreTrackedAssetValueSnapshot,
    } = await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "X",
      asset_type: "investment",
      initial_value: 1000,
      recorded_at: "2025-01-01",
    });
    const snap = await updateTrackedAssetValueWithSnapshot(id, {
      value: 2000,
      recorded_at: "2025-06-01",
    });

    await restoreTrackedAssetValueSnapshot(snap);
    const row = assetRow(id);
    expect(row?.current_value).toBe(1000);
    expect(row?.updated_at).toBe(snap.previousUpdatedAt);
    expect(historyRows(id)).toHaveLength(1);
  });
});

describe("updateTrackedAssetMetaWithSnapshot + restore", () => {
  it("updates name and type; restore reverts both plus updated_at", async () => {
    const {
      createTrackedAsset,
      updateTrackedAssetMetaWithSnapshot,
      restoreTrackedAssetMetaSnapshot,
    } = await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "Old",
      asset_type: "investment",
      initial_value: 100,
    });
    const before = assetRow(id);

    // Wait 2ms so updated_at advances past the original timestamp's
    // millisecond — in the same tick, ISO timestamps are byte-identical.
    await new Promise((r) => setTimeout(r, 2));

    const snap = await updateTrackedAssetMetaWithSnapshot(id, {
      name: "New",
      asset_type: "crypto",
      notes: "memo",
    });
    expect(snap.previousName).toBe("Old");
    expect(snap.previousAssetType).toBe("investment");

    const updated = assetRow(id);
    expect(updated?.name).toBe("New");
    expect(updated?.asset_type).toBe("crypto");
    expect(updated?.notes).toBe("memo");
    expect(updated?.updated_at).not.toBe(before?.updated_at);

    await restoreTrackedAssetMetaSnapshot(snap);
    const restored = assetRow(id);
    expect(restored?.name).toBe("Old");
    expect(restored?.asset_type).toBe("investment");
    expect(restored?.notes).toBe(before?.notes ?? null);
    expect(restored?.updated_at).toBe(snap.previousUpdatedAt);
  });
});

describe("archiveTrackedAssetWithSnapshot + restore", () => {
  it("sets archived=1 and restore reverts plus restores updated_at", async () => {
    const {
      createTrackedAsset,
      archiveTrackedAssetWithSnapshot,
      restoreTrackedAssetArchiveSnapshot,
    } = await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "X",
      asset_type: "investment",
      initial_value: 100,
    });

    const snap = await archiveTrackedAssetWithSnapshot(id);
    expect(snap.previouslyArchived).toBe(false);
    expect(assetRow(id)?.archived).toBe(1);

    await restoreTrackedAssetArchiveSnapshot(snap);
    expect(assetRow(id)?.archived).toBe(0);
    expect(assetRow(id)?.updated_at).toBe(snap.previousUpdatedAt);
  });
});

describe("getArchivedTrackedAssets", () => {
  it("returns only archived assets, and getTrackedAssets only live ones", async () => {
    const {
      createTrackedAsset,
      archiveTrackedAssetWithSnapshot,
      getTrackedAssets,
      getArchivedTrackedAssets,
    } = await import("@/app/(app)/assets/actions");
    const liveId = await createTrackedAsset({
      name: "Brokerage",
      asset_type: "investment",
      initial_value: 100,
    });
    const goneId = await createTrackedAsset({
      name: "Old car",
      asset_type: "vehicle",
      initial_value: 200,
    });
    await archiveTrackedAssetWithSnapshot(goneId);

    // The split is the whole point: net worth reads getTrackedAssets, and an
    // archived asset leaking into it would silently inflate the total.
    expect((await getTrackedAssets()).map((a) => a.id)).toEqual([liveId]);
    expect((await getArchivedTrackedAssets()).map((a) => a.id)).toEqual([goneId]);
  });

  it("returns an empty list when nothing is archived", async () => {
    const { createTrackedAsset, getArchivedTrackedAssets } = await import(
      "@/app/(app)/assets/actions"
    );
    await createTrackedAsset({
      name: "Brokerage",
      asset_type: "investment",
      initial_value: 100,
    });

    expect(await getArchivedTrackedAssets()).toEqual([]);
  });

  it("sorts by name, not sort_order", async () => {
    const {
      createTrackedAsset,
      archiveTrackedAssetWithSnapshot,
      getArchivedTrackedAssets,
    } = await import("@/app/(app)/assets/actions");
    // Created (and so sort_order'd) in reverse alphabetical order.
    for (const name of ["Zeta", "Alpha"]) {
      const id = await createTrackedAsset({
        name,
        asset_type: "other",
        initial_value: 1,
      });
      await archiveTrackedAssetWithSnapshot(id);
    }

    expect((await getArchivedTrackedAssets()).map((a) => a.name)).toEqual([
      "Alpha",
      "Zeta",
    ]);
  });
});

describe("unarchiveTrackedAsset", () => {
  it("clears archived and stamps a fresh updated_at", async () => {
    const {
      createTrackedAsset,
      archiveTrackedAssetWithSnapshot,
      unarchiveTrackedAsset,
    } = await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "Brokerage",
      asset_type: "investment",
      initial_value: 100,
    });
    await archiveTrackedAssetWithSnapshot(id);
    // Backdate so the assertion can't pass or fail on whether the whole test
    // happened to run inside one millisecond — now() is ms-resolution, and
    // archive-then-unarchive is comfortably faster than that.
    const stale = "2020-01-01T00:00:00.000Z";
    db.prepare("UPDATE tracked_assets SET updated_at = ? WHERE id = ?").run(
      stale,
      id
    );

    const result = await unarchiveTrackedAsset(id);

    expect(result).toEqual({ ok: true });
    expect(assetRow(id)?.archived).toBe(0);
    // Stamped fresh, NOT restored — this is a deliberate edit the user is
    // making now, unlike restoreTrackedAssetArchiveSnapshot, which is an undo
    // and puts the prior updated_at back.
    expect(assetRow(id)?.updated_at).not.toBe(stale);
  });

  it("leaves the asset's history untouched", async () => {
    const {
      createTrackedAsset,
      archiveTrackedAssetWithSnapshot,
      unarchiveTrackedAsset,
    } = await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "Brokerage",
      asset_type: "investment",
      initial_value: 100,
    });
    const before = historyRows(id);
    await archiveTrackedAssetWithSnapshot(id);

    await unarchiveTrackedAsset(id);

    expect(historyRows(id)).toEqual(before);
  });

  it("returns not_found for an unknown id", async () => {
    const { unarchiveTrackedAsset } = await import(
      "@/app/(app)/assets/actions"
    );

    expect(await unarchiveTrackedAsset("nope")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("does not touch an asset belonging to a different user", async () => {
    const { unarchiveTrackedAsset } = await import(
      "@/app/(app)/assets/actions"
    );
    const id = "asset-other-user";
    db.prepare(
      `INSERT INTO tracked_assets (id, user_id, name, asset_type, current_value, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, 1, ?, ?)`
    ).run(id, "11111111-1111-1111-1111-111111111111", "Theirs", "other", todayIso(), todayIso());

    expect(await unarchiveTrackedAsset(id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(assetRow(id)?.archived).toBe(1);
  });
});

describe("deleteTrackedAssetWithSnapshot + restore", () => {
  it("captures asset + all history; restore re-inserts both", async () => {
    const {
      createTrackedAsset,
      updateTrackedAssetValueWithSnapshot,
      deleteTrackedAssetWithSnapshot,
      restoreTrackedAssetSnapshot,
    } = await import("@/app/(app)/assets/actions");
    const id = await createTrackedAsset({
      name: "Killable",
      asset_type: "crypto",
      initial_value: 1000,
      recorded_at: "2025-01-01",
    });
    await updateTrackedAssetValueWithSnapshot(id, {
      value: 1200,
      recorded_at: "2025-02-01",
    });
    await updateTrackedAssetValueWithSnapshot(id, {
      value: 1300,
      recorded_at: "2025-03-01",
    });

    const snap = await deleteTrackedAssetWithSnapshot(id);
    expect(snap).toBeTruthy();
    expect(snap!.asset.id).toBe(id);
    expect(snap!.history).toHaveLength(3);
    expect(assetRow(id)).toBeUndefined();
    expect(historyRows(id)).toHaveLength(0);

    await restoreTrackedAssetSnapshot(snap!);
    expect(assetRow(id)).toBeTruthy();
    expect(historyRows(id)).toHaveLength(3);
  });

  it("returns null when asset does not exist", async () => {
    const { deleteTrackedAssetWithSnapshot } = await import(
      "@/app/(app)/assets/actions"
    );
    const result = await deleteTrackedAssetWithSnapshot("nonexistent");
    expect(result).toBeNull();
  });
});

describe("BUDGET-ISOLATION: assets actions never write to budget tables", () => {
  it("creating + updating + deleting a tracked asset leaves transactions/monthly_budgets/categories untouched", async () => {
    const {
      createTrackedAsset,
      updateTrackedAssetValueWithSnapshot,
      deleteTrackedAssetWithSnapshot,
    } = await import("@/app/(app)/assets/actions");

    const before = {
      transactions: db
        .prepare("SELECT COUNT(*) as c FROM transactions")
        .get() as { c: number },
      monthly_budgets: db
        .prepare("SELECT COUNT(*) as c FROM monthly_budgets")
        .get() as { c: number },
      categories: db
        .prepare("SELECT COUNT(*) as c FROM categories")
        .get() as { c: number },
      category_groups: db
        .prepare("SELECT COUNT(*) as c FROM category_groups")
        .get() as { c: number },
    };

    const id = await createTrackedAsset({
      name: "Iso",
      asset_type: "investment",
      initial_value: 100,
    });
    await updateTrackedAssetValueWithSnapshot(id, { value: 200 });
    await deleteTrackedAssetWithSnapshot(id);

    const after = {
      transactions: db
        .prepare("SELECT COUNT(*) as c FROM transactions")
        .get() as { c: number },
      monthly_budgets: db
        .prepare("SELECT COUNT(*) as c FROM monthly_budgets")
        .get() as { c: number },
      categories: db
        .prepare("SELECT COUNT(*) as c FROM categories")
        .get() as { c: number },
      category_groups: db
        .prepare("SELECT COUNT(*) as c FROM category_groups")
        .get() as { c: number },
    };

    expect(after.transactions.c).toBe(before.transactions.c);
    expect(after.monthly_budgets.c).toBe(before.monthly_budgets.c);
    expect(after.categories.c).toBe(before.categories.c);
    expect(after.category_groups.c).toBe(before.category_groups.c);
  });
});
