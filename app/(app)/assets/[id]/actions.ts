"use server";

import { revalidatePath } from "next/cache";
import { getDb, DEFAULT_USER_ID } from "@/lib/db";
import { mapRow, mapRows, now, roundCents } from "@/lib/db-utils";
import type {
  TrackedAsset,
  TrackedAssetHistory,
} from "@/lib/types";
import {
  stepInterpolateForAsset,
  type NetWorthPoint,
} from "@/lib/net-worth-series";
import { getTrackedAssetWithHistory } from "@/app/(app)/assets/actions";

// ---------------------------------------------------------------------------
// Per-route loaders
//
// These wrap the canonical helpers in app/(app)/assets/actions.ts so the page
// imports stay co-located with the route. Same module boundary as the
// account-detail page's actions.ts.
// ---------------------------------------------------------------------------

export async function getAssetDetail(
  id: string
): Promise<{ asset: TrackedAsset | null; history: TrackedAssetHistory[] }> {
  return getTrackedAssetWithHistory(id);
}

/**
 * Per-asset step-interpolated time series. Reuses
 * `stepInterpolateForAsset` from lib/net-worth-series.ts so the per-asset
 * chart and the insights chart agree at every date (HIGH fix H2).
 *
 * Range handling:
 *   - `range.from` predates the first history row → prepend a synthetic
 *     `{ from, 0 }` point so the leading segment is flat at zero.
 *   - A history row exists with `recorded_at <= from` → prepend
 *     `{ from, <carried-over value> }` so the leading segment reflects the
 *     prior value rather than starting mid-range with no data.
 *   - Trailing point is always emitted at `to ?? today` using the asset's
 *     `current_value` so the chart ends at today's number.
 */
export async function getAssetSeries(
  id: string,
  range?: { from?: string; to?: string }
): Promise<NetWorthPoint[]> {
  const db = getDb();

  const assetRow = db
    .prepare(
      "SELECT current_value FROM tracked_assets WHERE id = ? AND user_id = ?"
    )
    .get(id, DEFAULT_USER_ID) as { current_value: number } | undefined;
  if (!assetRow) return [];

  const historyRows = db
    .prepare(
      "SELECT * FROM tracked_asset_history WHERE asset_id = ? ORDER BY recorded_at ASC, created_at ASC"
    )
    .all(id) as Record<string, unknown>[];
  const history = mapRows<TrackedAssetHistory>(historyRows);

  return stepInterpolateForAsset(history, Number(assetRow.current_value), range);
}

// ---------------------------------------------------------------------------
// History-row snapshot types
//
// Both `*WithSnapshot` mutators capture every byte needed to reverse the edit:
// the row's prior value/recorded_at/note, the parent asset's prior current_value
// (which can change when an edit/delete affects the most-recent row), and the
// parent's previous updated_at so the restore path puts the cache back exactly
// where it was.
// ---------------------------------------------------------------------------

export type HistoryRowUpdateSnapshot = {
  rowId: string;
  assetId: string;
  previousValue: number;
  previousRecordedAt: string;
  previousNote: string | null;
  previousAssetCurrentValue: number;
  previousAssetUpdatedAt: string;
};

export type HistoryRowDeleteSnapshot = {
  row: TrackedAssetHistory;
  previousAssetCurrentValue: number;
  previousAssetUpdatedAt: string;
};

// ---------------------------------------------------------------------------
// Update a single history row
// ---------------------------------------------------------------------------

