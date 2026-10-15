"use server";

import { revalidatePath } from "next/cache";
import { getDb, DEFAULT_USER_ID } from "@/lib/db";
import { mapRow, mapRows, newId, now, roundCents } from "@/lib/db-utils";
import type {
  TrackedAsset,
  TrackedAssetHistory,
  TrackedAssetType,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Input + snapshot types
//
// `*Snapshot` types capture every byte needed to undo a mutation. The
// `previousUpdatedAt` field is included on every snapshot so the restore path
// can put the row back exactly as it was — never bumping updated_at to a
// post-restore timestamp (which would make the "last updated N days ago"
// subtext on the net-worth tab incorrect after an undo).
// ---------------------------------------------------------------------------

export type TrackedAssetCreateInput = {
  name: string;
  asset_type: TrackedAssetType;
  initial_value: number;
  recorded_at?: string;
  note?: string;
};

export type TrackedAssetValueUpdateInput = {
  value: number;
  recorded_at?: string;
  note?: string;
};

export type TrackedAssetValueSnapshot = {
  assetId: string;
  previousCurrentValue: number;
  insertedHistoryId: string;
  previousUpdatedAt: string;
};

export type TrackedAssetMetaSnapshot = {
  assetId: string;
  previousName: string;
  previousAssetType: TrackedAssetType;
  previousNotes: string | null;
  previousSortOrder: number;
  previousUpdatedAt: string;
};

export type TrackedAssetArchiveSnapshot = {
  assetId: string;
  previouslyArchived: boolean;
  previousUpdatedAt: string;
};

export type TrackedAssetDeleteSnapshot = {
  asset: TrackedAsset;
  history: TrackedAssetHistory[];
};

const VALID_ASSET_TYPES: ReadonlySet<TrackedAssetType> = new Set<TrackedAssetType>(
  ["investment", "retirement", "real_estate", "crypto", "vehicle", "other"]
);

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertFiniteNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid input: ${field} must be a finite number`);
  }
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export async function getTrackedAssets(): Promise<TrackedAsset[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM tracked_assets
       WHERE user_id = ? AND archived = 0
       ORDER BY sort_order, created_at`
    )
    .all(DEFAULT_USER_ID) as Record<string, unknown>[];
  return mapRows<TrackedAsset>(rows);
}

/**
 * Archived assets, for the holdings list's Archived section.
 *
 * A sibling query rather than widening `getTrackedAssets`: five readers
 * (`lib/net-worth.ts`, `lib/net-worth-series.ts`, `insights/actions.ts`,
 * `holdings-list-utils.ts`, and `getTrackedAssets` itself) all assume the list
 * they get is already free of archived rows. Same reasoning as the accounts
 * Closed section, which took the sibling-query route in `app/(app)/layout.tsx`
 * for exactly this — net worth must not silently start counting archived
 * assets.
 *
 * Ordered by name: the Archived section has no drag handle, so `sort_order`
 * there is whatever it happened to be on the day it was archived.
 */
