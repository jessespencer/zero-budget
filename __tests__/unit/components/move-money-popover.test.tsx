import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { MoveMoneyPopover } from "@/components/budget/move-money-popover";
import type { MutationEntry } from "@/lib/use-undo-redo";

// Call-site tier — the server action is mocked. This asks whether the popover
// closes only on success, surfaces failure, and undoes *this* move; the DB
// round-trip and the same-source/non-finite guards are budget-actions.test.ts.
vi.mock("@/app/(app)/budget/actions", () => ({
  moveMoneyBetweenCategoriesWithSnapshot: vi.fn(),
  restoreMoveMoneySnapshot: vi.fn(() => Promise.resolve()),
}));
import {
  moveMoneyBetweenCategoriesWithSnapshot,
  restoreMoveMoneySnapshot,
} from "@/app/(app)/budget/actions";

const MONTH = "2026-07-01";
const SNAPSHOT = { month: MONTH, entries: [] } as never;

function setup(
  props: Partial<Parameters<typeof MoveMoneyPopover>[0]> = {},
  { amountsHidden = false } = {}
) {
  const onMutate = vi.fn((_entry: MutationEntry) => "mutation-7");
  const undoEntry = vi.fn();
  const result = renderWithProviders(
    <MoveMoneyPopover
      sourceCategoryId="cat-groceries"
      sourceCategoryName="Groceries"
      sourceAvailable={100}
      month={MONTH}
      destinations={[
        { id: "cat-dining", name: "Dining", groupName: "Everyday" },
      ]}
      onMutate={onMutate}
      undoEntry={undoEntry}
      {...props}
    >
      <button>Move money</button>
    </MoveMoneyPopover>,
    { amountsHidden }
  );
  return { onMutate, undoEntry, ...result };
}

// Open the popover (default destination is Ready to Assign, amount prefilled
// with source available) and click Move.
async function openAndMove(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /move money/i }));
  const move = await screen.findByRole("button", { name: /^move$/i });
  await user.click(move);
}

beforeEach(() => {
  vi.mocked(moveMoneyBetweenCategoriesWithSnapshot).mockReset();
  vi.mocked(restoreMoveMoneySnapshot).mockReset().mockResolvedValue(undefined);
});

describe("MoveMoneyPopover", () => {
  it("closes, registers the move, and toasts with a working Undo on success", async () => {
    const user = userEvent.setup();
    vi.mocked(moveMoneyBetweenCategoriesWithSnapshot).mockResolvedValue(SNAPSHOT);
    const { onMutate, undoEntry } = setup();

    await openAndMove(user);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/moved .* from "groceries" to "ready to assign"/i);
    expect(onMutate).toHaveBeenCalledTimes(1);
    expect(moveMoneyBetweenCategoriesWithSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCategoryId: "cat-groceries",
        destCategoryId: "RTA",
        amount: 100,
        month: MONTH,
      })
    );

    // Undo targets THIS move, not the top of the stack.
    await user.click(screen.getByRole("button", { name: /^undo$/i }));
    expect(undoEntry).toHaveBeenCalledWith("mutation-7");

    // Popover closed.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^move$/i })).not.toBeInTheDocument()
    );
  });

  it("stays open and warns when the move fails, registering no undo entry", async () => {
    const user = userEvent.setup();
    vi.mocked(moveMoneyBetweenCategoriesWithSnapshot).mockRejectedValue(
      new Error("Source and destination must be different")
    );
    const { onMutate } = setup();

    await openAndMove(user);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't move money from "groceries" to "ready to assign"/i
    );
    expect(onMutate).not.toHaveBeenCalled();
    // The popover stays open so the user can correct and retry.
    expect(screen.getByRole("button", { name: /^move$/i })).toBeInTheDocument();
  });

  it("does not close while the move is still in flight", async () => {
    const user = userEvent.setup();
    const pending = deferred<typeof SNAPSHOT>();
    vi.mocked(moveMoneyBetweenCategoriesWithSnapshot).mockReturnValue(pending.promise);
    setup();

    await openAndMove(user);

    // Still pending — the popover must not have closed yet (the old bug closed
    // it synchronously on submit, before the write resolved), and the submit
    // shows the move is in flight and can't be fired twice.
    const inFlight = screen.getByRole("button", { name: /moving…/i });
    expect(inFlight).toBeDisabled();

    await act(async () => {
      pending.resolve(SNAPSHOT);
      await pending.promise;
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^(move|moving…)$/i })).not.toBeInTheDocument()
    );
  });
});
