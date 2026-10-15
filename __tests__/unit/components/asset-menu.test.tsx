import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { __resetUndoRedo } from "@/lib/use-undo-redo";
import { AssetMenu } from "@/components/net-worth/asset-menu";
import type { TrackedAsset } from "@/lib/types";
import type {
  TrackedAssetArchiveSnapshot,
  TrackedAssetDeleteSnapshot,
} from "@/app/(app)/assets/actions";

// Call-site tier. Archive and Delete both redirect to /insights, and the claim
// this file exists to pin down is that the redirect does NOT cost the user
// their undo: the stack is a module singleton and the Toaster lives in the
// (app) shell, so the entry and its toast outlive this component. An earlier
// comment in asset-menu.tsx asserted the opposite and left both mutations
// silent.
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
vi.mock("@/app/(app)/assets/[id]/actions", () => ({
  updateTrackedAssetHistoryRowWithSnapshot: vi.fn(),
  restoreTrackedAssetHistoryRowSnapshot: vi.fn(() => Promise.resolve()),
  deleteTrackedAssetHistoryRowWithSnapshot: vi.fn(),
  restoreTrackedAssetHistoryRowDeleteSnapshot: vi.fn(() => Promise.resolve()),
}));

import {
  archiveTrackedAssetWithSnapshot,
  restoreTrackedAssetArchiveSnapshot,
  deleteTrackedAssetWithSnapshot,
  restoreTrackedAssetSnapshot,
} from "@/app/(app)/assets/actions";

const ASSET: TrackedAsset = {
  id: "asset-1",
  user_id: "u1",
  name: "Household items",
  asset_type: "other",
  current_value: 60000,
  notes: null,
  sort_order: 0,
  archived: false,
  created_at: "",
  updated_at: "",
};

const ARCHIVE_SNAPSHOT: TrackedAssetArchiveSnapshot = {
  assetId: "asset-1",
  previouslyArchived: false,
  previousUpdatedAt: "",
};

const DELETE_SNAPSHOT: TrackedAssetDeleteSnapshot = {
  asset: ASSET,
  history: [],
};

async function openMenuItem(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp
) {
  await user.click(
    screen.getByRole("button", { name: /options for household items/i })
  );
  await user.click(await screen.findByRole("menuitem", { name }));
  // Both items open a ConfirmDialog whose confirm button repeats the label.
  const dialog = await screen.findByRole("dialog");
  const confirm = await within(dialog).findByRole("button", { name });
  await user.click(confirm);
}

beforeEach(() => {
  __resetUndoRedo();
  vi.mocked(archiveTrackedAssetWithSnapshot)
    .mockReset()
    .mockResolvedValue(ARCHIVE_SNAPSHOT);
  vi.mocked(restoreTrackedAssetArchiveSnapshot)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(deleteTrackedAssetWithSnapshot)
    .mockReset()
    .mockResolvedValue(DELETE_SNAPSHOT);
  vi.mocked(restoreTrackedAssetSnapshot).mockReset().mockResolvedValue(undefined);
});

describe("AssetMenu", () => {
  it("toasts an undoable confirmation after archiving", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetMenu asset={ASSET} />);
    await openMenuItem(user, /^archive$/i);

    expect(archiveTrackedAssetWithSnapshot).toHaveBeenCalledWith("asset-1");
    expect(await screen.findByText(/household items" archived/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /undo/i })
    ).toBeInTheDocument();
  });

  it("routes the archive toast's Undo through the restore action", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetMenu asset={ASSET} />);
    await openMenuItem(user, /^archive$/i);

    await user.click(await screen.findByRole("button", { name: /undo/i }));
    expect(restoreTrackedAssetArchiveSnapshot).toHaveBeenCalledWith(
      ARCHIVE_SNAPSHOT
    );
  });

  it("routes the delete toast's Undo through the restore action", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetMenu asset={ASSET} />);
    await openMenuItem(user, /^delete$/i);

    expect(deleteTrackedAssetWithSnapshot).toHaveBeenCalledWith("asset-1");
    await user.click(await screen.findByRole("button", { name: /undo/i }));
    expect(restoreTrackedAssetSnapshot).toHaveBeenCalledWith(DELETE_SNAPSHOT);
  });

  it("reports a failed archive instead of failing silently", async () => {
    const user = userEvent.setup();
    vi.mocked(archiveTrackedAssetWithSnapshot).mockRejectedValue(
      new Error("db locked")
    );
    renderWithProviders(<AssetMenu asset={ASSET} />);
    await openMenuItem(user, /^archive$/i);

    expect(
      await screen.findByText(/couldn't archive "household items"/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
  });
});