export async function updateTrackedAssetHistoryRowWithSnapshot(
  rowId: string,
  updates: { value?: number; recorded_at?: string; note?: string | null }
): Promise<HistoryRowUpdateSnapshot> {
  if (!rowId) {
    throw new Error("Invalid input: rowId is required");
  }
  if (
    updates.value !== undefined &&
    (typeof updates.value !== "number" || !Number.isFinite(updates.value))
  ) {
    throw new Error("Invalid input: value must be a finite number");
  }

  const db = getDb();
  let snapshot: HistoryRowUpdateSnapshot | null = null;

  db.transaction(() => {
    const row = db
      .prepare(
        "SELECT id, asset_id, value, recorded_at, note FROM tracked_asset_history WHERE id = ?"
      )
      .get(rowId) as
      | {
          id: string;
          asset_id: string;
          value: number;
          recorded_at: string;
          note: string | null;
        }
      | undefined;
    if (!row) {
      throw new Error(`History row ${rowId} not found`);
    }

    const asset = db
      .prepare(
        "SELECT current_value, updated_at FROM tracked_assets WHERE id = ? AND user_id = ?"
      )
      .get(row.asset_id, DEFAULT_USER_ID) as
      | { current_value: number; updated_at: string }
      | undefined;
    if (!asset) {
      throw new Error(`Tracked asset ${row.asset_id} not found`);
    }

    snapshot = {
      rowId: row.id,
      assetId: row.asset_id,
      previousValue: Number(row.value),
      previousRecordedAt: row.recorded_at,
      previousNote: row.note,
      previousAssetCurrentValue: Number(asset.current_value),
      previousAssetUpdatedAt: asset.updated_at,
    };

    // Build the UPDATE dynamically; only patch fields the caller provided.
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (updates.value !== undefined) {
      sets.push("value = ?");
      params.push(roundCents(updates.value));
    }
    if (updates.recorded_at !== undefined) {
      sets.push("recorded_at = ?");
      params.push(updates.recorded_at);
    }
    if (updates.note !== undefined) {
      sets.push("note = ?");
      params.push(updates.note);
    }

    if (sets.length > 0) {
      db.prepare(
        `UPDATE tracked_asset_history SET ${sets.join(", ")} WHERE id = ?`
      ).run(...params, rowId);
    }

    // Recompute tracked_assets.current_value = the value of the most-recent
    // history row by recorded_at (tiebreak: created_at). The edited row may
    // now be the most recent (or no longer be) — we always sync.
    const latest = db
      .prepare(
        `SELECT value FROM tracked_asset_history
           WHERE asset_id = ?
           ORDER BY recorded_at DESC, created_at DESC
           LIMIT 1`
      )
      .get(row.asset_id) as { value: number } | undefined;

    const nextCurrent = latest ? roundCents(Number(latest.value)) : 0;
    const timestamp = now();
    db.prepare(
      "UPDATE tracked_assets SET current_value = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(nextCurrent, timestamp, row.asset_id, DEFAULT_USER_ID);
  })();

  if (!snapshot) {
    throw new Error(`History row ${rowId} not found`);
  }

  // Re-resolve assetId at the type level via the captured snapshot.
  const captured: HistoryRowUpdateSnapshot = snapshot;

  revalidatePath("/insights");
  revalidatePath(`/assets/${captured.assetId}`);
  return captured;
}

export async function restoreTrackedAssetHistoryRowSnapshot(
  snapshot: HistoryRowUpdateSnapshot
): Promise<void> {
  const db = getDb();

  db.transaction(() => {
    db.prepare(
      `UPDATE tracked_asset_history
         SET value = ?, recorded_at = ?, note = ?
         WHERE id = ?`
    ).run(
      snapshot.previousValue,
      snapshot.previousRecordedAt,
      snapshot.previousNote,
      snapshot.rowId
    );

    db.prepare(
      "UPDATE tracked_assets SET current_value = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(
      snapshot.previousAssetCurrentValue,
      snapshot.previousAssetUpdatedAt,
      snapshot.assetId,
      DEFAULT_USER_ID
    );
  })();

  revalidatePath("/insights");
  revalidatePath(`/assets/${snapshot.assetId}`);
}

// ---------------------------------------------------------------------------
// Delete a single history row
// ---------------------------------------------------------------------------

export async function deleteTrackedAssetHistoryRowWithSnapshot(
  rowId: string
): Promise<HistoryRowDeleteSnapshot | null> {
  if (!rowId) return null;

  const db = getDb();
  let snapshot: HistoryRowDeleteSnapshot | null = null;

  db.transaction(() => {
    const rowRecord = db
      .prepare("SELECT * FROM tracked_asset_history WHERE id = ?")
      .get(rowId) as Record<string, unknown> | undefined;
    if (!rowRecord) return;

    const row = mapRow<TrackedAssetHistory>(rowRecord);

    const asset = db
      .prepare(
        "SELECT current_value, updated_at FROM tracked_assets WHERE id = ? AND user_id = ?"
      )
      .get(row.asset_id, DEFAULT_USER_ID) as
      | { current_value: number; updated_at: string }
      | undefined;
    if (!asset) return;

    snapshot = {
      row,
      previousAssetCurrentValue: Number(asset.current_value),
      previousAssetUpdatedAt: asset.updated_at,
    };

    db.prepare("DELETE FROM tracked_asset_history WHERE id = ?").run(rowId);

    // Recompute current_value from the now-most-recent row (or 0 if none
    // remain).
    const latest = db
      .prepare(
        `SELECT value FROM tracked_asset_history
           WHERE asset_id = ?
           ORDER BY recorded_at DESC, created_at DESC
           LIMIT 1`
      )
      .get(row.asset_id) as { value: number } | undefined;
    const nextCurrent = latest ? roundCents(Number(latest.value)) : 0;
    const timestamp = now();
    db.prepare(
      "UPDATE tracked_assets SET current_value = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(nextCurrent, timestamp, row.asset_id, DEFAULT_USER_ID);
  })();

  if (!snapshot) return null;
  const captured: HistoryRowDeleteSnapshot = snapshot;

  revalidatePath("/insights");
  revalidatePath(`/assets/${captured.row.asset_id}`);
  return captured;
}

export async function restoreTrackedAssetHistoryRowDeleteSnapshot(
  snapshot: HistoryRowDeleteSnapshot
): Promise<void> {
  const db = getDb();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO tracked_asset_history (id, asset_id, value, recorded_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      snapshot.row.id,
      snapshot.row.asset_id,
      snapshot.row.value,
      snapshot.row.recorded_at,
      snapshot.row.note,
      snapshot.row.created_at
    );

    db.prepare(
      "UPDATE tracked_assets SET current_value = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(
      snapshot.previousAssetCurrentValue,
      snapshot.previousAssetUpdatedAt,
      snapshot.row.asset_id,
      DEFAULT_USER_ID
    );
  })();

  revalidatePath("/insights");
  revalidatePath(`/assets/${snapshot.row.asset_id}`);
}
