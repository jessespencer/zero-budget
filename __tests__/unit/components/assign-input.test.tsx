import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { AssignInput } from "@/components/budget/assign-input";

// The server action is mocked: this tier asks "did the button call it correctly
// and acknowledge the result", not "did the database end up right". The latter
// is budget-actions.test.ts.
vi.mock("@/app/(app)/budget/actions", () => ({
  updateAssigned: vi.fn(() => Promise.resolve()),
}));
import { updateAssigned } from "@/app/(app)/budget/actions";

const CATEGORY_ID = "cat-groceries";
const MONTH = "2026-07-01";

function setup(props: Partial<Parameters<typeof AssignInput>[0]> = {}) {
  const onMutate = vi.fn();
  const result = renderWithProviders(
    <AssignInput
      categoryId={CATEGORY_ID}
      categoryName="Groceries"
      month={MONTH}
      value={600}
      onMutate={onMutate}
      {...props}
    />,
    { amountsHidden: props.value === undefined ? false : false }
  );
  return { onMutate, ...result };
}

beforeEach(() => {
  vi.mocked(updateAssigned).mockClear();
  vi.mocked(updateAssigned).mockResolvedValue(undefined);
});

describe("AssignInput", () => {
  it("shows the assigned amount, and an em dash when nothing is assigned", () => {
    const { rerender } = setup();
    expect(screen.getByRole("button")).toHaveTextContent("600");

    rerender(
      <AssignInput categoryId={CATEGORY_ID} categoryName="Groceries" month={MONTH} value={0} />
    );
    expect(screen.getByRole("button")).toHaveTextContent("—");
  });

  it("saves the typed amount to the server on Enter", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button"));
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "42.50{Enter}");

    expect(updateAssigned).toHaveBeenCalledWith(CATEGORY_ID, MONTH, 42.5);
  });

  it("discards the edit on Escape without touching the server", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button"));
    await user.clear(screen.getByRole("spinbutton"));
    await user.type(screen.getByRole("spinbutton"), "99{Escape}");

    expect(updateAssigned).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent("600");
  });

  it("skips the server entirely when the value did not change", async () => {
    const user = userEvent.setup();
    const { onMutate } = setup();

    await user.click(screen.getByRole("button"));
    await user.type(screen.getByRole("spinbutton"), "{Enter}");

    expect(updateAssigned).not.toHaveBeenCalled();
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("registers an undo entry that restores the previous amount", async () => {
    const user = userEvent.setup();
    const { onMutate } = setup();

    await user.click(screen.getByRole("button"));
    await user.clear(screen.getByRole("spinbutton"));
    await user.type(screen.getByRole("spinbutton"), "250{Enter}");

    expect(onMutate).toHaveBeenCalledTimes(1);
    const entry = onMutate.mock.calls[0][0];

    vi.mocked(updateAssigned).mockClear();
    await entry.backward();
    expect(updateAssigned).toHaveBeenCalledWith(CATEGORY_ID, MONTH, 600);

    vi.mocked(updateAssigned).mockClear();
    await entry.forward();
    expect(updateAssigned).toHaveBeenCalledWith(CATEGORY_ID, MONTH, 250);
  });

  // The defect class that shipped in /quick: masked somewhere, readable next to
  // it. Privacy mode must also hard-block the edit, not merely hide the digits.
  describe("privacy mode", () => {
    it("masks the amount and refuses to open an editor", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <AssignInput
          categoryId={CATEGORY_ID}
          categoryName="Groceries"
          month={MONTH}
          value={600}
        />,
        { amountsHidden: true }
      );

      const field = screen.getByRole("button", { name: /amounts hidden/i });
      expect(field.textContent).not.toMatch(/\d/);
      expect(field).toBeDisabled();

      await user.click(field);
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(updateAssigned).not.toHaveBeenCalled();
    });

    it("masks a zero balance too, so an empty envelope is not leaked", () => {
      renderWithProviders(
        <AssignInput categoryId={CATEGORY_ID} categoryName="Groceries" month={MONTH} value={0} />,
        { amountsHidden: true }
      );
      expect(screen.getByRole("button").textContent).not.toMatch(/—|\d/);
    });
  });

  // A failed save has no on-screen tell — the grid simply keeps showing the old
  // number — so these two are the entire safety net for a write that didn't land.
  describe("when the save fails", () => {
    it("does not register the undo entry until the server confirms", async () => {
      const user = userEvent.setup();
      const pending = deferred();
      vi.mocked(updateAssigned).mockReturnValue(pending.promise);

      const { onMutate } = setup();
      await user.click(screen.getByRole("button"));
      await user.clear(screen.getByRole("spinbutton"));
      await user.type(screen.getByRole("spinbutton"), "250{Enter}");

      // Still in flight: an entry here would let Cmd+Z "restore" a value the
      // database never held.
      expect(onMutate).not.toHaveBeenCalled();

      await act(async () => {
        pending.resolve();
        await pending.promise;
      });
      expect(onMutate).toHaveBeenCalledTimes(1);
    });

    it("tells the user and registers no undo entry when the server rejects", async () => {
      const user = userEvent.setup();
      vi.mocked(updateAssigned).mockRejectedValue(new Error("db is gone"));

      const { onMutate } = setup();
      await user.click(screen.getByRole("button"));
      await user.clear(screen.getByRole("spinbutton"));
      await user.type(screen.getByRole("spinbutton"), "250{Enter}");

      expect(await screen.findByRole("status")).toHaveTextContent(
        /couldn't update groceries/i
      );
      expect(onMutate).not.toHaveBeenCalled();
    });
  });
});
