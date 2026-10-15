import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { ExpectedIncomeInput } from "@/components/budget/expected-income-input";

// Call-site tier — the server action is mocked. This asks "did the row register
// the undo entry only after the write landed, and does a failure say so", not
// "did the DB end up right" (that's budget-actions.test.ts).
vi.mock("@/app/(app)/budget/actions", () => ({
  updateExpectedIncome: vi.fn(() => Promise.resolve()),
}));
import { updateExpectedIncome } from "@/app/(app)/budget/actions";

const MONTH = "2026-07-01";

function setup(props: Partial<Parameters<typeof ExpectedIncomeInput>[0]> = {}) {
  const onMutate = vi.fn();
  const result = renderWithProviders(
    <ExpectedIncomeInput
      month={MONTH}
      forecast={1500}
      received={1000}
      onMutate={onMutate}
      {...props}
    />,
    { amountsHidden: false }
  );
  return { onMutate, ...result };
}

async function edit(user: ReturnType<typeof userEvent.setup>, next: string) {
  // The headline is the only button when a forecast is set (the received
  // sub-line is a span). Click it to open the editor, then type.
  await user.click(screen.getByRole("button"));
  const input = screen.getByRole("spinbutton");
  await user.clear(input);
  if (next !== "") await user.type(input, next);
  await user.type(input, "{Enter}");
}

beforeEach(() => {
  vi.mocked(updateExpectedIncome).mockReset().mockResolvedValue(undefined);
});

describe("ExpectedIncomeInput", () => {
  it("saves the typed forecast to the server on Enter", async () => {
    const user = userEvent.setup();
    setup();

    await edit(user, "2000");

    expect(updateExpectedIncome).toHaveBeenCalledWith(MONTH, 2000);
  });

  it("registers an undo entry that restores the previous forecast", async () => {
    const user = userEvent.setup();
    const { onMutate } = setup();

    await edit(user, "2000");

    expect(onMutate).toHaveBeenCalledTimes(1);
    const entry = onMutate.mock.calls[0][0];
    expect(entry.label).toMatch(/set expected income to/i);

    vi.mocked(updateExpectedIncome).mockClear();
    await entry.backward();
    expect(updateExpectedIncome).toHaveBeenCalledWith(MONTH, 1500);

    vi.mocked(updateExpectedIncome).mockClear();
    await entry.forward();
    expect(updateExpectedIncome).toHaveBeenCalledWith(MONTH, 2000);
  });

  it("clears the forecast and labels the undo entry accordingly", async () => {
    const user = userEvent.setup();
    const { onMutate } = setup();

    await edit(user, "");

    expect(updateExpectedIncome).toHaveBeenCalledWith(MONTH, null);
    expect(onMutate.mock.calls[0][0].label).toBe("Clear expected income");
  });

  it("does nothing when the value is unchanged", async () => {
    const user = userEvent.setup();
    const { onMutate } = setup();

    await edit(user, "1500");

    expect(updateExpectedIncome).not.toHaveBeenCalled();
    expect(onMutate).not.toHaveBeenCalled();
  });

  // Finding 1: the undo entry used to be pushed synchronously, alongside a
  // still-pending write. A failed save then left a phantom entry whose Cmd+Z
  // wrote a forecast the database never held.
  describe("when the save fails", () => {
    it("does not register the undo entry until the server confirms", async () => {
      const user = userEvent.setup();
      const pending = deferred();
      vi.mocked(updateExpectedIncome).mockReturnValue(pending.promise);

      const { onMutate } = setup();
      await edit(user, "2000");

      expect(onMutate).not.toHaveBeenCalled();

      await act(async () => {
        pending.resolve();
        await pending.promise;
      });
      expect(onMutate).toHaveBeenCalledTimes(1);
    });

    it("tells the user and registers no undo entry when the server rejects", async () => {
      const user = userEvent.setup();
      vi.mocked(updateExpectedIncome).mockRejectedValue(new Error("db is gone"));

      const { onMutate } = setup();
      await edit(user, "2000");

      expect(await screen.findByRole("status")).toHaveTextContent(
        /couldn't update expected income/i
      );
      expect(onMutate).not.toHaveBeenCalled();
    });
  });

  // The defect that shipped in /quick: masked in the grid, readable two inches
  // away. Privacy mode must hard-block the edit, not merely hide the digits.
  describe("privacy mode", () => {
    it("masks the amount and refuses to open an editor", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <ExpectedIncomeInput
          month={MONTH}
          forecast={1500}
          received={1000}
          onMutate={vi.fn()}
        />,
        { amountsHidden: true }
      );

      const button = screen.getByRole("button");
      expect(button.textContent).not.toMatch(/1500|1,500/);
      expect(button).toBeDisabled();

      await user.click(button);
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(updateExpectedIncome).not.toHaveBeenCalled();
    });
  });
});
