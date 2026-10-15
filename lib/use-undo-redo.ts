"use client";

import { useCallback, useRef, useSyncExternalStore, useTransition } from "react";

export type MutationEntry = {
  label: string;
  forward: () => Promise<void>;
  backward: () => Promise<void>;
};

// Raised when a `backward()`/`forward()` closure rejects during undo/redo.
// The entry has already been put back on the stack it came from by the time
// this fires, so `onError` is purely for user feedback (a toast), not recovery.
export type UndoRedoError = {
  action: "undo" | "redo";
  error: unknown;
  label: string;
};

// Identifies one pushed entry for as long as it lives on either stack, so a
// toast can undo the action it was raised for rather than whatever happens to
// be on top when the user clicks. Returned by `push`, consumed by `undoEntry`.
export type MutationId = string;

type StackEntry = MutationEntry & { id: MutationId };

// ---------------------------------------------------------------------------
// Module-level undo/redo store.
//
// Previously this hook held its state in a component-local useRef, which
// meant every consumer (TransactionsClient, BudgetTable, TransferPlanClient,
// AccountMenu, ...) had its own stack. Navigating between tabs unmounted the
// stack, so a delete on /accounts/[id] couldn't be undone after switching to
// /transactions (260518-fqy #3).
//
// Now the stack is a module singleton, subscribed to via useSyncExternalStore.
// All consumers within the (app) layout share one stack. Cmd+Z continues to
// work across route changes for as long as the consumer's MutationEntry
// closures stay self-contained — every existing call site already uses
// server-fetched snapshots (TransactionSnapshot[], TransferPairSnapshot,
// ReconcileSnapshot, etc.) rather than component-local state, so closures
// stay valid even after the originating component has unmounted.
//
// That same self-containment is what lets `undoEntry` reach past the top of the
// stack (see below): entries are keyed to server-fetched snapshots of specific
// rows, so undoing one out of order doesn't invalidate the ones under it.
// ---------------------------------------------------------------------------

let undoStack: StackEntry[] = [];
let redoStack: StackEntry[] = [];

let nextEntryId = 0;

function makeEntryId(): MutationId {
  nextEntryId += 1;
  return `mutation-${nextEntryId}`;
}

// Test-only: clear both stacks so a component test that pushes onto the module
// singleton starts from empty. Mirrors __resetCutoffCache in lib/balance.ts.
// Not used in app code.
export function __resetUndoRedo() {
  undoStack = [];
  redoStack = [];
  version += 1;
  emit();
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

// useSyncExternalStore demands a stable snapshot identity when nothing has
// changed; bump a version counter on every mutation and key the snapshot off
// that. A primitive snapshot dodges the "getSnapshot should be cached"
// warning that comes from returning fresh objects on every read.
let version = 0;

function getSnapshot() {
  return version;
}

function getServerSnapshot() {
  return 0;
}

function pushEntry(entry: MutationEntry): MutationId {
  const id = makeEntryId();
  undoStack = [...undoStack, { ...entry, id }];
  redoStack = [];
  version += 1;
  emit();
  return id;
}

// Pull a specific entry off the undo stack wherever it sits, not just the top.
// Returns null when it isn't there — already undone, or cleared by a later
// push — which is the signal for a stale toast to do nothing rather than
// silently undo somebody else's action.
function takeUndo(id: MutationId): StackEntry | null {
  const entry = undoStack.find((e) => e.id === id);
  if (!entry) return null;
  undoStack = undoStack.filter((e) => e.id !== id);
  version += 1;
  emit();
  return entry;
}

function popUndo(): StackEntry | null {
  if (undoStack.length === 0) return null;
  const entry = undoStack[undoStack.length - 1];
  undoStack = undoStack.slice(0, -1);
  version += 1;
  emit();
  return entry;
}

function popRedo(): StackEntry | null {
  if (redoStack.length === 0) return null;
  const entry = redoStack[redoStack.length - 1];
  redoStack = redoStack.slice(0, -1);
  version += 1;
  emit();
  return entry;
}

function pushRedo(entry: StackEntry) {
  redoStack = [...redoStack, entry];
  version += 1;
  emit();
}

function pushUndoSilent(entry: StackEntry) {
  // Re-push to undo without clearing redo — used after a redo to put the
  // entry back on the undo side, mirroring the original pre-singleton
  // behavior inside the redo() transition.
  undoStack = [...undoStack, entry];
  version += 1;
  emit();
}

export function useUndoRedo(options?: {
  // Called when a `backward()`/`forward()` closure rejects. Optional so the
  // ~dozen existing call sites need no change; a page that wants a "Couldn't
  // undo — try again" toast passes one. Without it, a rejected closure is
  // still caught (no unhandled rejection) and the entry is put back on its
  // stack (see below) — it's just silent.
  onError?: (info: UndoRedoError) => void;
}) {
  // Subscribe to the singleton so the consuming component re-renders when
  // the stacks mutate. Snapshot is a primitive version counter.
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [isPending, startTransition] = useTransition();

  // Read the latest onError through a ref so the callbacks below stay stable
  // even when a consumer passes an inline function.
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  const push = useCallback((entry: MutationEntry) => pushEntry(entry), []);

  // If `backward()` throws, the undo did not happen: put the entry back on the
  // undo stack (so a retry — or the toast's Undo — can try again) rather than
  // dropping it from both stacks, and report it. Before this catch, a rejected
  // closure was an unhandled rejection AND lost the entry from both stacks.
  const runUndo = useCallback(
    (entry: StackEntry) => {
      startTransition(async () => {
        try {
          await entry.backward();
          pushRedo(entry);
        } catch (error) {
          pushUndoSilent(entry);
          onErrorRef.current?.({ action: "undo", error, label: entry.label });
        }
      });
    },
    [startTransition]
  );

  const undo = useCallback(() => {
    const entry = popUndo();
    if (!entry) return;
    runUndo(entry);
  }, [runUndo]);

  // Undo one specific entry — what a toast's Undo button wants. `undo()` pops
  // whatever is on top, which is the wrong action as soon as the user has done
  // anything else in the six seconds the toast is on screen. Going through the
  // stack (rather than calling `backward()` directly, as the toasts here used
  // to) is what moves the entry to the redo side, so Cmd+Shift+Z afterwards
  // still works and a following Cmd+Z can't re-run the same undo.
  const undoEntry = useCallback(
    (id: MutationId) => {
      const entry = takeUndo(id);
      if (!entry) return;
      runUndo(entry);
    },
    [runUndo]
  );

  const redo = useCallback(() => {
    const entry = popRedo();
    if (!entry) return;
    startTransition(async () => {
      try {
        await entry.forward();
        pushUndoSilent(entry);
      } catch (error) {
        // Symmetric to runUndo: the redo didn't happen, so keep it redoable.
        pushRedo(entry);
        onErrorRef.current?.({ action: "redo", error, label: entry.label });
      }
    });
  }, [startTransition]);

  return {
    push,
    undo,
    undoEntry,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabel:
      undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null,
    redoLabel:
      redoStack.length > 0 ? redoStack[redoStack.length - 1].label : null,
    isPending,
  };
}
