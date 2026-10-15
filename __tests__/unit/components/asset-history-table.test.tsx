import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { __resetUndoRedo } from "@/lib/use-undo-redo";
import { AssetHistoryTable } from "@/components/net-worth/asset-history-table";
import type { TrackedAssetHistory } from "@/lib/types";

// Call-site tier: does the row menu call the right action and acknowledge the
// result — a toast on success, an error toast on failure, an Undo bound to the
// entry it raised. Whether the DB ends up right is tracked-asset-actions.test.ts.
//
// The history-row helpers live in the [id] route, but useNetWorthUndo also
// imports the whole assets/actions module, so both "use server" modules have to
// be mocked or jsdom tries to execute server code.
vi.mock("@/app/(app)/assets/[id]/actions", () => ({
  updateTrackedAssetHistoryRowWithSnapshot: vi.fn(),
  restoreTrackedAssetHistoryRowSnapshot: vi.fn(() => Promise.resolve()),
  deleteTrackedAssetHistoryRowWithSnapshot: vi.fn(),
  restoreTrackedAssetHistoryRowDeleteSnapshot: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/app/(app)/assets/actions", () => ({
  updateTrackedAssetValueWithSnapshot: vi.fn(),
  restoreTrackedAssetValueSnapshot: vi.fn(() => Promise.resolve()),
  updateTrackedAssetMetaWithSnapshot: vi.fn(),
  restoreTrackedAssetMetaSnapshot: vi.fn(() => Promise.resolve()),
  archiveTrackedAssetWithSnapshot: vi.fn(),
  restoreTrackedAssetArchiveSnapshot: vi.fn(() => Promise.resolve()),
  deleteTrackedAssetWithSnapshot: vi.fn(),
  restoreTrackedAssetSnapshot: vi.fn(() => Promise.resolve()),
}));

import {
  updateTrackedAssetHistoryRowWithSnapshot,
  restoreTrackedAssetHistoryRowSnapshot,
  deleteTrackedAssetHistoryRowWithSnapshot,
  restoreTrackedAssetHistoryRowDeleteSnapshot,
  type HistoryRowUpdateSnapshot,
  type HistoryRowDeleteSnapshot,
} from "@/app/(app)/assets/[id]/actions";

const ROWS: TrackedAssetHistory[] = [
  {
    id: "h-old",
    asset_id: "asset-1",
    value: 1000,
    recorded_at: "2026-06-01",
    note: null,
    created_at: "2026-06-01T00:00:00Z",
  },
  {
    id: "h-new",
    asset_id: "asset-1",
    value: 1200,
    recorded_at: "2026-07-01",
    note: null,
    created_at: "2026-07-01T00:00:00Z",
  },
];

// h-new is the newest row (top of the DESC display order), so it's the one the
// menu below acts on.
const UPDATE_SNAPSHOT: HistoryRowUpdateSnapshot = {
  rowId: "h-new",
  assetId: "asset-1",
  previousValue: 1200,
  previousRecordedAt: "2026-07-01",
  previousNote: null,
  previousAssetCurrentValue: 1200,
  previousAssetUpdatedAt: "2026-07-01T00:00:00Z",
};

const DELETE_SNAPSHOT: HistoryRowDeleteSnapshot = {
  row: ROWS[1],
  previousAssetCurrentValue: 1200,
  previousAssetUpdatedAt: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  __resetUndoRedo();
  vi.mocked(updateTrackedAssetHistoryRowWithSnapshot)
    .mockReset()
    .mockResolvedValue(UPDATE_SNAPSHOT);
  vi.mocked(restoreTrackedAssetHistoryRowSnapshot)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(deleteTrackedAssetHistoryRowWithSnapshot)
    .mockReset()
    .mockResolvedValue(DELETE_SNAPSHOT);
  vi.mocked(restoreTrackedAssetHistoryRowDeleteSnapshot)
    .mockReset()
    .mockResolvedValue(undefined);
});

async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  // Newest row first in the DESC display order.
  await user.click(
    screen.getByRole("button", { name: /actions for entry on 2026-07-01/i })
  );
}

describe("AssetHistoryTable — delete a history row", () => {
  async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
    await openRowMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await user.click(await screen.findByRole("button", { name: /delete entry/i }));
  }

  it("toasts an undoable confirmation on success", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetHistoryTable rows={ROWS} />);
    await confirmDelete(user);

    expect(deleteTrackedAssetHistoryRowWithSnapshot).toHaveBeenCalledWith("h-new");
    expect(await screen.findByText(/history entry deleted/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /undo/i })
    ).toBeInTheDocument();
  });

  it("routes the toast's Undo through the delete-restore action, not a bare pop", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetHistoryTable rows={ROWS} />);
    await confirmDelete(user);

    await user.click(await screen.findByRole("button", { name: /undo/i }));
    expect(restoreTrackedAssetHistoryRowDeleteSnapshot).toHaveBeenCalledWith(
      DELETE_SNAPSHOT
    );
  });

  it("surfaces an error toast and swallows the rejection when the delete throws", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteTrackedAssetHistoryRowWithSnapshot).mockRejectedValue(
      new Error("db is gone")
    );
    const onUnhandled = vi.fn();
    window.addEventListener("unhandledrejection", onUnhandled);

    renderWithProviders(<AssetHistoryTable rows={ROWS} />);
    await confirmDelete(user);

    expect(
      await screen.findByText(/couldn't delete the history entry/i)
    ).toBeInTheDocument();
    // No success toast leaked through.
    expect(screen.queryByText(/history entry deleted/i)).not.toBeInTheDocument();
    expect(onUnhandled).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", onUnhandled);
  });
});

describe("AssetHistoryTable — edit a history row", () => {
  async function editValueTo(
    user: ReturnType<typeof userEvent.setup>,
    next: string
  ) {
    await openRowMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: /edit/i }));
    const input = await screen.findByLabelText(/value/i);
    await user.clear(input);
    await user.type(input, next);
    await user.click(screen.getByRole("button", { name: /^save$/i }));
  }

  it("toasts an undoable confirmation, since the header number moves off-screen", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetHistoryTable rows={ROWS} />);
    await editValueTo(user, "1500");

    expect(updateTrackedAssetHistoryRowWithSnapshot).toHaveBeenCalledWith("h-new", {
      value: 1500,
      recorded_at: "2026-07-01",
      note: null,
    });
    expect(await screen.findByText(/history entry updated/i)).toBeInTheDocument();
  });

  it("routes the toast's Undo through the update-restore action", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetHistoryTable rows={ROWS} />);
    await editValueTo(user, "1500");

    await user.click(await screen.findByRole("button", { name: /undo/i }));
    expect(restoreTrackedAssetHistoryRowSnapshot).toHaveBeenCalledWith(
      UPDATE_SNAPSHOT
    );
  });

  it("keeps the dialog open with an error and no toast when the update throws", async () => {
    const user = userEvent.setup();
    vi.mocked(updateTrackedAssetHistoryRowWithSnapshot).mockRejectedValue(
      new Error("db is gone")
    );

    renderWithProviders(<AssetHistoryTable rows={ROWS} />);
    await editValueTo(user, "1500");

    expect(await screen.findByText(/db is gone/i)).toBeInTheDocument();
    // Dialog still open: its Save button is still in the DOM.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(screen.queryByText(/history entry updated/i)).not.toBeInTheDocument();
  });
});
