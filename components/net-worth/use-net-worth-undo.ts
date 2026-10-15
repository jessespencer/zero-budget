"use client";

import { useCallback } from "react";
import { useUndoRedo, type MutationEntry, type MutationId } from "@/lib/use-undo-redo";
import {
  updateTrackedAssetValueWithSnapshot,
  restoreTrackedAssetValueSnapshot,
  updateTrackedAssetMetaWithSnapshot,
  restoreTrackedAssetMetaSnapshot,
  archiveTrackedAssetWithSnapshot,
  restoreTrackedAssetArchiveSnapshot,
  deleteTrackedAssetWithSnapshot,
  restoreTrackedAssetSnapshot,
  type TrackedAssetValueSnapshot,
  type TrackedAssetMetaSnapshot,
  type TrackedAssetArchiveSnapshot,
  type TrackedAssetDeleteSnapshot,
  type TrackedAssetValueUpdateInput,
} from "@/app/(app)/assets/actions";
import {
  updateTrackedAssetHistoryRowWithSnapshot,
  restoreTrackedAssetHistoryRowSnapshot,
  deleteTrackedAssetHistoryRowWithSnapshot,
  restoreTrackedAssetHistoryRowDeleteSnapshot,
  type HistoryRowUpdateSnapshot,
  type HistoryRowDeleteSnapshot,
} from "@/app/(app)/assets/[id]/actions";
import type { TrackedAssetType } from "@/lib/types";

type HistoryRowUpdateInput = {
  value?: number;
  recorded_at?: string;
  note?: string | null;
};

type MetaUpdate = {
  name?: string;
  asset_type?: TrackedAssetType;
  notes?: string | null;
  sort_order?: number;
};

/**
 * Net-worth undo hook. Wraps `useUndoRedo` and exposes typed helpers that
 * pair every `*WithSnapshot` server mutator with its `restore*` counterpart.
 *
 * Each helper returns a Promise that resolves AFTER the mutator runs and the
 * MutationEntry has been pushed onto the undo stack. The `forward` function
 * on each entry re-applies the mutation and captures a fresh snapshot —
 * required for re-do to work after an undo (HIGH fix H5 referenced in the
 * plan: Wave 4 wires history-row entries through these helpers).
 */
export function useNetWorthUndo() {
  const undo = useUndoRedo();
  const { push } = undo;

  const pushValueUpdate = useCallback(
    async (
      assetId: string,
      input: TrackedAssetValueUpdateInput
    ): Promise<MutationId> => {
      let snapshot: TrackedAssetValueSnapshot =
        await updateTrackedAssetValueWithSnapshot(assetId, input);
      const entry: MutationEntry = {
        label: "Update value",
        forward: async () => {
          snapshot = await updateTrackedAssetValueWithSnapshot(assetId, input);
        },
        backward: async () => {
          await restoreTrackedAssetValueSnapshot(snapshot);
        },
      };
      return push(entry);
    },
    [push]
  );

  const pushMetaUpdate = useCallback(
    async (assetId: string, updates: MetaUpdate): Promise<MutationId> => {
      let snapshot: TrackedAssetMetaSnapshot =
        await updateTrackedAssetMetaWithSnapshot(assetId, updates);
      const entry: MutationEntry = {
        label: "Update name",
        forward: async () => {
          snapshot = await updateTrackedAssetMetaWithSnapshot(assetId, updates);
        },
        backward: async () => {
          await restoreTrackedAssetMetaSnapshot(snapshot);
        },
      };
      return push(entry);
    },
    [push]
  );

  const pushArchive = useCallback(
    async (assetId: string): Promise<MutationId> => {
      let snapshot: TrackedAssetArchiveSnapshot =
        await archiveTrackedAssetWithSnapshot(assetId);
      const entry: MutationEntry = {
        label: "Archive",
        forward: async () => {
          snapshot = await archiveTrackedAssetWithSnapshot(assetId);
        },
        backward: async () => {
          await restoreTrackedAssetArchiveSnapshot(snapshot);
        },
      };
      return push(entry);
    },
    [push]
  );

  // Returns null when the asset was already gone (the action returns no
  // snapshot), which the caller reads as "nothing to offer an Undo for" —
  // same contract as pushHistoryRowDelete below.
  const pushDelete = useCallback(
    async (assetId: string): Promise<MutationId | null> => {
      const initial = await deleteTrackedAssetWithSnapshot(assetId);
      if (!initial) return null;
      let snapshot: TrackedAssetDeleteSnapshot = initial;
      const entry: MutationEntry = {
        label: "Delete asset",
        forward: async () => {
          const s = await deleteTrackedAssetWithSnapshot(snapshot.asset.id);
          if (s) snapshot = s;
        },
        backward: async () => {
          await restoreTrackedAssetSnapshot(snapshot);
        },
      };
      return push(entry);
    },
    [push]
  );

  // ── HIGH fix H5: history-row mutations (per-asset detail page) ──
  //
  // pushHistoryRowUpdate runs updateTrackedAssetHistoryRowWithSnapshot and
  // pushes a MutationEntry whose backward re-applies the prior value/recorded_at
  // /note (and re-syncs the asset's cached current_value). forward re-runs the
  // update and re-captures the snapshot — same pattern as pushValueUpdate so
  // redo after intervening mutations replays correctly.
  const pushHistoryRowUpdate = useCallback(
    async (
      rowId: string,
      updates: HistoryRowUpdateInput
    ): Promise<MutationId> => {
      let snapshot: HistoryRowUpdateSnapshot =
        await updateTrackedAssetHistoryRowWithSnapshot(rowId, updates);
      const entry: MutationEntry = {
        label: "Update history",
        forward: async () => {
          snapshot = await updateTrackedAssetHistoryRowWithSnapshot(
            rowId,
            updates
          );
        },
        backward: async () => {
          await restoreTrackedAssetHistoryRowSnapshot(snapshot);
        },
      };
      return push(entry);
    },
    [push]
  );

  // pushHistoryRowDelete runs deleteTrackedAssetHistoryRowWithSnapshot and
  // pairs forward (re-delete + re-capture) with backward (re-insert the row
  // and restore the asset's cached current_value).
  const pushHistoryRowDelete = useCallback(
    async (rowId: string): Promise<MutationId | null> => {
      const initial = await deleteTrackedAssetHistoryRowWithSnapshot(rowId);
      if (!initial) return null;
      let snapshot: HistoryRowDeleteSnapshot = initial;
      const entry: MutationEntry = {
        label: "Delete history",
        forward: async () => {
          const s = await deleteTrackedAssetHistoryRowWithSnapshot(
            snapshot.row.id
          );
          if (s) snapshot = s;
        },
        backward: async () => {
          await restoreTrackedAssetHistoryRowDeleteSnapshot(snapshot);
        },
      };
      return push(entry);
    },
    [push]
  );

  return {
    ...undo,
    pushValueUpdate,
    pushMetaUpdate,
    pushArchive,
    pushDelete,
    pushHistoryRowUpdate,
    pushHistoryRowDelete,
  };
}
