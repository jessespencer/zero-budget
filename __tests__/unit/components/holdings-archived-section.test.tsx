import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { HoldingsList } from "@/components/net-worth/holdings-list";
import type { Account, TrackedAsset } from "@/lib/types";
import type { TrackedAssetWithLast } from "@/components/net-worth/holdings-list-utils";

// The Archived section is the route back from AssetMenu's Archive action.
// Without it that confirm's copy — "you can unarchive it later from the
// Archived section" — is a promise the app doesn't keep, which is the exact
// bug d4b3a68 fixed for accounts and this feature fixes for assets.
vi.mock("@/app/(app)/assets/actions", () => ({
  unarchiveTrackedAsset: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { unarchiveTrackedAsset } from "@/app/(app)/assets/actions";

const asset = (over: Partial<TrackedAsset>): TrackedAsset => ({
  id: "asset-1",
  user_id: "u1",
  name: "Old car",
  asset_type: "vehicle",
  current_value: 4200,
  notes: null,
  sort_order: 0,
  archived: true,
  created_at: "",
  updated_at: "",
  ...over,
});

const LIVE: TrackedAssetWithLast = {
  ...asset({ id: "asset-live", name: "Brokerage", asset_type: "investment", archived: false }),
  lastRecordedAt: null,
};

const ARCHIVED = asset({ id: "asset-archived", name: "Old car" });

function setup(archivedAssets: TrackedAsset[], accounts: Account[] = []) {
  return renderWithProviders(
    <HoldingsList
      accounts={accounts}
      trackedAssets={[LIVE]}
      archivedAssets={archivedAssets}
    />
  );
}

const archivedHeader = () =>
  screen.getByRole("button", { name: /archived/i });

beforeEach(() => {
  vi.mocked(unarchiveTrackedAsset).mockReset().mockResolvedValue({ ok: true });
});

describe("HoldingsList — Archived section", () => {
  it("renders no Archived section when nothing is archived", () => {
    setup([]);

    expect(
      screen.queryByRole("button", { name: /archived/i })
    ).not.toBeInTheDocument();
    // The live asset still renders — the section is additive.
    expect(screen.getByText("Brokerage")).toBeInTheDocument();
  });

  it("starts collapsed so the archive doesn't crowd the holdings view", async () => {
    setup([ARCHIVED]);

    expect(archivedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Old car")).not.toBeVisible();
  });

  it("heads the section with a count, not a total", () => {
    setup([ARCHIVED, asset({ id: "asset-2", name: "Boat" })]);

    // Archived assets are excluded from net worth, so a sum here would invite
    // reading it as money that still counts.
    expect(archivedHeader()).toHaveTextContent("2");
    expect(archivedHeader()).not.toHaveTextContent("$");
  });

  it("reveals the rows when expanded", async () => {
    const user = userEvent.setup();
    setup([ARCHIVED]);

    await user.click(archivedHeader());

    expect(archivedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Old car")).toBeVisible();
  });

  it("unarchives from the row button and toasts", async () => {
    const user = userEvent.setup();
    setup([ARCHIVED]);
    await user.click(archivedHeader());

    await user.click(screen.getByRole("button", { name: /unarchive/i }));

    expect(unarchiveTrackedAsset).toHaveBeenCalledWith(ARCHIVED.id);
    // The asset reappears in a group further up the page that may be scrolled
    // out of view — without the toast nothing says the click worked.
    expect(await screen.findByRole("status")).toHaveTextContent(
      /"old car" unarchived/i
    );
  });

  it("surfaces a rejected unarchive rather than failing silently", async () => {
    const user = userEvent.setup();
    vi.mocked(unarchiveTrackedAsset).mockRejectedValue(new Error("db is gone"));
    setup([ARCHIVED]);
    await user.click(archivedHeader());

    await user.click(screen.getByRole("button", { name: /unarchive/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't unarchive "old car"/i
    );
  });

  it("surfaces an ok:false result too, not just a throw", async () => {
    const user = userEvent.setup();
    vi.mocked(unarchiveTrackedAsset).mockResolvedValue({
      ok: false,
      reason: "not_found",
    });
    setup([ARCHIVED]);
    await user.click(archivedHeader());

    await user.click(screen.getByRole("button", { name: /unarchive/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't unarchive "old car"/i
    );
  });

  it("renders the Archived section even when it is the only holding", () => {
    // An all-archived account must still be able to reach its assets; this is
    // the case the empty-state guards in NetWorthTab/InsightsTabs also cover.
    // Rendered directly rather than via setup(), which always seeds a live
    // asset — the whole point here is that there isn't one.
    renderWithProviders(
      <HoldingsList accounts={[]} trackedAssets={[]} archivedAssets={[ARCHIVED]} />
    );

    expect(screen.queryByText(/no holdings yet/i)).not.toBeInTheDocument();
    expect(archivedHeader()).toBeInTheDocument();
  });
});
