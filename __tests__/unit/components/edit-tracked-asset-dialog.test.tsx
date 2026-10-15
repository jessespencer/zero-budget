import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { __resetUndoRedo } from "@/lib/use-undo-redo";
import { EditTrackedAssetDialog } from "@/components/net-worth/edit-tracked-asset-dialog";
import type { TrackedAsset } from "@/lib/types";
import type { TrackedAssetMetaSnapshot } from "@/app/(app)/assets/actions";

// Call-site tier: renaming/retyping an asset must land on the undo stack and
// acknowledge itself. This edit routes through useNetWorthUndo.pushMetaUpdate,
// which imports the whole assets/actions module — mock it so jsdom doesn't run
// server code. The [id] module is pulled in transitively by the hook too.
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
  updateTrackedAssetMetaWithSnapshot,
  restoreTrackedAssetMetaSnapshot,
} from "@/app/(app)/assets/actions";

const ASSET: TrackedAsset = {
  id: "asset-1",
  user_id: "u1",
  name: "Brokerage",
  asset_type: "investment",
  current_value: 5000,
  notes: null,
  sort_order: 0,
  archived: false,
  created_at: "",
  updated_at: "",
};

const META_SNAPSHOT: TrackedAssetMetaSnapshot = {
  assetId: "asset-1",
  previousName: "Brokerage",
  previousAssetType: "investment",
  previousNotes: null,
  previousSortOrder: 0,
  previousUpdatedAt: "",
};

// A stateful wrapper so onOpenChange actually closes the dialog, the way the
// real caller (AssetMenu, via useState) does. It matters for more than realism:
// an *open* modal dialog marks the rest of the document — including the toast
// portal on document.body — aria-hidden, so a success toast is unreachable by
// role queries until the dialog closes. On success the dialog closes and the
// toast becomes visible; on failure it stays open with the error inside it.
function setup() {
  const onOpenChange = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <EditTrackedAssetDialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
          setOpen(o);
        }}
        asset={ASSET}
      />
    );
  }
  const result = renderWithProviders(<Harness />);
  return { onOpenChange, ...result };
}

async function renameTo(user: ReturnType<typeof userEvent.setup>, next: string) {
  const input = await screen.findByLabelText(/^name$/i);
  await user.clear(input);
  await user.type(input, next);
  await user.click(screen.getByRole("button", { name: /^save$/i }));
}

beforeEach(() => {
  __resetUndoRedo();
  vi.mocked(updateTrackedAssetMetaWithSnapshot)
    .mockReset()
    .mockResolvedValue(META_SNAPSHOT);
  vi.mocked(restoreTrackedAssetMetaSnapshot)
    .mockReset()
    .mockResolvedValue(undefined);
});

describe("EditTrackedAssetDialog", () => {
  it("saves the rename and toasts an undoable confirmation", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = setup();
    await renameTo(user, "IRA");

    expect(updateTrackedAssetMetaWithSnapshot).toHaveBeenCalledWith("asset-1", {
      name: "IRA",
    });
    expect(await screen.findByText(/ira updated/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /undo/i })
    ).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("routes the toast's Undo through the meta-restore action", async () => {
    const user = userEvent.setup();
    setup();
    await renameTo(user, "IRA");

    await user.click(await screen.findByRole("button", { name: /undo/i }));
    expect(restoreTrackedAssetMetaSnapshot).toHaveBeenCalledWith(META_SNAPSHOT);
  });

  it("does not register the undo entry until the write resolves", async () => {
    const user = userEvent.setup();
    const pending = deferred<TrackedAssetMetaSnapshot>();
    vi.mocked(updateTrackedAssetMetaWithSnapshot).mockReturnValue(pending.promise);

    setup();
    await renameTo(user, "IRA");

    // Still in flight: a toast (and its undo entry) here would let Cmd+Z
    // "restore" a name the write never persisted.
    expect(screen.queryByText(/ira updated/i)).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(META_SNAPSHOT);
      await pending.promise;
    });
    expect(await screen.findByText(/ira updated/i)).toBeInTheDocument();
  });

  it("keeps the dialog open with an error and no toast when the write rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(updateTrackedAssetMetaWithSnapshot).mockRejectedValue(
      new Error("asset_type rejected")
    );
    const { onOpenChange } = setup();
    await renameTo(user, "IRA");

    expect(await screen.findByText(/asset_type rejected/i)).toBeInTheDocument();
    expect(screen.queryByText(/ira updated/i)).not.toBeInTheDocument();
    // Dialog was never asked to close.
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
