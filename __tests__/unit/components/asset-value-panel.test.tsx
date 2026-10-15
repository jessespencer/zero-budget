import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { __resetUndoRedo } from "@/lib/use-undo-redo";
import { AssetValuePanel } from "@/components/net-worth/asset-value-panel";

// Call-site tier: does the value panel acknowledge a save — a success toast
// whose Undo routes through the restore action, an inline error on failure, no
// toast at all in privacy mode. Whether the DB ends up right is
// tracked-asset-actions.test.ts.
//
// A backfilled save (an older recorded_at) deliberately leaves the on-screen
// current value unchanged, and /assets/[id] mounts no Cmd+Z handler, so the
// toast is the *only* acknowledgement and the *only* reachable undo. That's the
// whole reason finding 4 mattered.
//
// useNetWorthUndo imports both "use server" modules, so both have to be mocked
// or jsdom tries to execute server code.
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
  updateTrackedAssetValueWithSnapshot,
  restoreTrackedAssetValueSnapshot,
  type TrackedAssetValueSnapshot,
} from "@/app/(app)/assets/actions";

const VALUE_SNAPSHOT: TrackedAssetValueSnapshot = {
  assetId: "asset-1",
  previousCurrentValue: 1000,
  insertedHistoryId: "h-inserted",
  previousUpdatedAt: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  __resetUndoRedo();
  vi.mocked(updateTrackedAssetValueWithSnapshot)
    .mockReset()
    .mockResolvedValue(VALUE_SNAPSHOT);
  vi.mocked(restoreTrackedAssetValueSnapshot).mockReset().mockResolvedValue(undefined);
});

async function saveValue(user: ReturnType<typeof userEvent.setup>, next: string) {
  const input = screen.getByLabelText(/new value/i);
  await user.clear(input);
  await user.type(input, next);
  await user.click(screen.getByRole("button", { name: /^save$/i }));
}

describe("AssetValuePanel — record a value", () => {
  it("saves through the snapshot action and toasts a confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetValuePanel assetId="asset-1" currentValue={1000} />);
    await saveValue(user, "1500");

    expect(updateTrackedAssetValueWithSnapshot).toHaveBeenCalledWith(
      "asset-1",
      expect.objectContaining({ value: 1500 })
    );
    expect(await screen.findByText(/value recorded/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /undo/i })
    ).toBeInTheDocument();
  });

  // The regression pin for the use-net-worth-undo.ts change: pushValueUpdate has
  // to *return* its MutationId, else undoEntry(undefined) is a no-op and this
  // restore never fires. A bare undo() would also pass a lax version of this
  // test, which is why we assert the restore action ran, not just that something
  // happened.
  it("routes the toast's Undo through the value-restore action, not a bare pop", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetValuePanel assetId="asset-1" currentValue={1000} />);
    await saveValue(user, "1500");

    await user.click(await screen.findByRole("button", { name: /undo/i }));
    expect(restoreTrackedAssetValueSnapshot).toHaveBeenCalledWith(VALUE_SNAPSHOT);
  });

  it("fires no toast until the server confirms", async () => {
    const user = userEvent.setup();
    const pending = deferred<TrackedAssetValueSnapshot>();
    vi.mocked(updateTrackedAssetValueWithSnapshot).mockReturnValue(pending.promise);

    renderWithProviders(<AssetValuePanel assetId="asset-1" currentValue={1000} />);
    await saveValue(user, "1500");

    // Still in flight: a toast here would claim a save the database never took,
    // and its Undo would point at an entry for a write that may yet reject.
    expect(screen.queryByText(/value recorded/i)).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(VALUE_SNAPSHOT);
      await pending.promise;
    });
    expect(await screen.findByText(/value recorded/i)).toBeInTheDocument();
  });

  it("shows an inline error and fires no toast when the save rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(updateTrackedAssetValueWithSnapshot).mockRejectedValue(
      new Error("db is gone")
    );

    renderWithProviders(<AssetValuePanel assetId="asset-1" currentValue={1000} />);
    await saveValue(user, "1500");

    expect(await screen.findByRole("status")).toHaveTextContent(/db is gone/i);
    expect(screen.queryByText(/value recorded/i)).not.toBeInTheDocument();
  });

  it("formats the resting value with commas and decimals, raw while editing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetValuePanel assetId="asset-1" currentValue={296000} />);
    const input = screen.getByLabelText(/new value/i) as HTMLInputElement;

    // At rest: the number the user reads, fully formatted.
    expect(input.value).toBe("$296,000.00");

    // Focused: raw digits, easy to type into.
    await user.click(input);
    expect(input.value).toBe("296000.00");

    // Blur: back to the formatted resting value.
    await user.tab();
    expect(input.value).toBe("$296,000.00");
  });

  it("does not save or toast in privacy mode", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetValuePanel assetId="asset-1" currentValue={1000} />, {
      amountsHidden: true,
    });

    // The value input is disabled and the Save button is a no-op when hidden.
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(updateTrackedAssetValueWithSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByText(/value recorded/i)).not.toBeInTheDocument();
  });
});