export async function getArchivedTrackedAssets(): Promise<TrackedAsset[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM tracked_assets
       WHERE user_id = ? AND archived = 1
       ORDER BY name COLLATE NOCASE`
    )
    .all(DEFAULT_USER_ID) as Record<string, unknown>[];
  return mapRows<TrackedAsset>(rows);
}

export type TrackedAssetUnarchiveError = { ok: false; reason: "not_found" };

/**
 * Deliberate unarchive from the holdings list's Archived section.
 *
 * Distinct from `restoreTrackedAssetArchiveSnapshot` below, which is undo-only
 * and restores the asset's whole prior row (including `updated_at`). This is a
 * fresh edit the user is making now, so it stamps `updated_at` like any other.
 * Mirrors `reopenAccount` in `app/(app)/accounts/[id]/actions.ts`.
 */
export async function unarchiveTrackedAsset(
  id: string
): Promise<TrackedAssetUnarchiveError | { ok: true }> {
  const db = getDb();

  const exists = db
    .prepare("SELECT id FROM tracked_assets WHERE id = ? AND user_id = ?")
    .get(id, DEFAULT_USER_ID) as { id: string } | undefined;

  if (!exists) return { ok: false, reason: "not_found" };

  db.prepare(
    "UPDATE tracked_assets SET archived = 0, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(now(), id, DEFAULT_USER_ID);

  revalidatePath("/insights");
  revalidatePath(`/assets/${id}`);
  return { ok: true };
}

export async function getTrackedAssetWithHistory(
  id: string
): Promise<{ asset: TrackedAsset | null; history: TrackedAssetHistory[] }> {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM tracked_assets WHERE id = ? AND user_id = ?")
    .get(id, DEFAULT_USER_ID) as Record<string, unknown> | undefined;
  const asset = row ? mapRow<TrackedAsset>(row) : null;

  const historyRows = db
    .prepare(
      `SELECT * FROM tracked_asset_history
       WHERE asset_id = ?
       ORDER BY recorded_at DESC, created_at DESC`
    )
    .all(id) as Record<string, unknown>[];
  const history = mapRows<TrackedAssetHistory>(historyRows);

  return { asset, history };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createTrackedAsset(
  input: TrackedAssetCreateInput
): Promise<string> {
  if (!input.name || !input.name.trim()) {
    throw new Error("Invalid input: name is required");
  }
  if (!VALID_ASSET_TYPES.has(input.asset_type)) {
    throw new Error("Invalid input: asset_type is not recognized");
  }
  assertFiniteNumber(input.initial_value, "initial_value");

  const db = getDb();
  const id = newId();
  const timestamp = now();
  const recordedAt = input.recorded_at ?? todayDateStr();
  const rounded = roundCents(input.initial_value);

  db.transaction(() => {
    const maxOrder = db
      .prepare(
        `SELECT MAX(sort_order) AS max_order FROM tracked_assets WHERE user_id = ?`
      )
      .get(DEFAULT_USER_ID) as { max_order: number | null } | undefined;
    const sortOrder = (maxOrder?.max_order ?? -1) + 1;

    db.prepare(
      `INSERT INTO tracked_assets
         (id, user_id, name, asset_type, current_value, notes, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      id,
      DEFAULT_USER_ID,
      input.name.trim(),
      input.asset_type,
      rounded,
      null,
      sortOrder,
      timestamp,
      timestamp
    );

    db.prepare(
      `INSERT INTO tracked_asset_history
         (id, asset_id, value, recorded_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(newId(), id, rounded, recordedAt, input.note ?? null, timestamp);
  })();

  revalidatePath("/insights");
  return id;
}

// ---------------------------------------------------------------------------
// Update value (with snapshot)
// ---------------------------------------------------------------------------

export async function updateTrackedAssetValueWithSnapshot(
  assetId: string,
  input: TrackedAssetValueUpdateInput
): Promise<TrackedAssetValueSnapshot> {
  if (!assetId) {
    throw new Error("Invalid input: assetId is required");
  }
  assertFiniteNumber(input.value, "value");

  const db = getDb();
  const recordedAt = input.recorded_at ?? todayDateStr();
  const rounded = roundCents(input.value);
  const timestamp = now();
  const historyId = newId();

  let snapshot: TrackedAssetValueSnapshot | null = null;

  db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT current_value, updated_at FROM tracked_assets WHERE id = ? AND user_id = ?"
      )
      .get(assetId, DEFAULT_USER_ID) as
      | { current_value: number; updated_at: string }
      | undefined;
    if (!existing) {
      throw new Error(`Tracked asset ${assetId} not found`);
    }

    db.prepare(
      `INSERT INTO tracked_asset_history
         (id, asset_id, value, recorded_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(historyId, assetId, rounded, recordedAt, input.note ?? null, timestamp);

    // Only bump current_value when the new row is the most recent for this asset.
    // Backfilled values (older recorded_at) do NOT move current_value.
    const latest = db
      .prepare(
        "SELECT MAX(recorded_at) AS max_recorded FROM tracked_asset_history WHERE asset_id = ?"
      )
      .get(assetId) as { max_recorded: string | null } | undefined;

    if (latest?.max_recorded === recordedAt) {
      db.prepare(
        "UPDATE tracked_assets SET current_value = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).run(rounded, timestamp, assetId, DEFAULT_USER_ID);
    }

    snapshot = {
      assetId,
      previousCurrentValue: Number(existing.current_value),
      insertedHistoryId: historyId,
      previousUpdatedAt: existing.updated_at,
    };
  })();

  revalidatePath("/insights");
  revalidatePath(`/assets/${assetId}`);

  if (!snapshot) {
    // Unreachable — transaction throws above if existing is missing.
    throw new Error(`Tracked asset ${assetId} not found`);
  }
  return snapshot;
}

export async function restoreTrackedAssetValueSnapshot(
  snapshot: TrackedAssetValueSnapshot
): Promise<void> {
  const db = getDb();

  db.transaction(() => {
    db.prepare("DELETE FROM tracked_asset_history WHERE id = ?").run(
      snapshot.insertedHistoryId
    );
    db.prepare(
      "UPDATE tracked_assets SET current_value = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(
      snapshot.previousCurrentValue,
      snapshot.previousUpdatedAt,
      snapshot.assetId,
      DEFAULT_USER_ID
    );
  })();

  revalidatePath("/insights");
  revalidatePath(`/assets/${snapshot.assetId}`);
}

// ---------------------------------------------------------------------------
// Update metadata (name / type / notes / sort_order) with snapshot
// ---------------------------------------------------------------------------

export async function updateTrackedAssetMetaWithSnapshot(
  assetId: string,
  updates: {
    name?: string;
    asset_type?: TrackedAssetType;
    notes?: string | null;
    sort_order?: number;
  }
): Promise<TrackedAssetMetaSnapshot> {
  if (!assetId) {
    throw new Error("Invalid input: assetId is required");
  }

  const db = getDb();
  const existing = db
    .prepare(
      "SELECT name, asset_type, notes, sort_order, updated_at FROM tracked_assets WHERE id = ? AND user_id = ?"
    )
    .get(assetId, DEFAULT_USER_ID) as
    | {
        name: string;
        asset_type: TrackedAssetType;
        notes: string | null;
        sort_order: number;
        updated_at: string;
      }
    | undefined;
  if (!existing) {
    throw new Error(`Tracked asset ${assetId} not found`);
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (trimmed) {
      sets.push("name = ?");
      params.push(trimmed);
    }
  }
  if (updates.asset_type !== undefined) {
    if (!VALID_ASSET_TYPES.has(updates.asset_type)) {
      throw new Error("Invalid input: asset_type is not recognized");
    }
    sets.push("asset_type = ?");
    params.push(updates.asset_type);
  }
  if (updates.notes !== undefined) {
    sets.push("notes = ?");
    params.push(updates.notes);
  }
  if (updates.sort_order !== undefined) {
    assertFiniteNumber(updates.sort_order, "sort_order");
    sets.push("sort_order = ?");
    params.push(updates.sort_order);
  }

  const snapshot: TrackedAssetMetaSnapshot = {
    assetId,
    previousName: existing.name,
    previousAssetType: existing.asset_type,
    previousNotes: existing.notes,
    previousSortOrder: Number(existing.sort_order),
    previousUpdatedAt: existing.updated_at,
  };

  if (sets.length > 0) {
    sets.push("updated_at = ?");
    params.push(now());
    db.prepare(
      `UPDATE tracked_assets SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
    ).run(...params, assetId, DEFAULT_USER_ID);
  }

  revalidatePath("/insights");
  revalidatePath(`/assets/${assetId}`);
  return snapshot;
}

export async function restoreTrackedAssetMetaSnapshot(
  snapshot: TrackedAssetMetaSnapshot
): Promise<void> {
  const db = getDb();
  db.prepare(
    `UPDATE tracked_assets
       SET name = ?, asset_type = ?, notes = ?, sort_order = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
  ).run(
    snapshot.previousName,
    snapshot.previousAssetType,
    snapshot.previousNotes,
    snapshot.previousSortOrder,
    snapshot.previousUpdatedAt,
    snapshot.assetId,
    DEFAULT_USER_ID
  );

  revalidatePath("/insights");
  revalidatePath(`/assets/${snapshot.assetId}`);
}

// ---------------------------------------------------------------------------
// Archive (with snapshot)
// ---------------------------------------------------------------------------

export async function archiveTrackedAssetWithSnapshot(
  assetId: string
): Promise<TrackedAssetArchiveSnapshot> {
  if (!assetId) {
    throw new Error("Invalid input: assetId is required");
  }
  const db = getDb();
  const existing = db
    .prepare(
      "SELECT archived, updated_at FROM tracked_assets WHERE id = ? AND user_id = ?"
    )
    .get(assetId, DEFAULT_USER_ID) as
    | { archived: number; updated_at: string }
    | undefined;
  if (!existing) {
    throw new Error(`Tracked asset ${assetId} not found`);
  }

  const snapshot: TrackedAssetArchiveSnapshot = {
    assetId,
    previouslyArchived: existing.archived === 1,
    previousUpdatedAt: existing.updated_at,
  };

  db.prepare(
    "UPDATE tracked_assets SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(now(), assetId, DEFAULT_USER_ID);

  revalidatePath("/insights");
  revalidatePath(`/assets/${assetId}`);
  return snapshot;
}

export async function restoreTrackedAssetArchiveSnapshot(
  snapshot: TrackedAssetArchiveSnapshot
): Promise<void> {
  const db = getDb();
  db.prepare(
    "UPDATE tracked_assets SET archived = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(
    snapshot.previouslyArchived ? 1 : 0,
    snapshot.previousUpdatedAt,
    snapshot.assetId,
    DEFAULT_USER_ID
  );

  revalidatePath("/insights");
  revalidatePath(`/assets/${snapshot.assetId}`);
}

// ---------------------------------------------------------------------------
// Delete (with snapshot — full asset + all history)
// ---------------------------------------------------------------------------

export async function deleteTrackedAssetWithSnapshot(
  assetId: string
): Promise<TrackedAssetDeleteSnapshot | null> {
  if (!assetId) return null;
  const db = getDb();
  let snapshot: TrackedAssetDeleteSnapshot | null = null;

  db.transaction(() => {
    const assetRow = db
      .prepare("SELECT * FROM tracked_assets WHERE id = ? AND user_id = ?")
      .get(assetId, DEFAULT_USER_ID) as Record<string, unknown> | undefined;
    if (!assetRow) return;

    const historyRows = db
      .prepare(
        `SELECT * FROM tracked_asset_history
         WHERE asset_id = ?
         ORDER BY recorded_at ASC, created_at ASC`
      )
      .all(assetId) as Record<string, unknown>[];

    snapshot = {
      asset: mapRow<TrackedAsset>(assetRow),
      history: mapRows<TrackedAssetHistory>(historyRows),
    };

    // History rows cascade via FK ON DELETE CASCADE, but the snapshot keeps a
    // copy so restore can re-insert them.
    db.prepare("DELETE FROM tracked_assets WHERE id = ? AND user_id = ?").run(
      assetId,
      DEFAULT_USER_ID
    );
  })();

  revalidatePath("/insights");
  revalidatePath(`/assets/${assetId}`);
  return snapshot;
}

export async function restoreTrackedAssetSnapshot(
  snapshot: TrackedAssetDeleteSnapshot
): Promise<void> {
  const db = getDb();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO tracked_assets
         (id, user_id, name, asset_type, current_value, notes, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      snapshot.asset.id,
      snapshot.asset.user_id,
      snapshot.asset.name,
      snapshot.asset.asset_type,
      snapshot.asset.current_value,
      snapshot.asset.notes,
      snapshot.asset.sort_order,
      snapshot.asset.archived ? 1 : 0,
      snapshot.asset.created_at,
      snapshot.asset.updated_at
    );

    const stmt = db.prepare(
      `INSERT INTO tracked_asset_history
         (id, asset_id, value, recorded_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const h of snapshot.history) {
      stmt.run(h.id, h.asset_id, h.value, h.recorded_at, h.note, h.created_at);
    }
  })();

  revalidatePath("/insights");
  revalidatePath(`/assets/${snapshot.asset.id}`);
}
