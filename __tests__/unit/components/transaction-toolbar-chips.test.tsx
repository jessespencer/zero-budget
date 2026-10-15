import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { useSearchParams } from "next/navigation";
import { renderWithProviders } from "@/__tests__/setup/render";
import { TransactionToolbar } from "@/components/transactions/transaction-toolbar";

/**
 * The date chip is the only thing on screen that tells you which dates the
 * table is showing. `?date=YYYY-MM-DD` — the Insights calendar's single-day
 * drill — overrides the month range in the query
 * (`app/(app)/transactions/page.tsx`), but until 2026-07-26 the chip didn't
 * know that: it kept rendering the saved cookie range, so drilling into
 * March 5 from the heatmap showed a strip reading "May 2026 – Jul 2026".
 * The rows were right; the label contradicted them, and there was no control
 * that cleared the day.
 */

const mockedUseSearchParams = vi.mocked(useSearchParams);

function setUrl(query: string) {
  mockedUseSearchParams.mockReturnValue(
    new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>
  );
}

function renderToolbar(defaultRange?: { start: string | null; end: string | null }) {
  return renderWithProviders(
    <TransactionToolbar
      earliestTransactionYear={2015}
      defaultRange={defaultRange}
      categories={[{ id: "c-food", name: "Food" }]}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TransactionToolbar — date chip", () => {
  it("CHIP-01: ?date= renders the day, not the saved range", () => {
    setUrl("date=2026-03-05");

    // The cookie default the page would otherwise pass through — this is
    // exactly the state that produced the wrong label.
    renderToolbar({ start: "2026-05", end: "2026-07" });

    expect(screen.getByText("Mar 5, 2026")).toBeInTheDocument();
    expect(screen.queryByText("May 2026 – Jul 2026")).not.toBeInTheDocument();
  });

  it("CHIP-02: the day chip can be cleared", () => {
    setUrl("date=2026-03-05");
    renderToolbar({ start: "2026-05", end: "2026-07" });

    // Without a remove control the drill is a one-way door — you'd have to
    // edit the URL to get back to your range.
    expect(
      screen.getByRole("button", { name: "Remove Mar 5, 2026 filter" })
    ).toBeInTheDocument();
  });

  it("CHIP-03: without ?date= the range chip still renders", () => {
    setUrl("");
    renderToolbar({ start: "2026-05", end: "2026-07" });

    expect(screen.getByText("May 2026 – Jul 2026")).toBeInTheDocument();
  });

  it("CHIP-04: a malformed ?date= falls back to the range rather than showing junk", () => {
    setUrl("date=not-a-date");
    renderToolbar({ start: "2026-05", end: "2026-07" });

    expect(screen.getByText("May 2026 – Jul 2026")).toBeInTheDocument();
  });

  it("CHIP-05: a single-month range still collapses to one label", () => {
    setUrl("");
    renderToolbar({ start: "2026-05", end: "2026-05" });

    expect(screen.getByText("May 2026")).toBeInTheDocument();
  });
});
