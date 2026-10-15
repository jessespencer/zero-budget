import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { TargetSection } from "@/components/budget/target-section";
import type { CategoryWithBudget, Target } from "@/lib/types";
import type { MutationEntry } from "@/lib/use-undo-redo";

// Call-site tier: the server actions are mocked. These tests ask "does the
// button call the action correctly, push undo only after the write lands, and
// acknowledge success and failure" — not "did the DB end up right" (that's
// budget-actions.test.ts).
vi.mock("@/app/(app)/budget/actions", () => ({
  createTarget: vi.fn(() => Promise.resolve("new-target")),
  updateTarget: vi.fn(() => Promise.resolve()),
  deleteTargetWithSnapshot: vi.fn(),
  restoreTarget: vi.fn(() => Promise.resolve()),
  updateAssigned: vi.fn(() => Promise.resolve()),
}));
import {
  createTarget,
  updateTarget,
  deleteTargetWithSnapshot,
  updateAssigned,
  type TargetSnapshot,
} from "@/app/(app)/budget/actions";

const CATEGORY_ID = "cat-groceries";
const MONTH = "2026-07-01";

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: "target-1",
    user_id: "u1",
    category_id: CATEGORY_ID,
    type: "savings_balance",
    frequency: "custom",
    target_amount: 1000,
    target_date: null,
    monthly_contribution: null,
    priority: null,
    recurring: false,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

function makeCategory(overrides: Partial<CategoryWithBudget> = {}): CategoryWithBudget {
  return {
    id: CATEGORY_ID,
    category_group_id: "group-1",
    user_id: "u1",
    name: "Groceries",
    sort_order: 0,
    archived: false,
    allocation_account_id: null,
    is_buffer: false,
    pinned_quick: false,
    notes: "",
    created_at: "",
    updated_at: "",
    assigned: 200,
    activity: 0,
    available: 200,
    cumulative_assigned: 200,
    // Open-ended savings goal ⇒ the 5/10/25% quick-assign buttons render.
    target: makeTarget(),
    autoAssign: {
      assignedLastMonth: 0,
      spentLastMonth: 0,
      averageAssigned: 0,
      averageSpent: 0,
    },
    ...overrides,
  };
}

function setup(props: Partial<Parameters<typeof TargetSection>[0]> = {}) {
  const onMutate = vi.fn((_entry: MutationEntry) => "mutation-42");
  const undoEntry = vi.fn();
  const category = props.category ?? makeCategory();
  const result = renderWithProviders(
    <TargetSection
      category={category}
      month={MONTH}
      onMutate={onMutate}
      undoEntry={undoEntry}
      {...props}
    />
  );
  return { onMutate, undoEntry, category, ...result };
}

beforeEach(() => {
  vi.mocked(createTarget).mockReset().mockResolvedValue("new-target");
  vi.mocked(updateTarget).mockReset().mockResolvedValue(undefined);
  vi.mocked(updateAssigned).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteTargetWithSnapshot).mockReset().mockResolvedValue(SNAPSHOT);
});

// deleteTargetWithSnapshot returns the DB row shape (recurring 0/1), distinct
// from the `Target` prop shape (recurring boolean).
const SNAPSHOT: TargetSnapshot = {
  id: "target-1",
  category_id: CATEGORY_ID,
  type: "savings_balance",
  frequency: "custom",
  target_amount: 1000,
  target_date: null,
  monthly_contribution: null,
  priority: null,
  recurring: 0,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

describe("TargetSection quick-assign (F1/F2)", () => {
  it("registers the undo entry only after the write confirms", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    vi.mocked(updateAssigned).mockReturnValue(pending.promise);
    const { onMutate } = setup();

    // 5% of the $800 to-go = $40, applied on top of the $200 already assigned.
    await user.click(screen.getByRole("button", { name: /^5%/ }));
    expect(updateAssigned).toHaveBeenCalledWith(CATEGORY_ID, MONTH, 240);

    // In flight: an entry here would let Cmd+Z restore a value the DB never held.
    expect(onMutate).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(onMutate).toHaveBeenCalledTimes(1);
  });

  it("tells the user and registers no undo entry when the assign fails", async () => {
    const user = userEvent.setup();
    vi.mocked(updateAssigned).mockRejectedValue(new Error("db is gone"));
    const { onMutate } = setup();

    await user.click(screen.getByRole("button", { name: /^5%/ }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't assign to groceries/i
    );
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("undo restores the pre-click assigned amount", async () => {
    const user = userEvent.setup();
    const { onMutate } = setup();

    await user.click(screen.getByRole("button", { name: /^5%/ }));
    expect(onMutate).toHaveBeenCalledTimes(1);
    const entry = onMutate.mock.calls[0][0];

    vi.mocked(updateAssigned).mockClear();
    await entry.backward();
    expect(updateAssigned).toHaveBeenCalledWith(CATEGORY_ID, MONTH, 200);
  });
});

describe("TargetSection delete (F3/F5)", () => {
  async function openEditAndDelete(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /edit target/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
  }

  it("snapshots the target, toasts with a working Undo, and shows no confirm dialog", async () => {
    const user = userEvent.setup();
    const { onMutate, undoEntry } = setup();

    await openEditAndDelete(user);

    expect(deleteTargetWithSnapshot).toHaveBeenCalledWith("target-1");
    // Snapshot route — no "cannot be undone" confirm gate.
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/deleted the groceries target/i);

    // Toast-Undo must target THIS entry, via the id onMutate returned.
    expect(onMutate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(undoEntry).toHaveBeenCalledWith("mutation-42");
  });

  it("keeps the edit view and warns when the delete fails", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteTargetWithSnapshot).mockRejectedValue(new Error("locked"));
    const { onMutate } = setup();

    await openEditAndDelete(user);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't delete the target/i
    );
    // Not dropped to the empty "create a target" state — the target is still there.
    expect(
      screen.queryByText(/how much do you need/i)
    ).not.toBeInTheDocument();
    expect(onMutate).not.toHaveBeenCalled();
  });

  // The view used to be seeded from `category.target` once, at mount. Undo
  // restores the row and revalidation hands the panel its target back, but the
  // panel stayed on "How much do you need?" while the budget row showed the goal.
  it("shows the target again when undo brings it back", async () => {
    const user = userEvent.setup();
    const { rerender } = setup();
    const render = (category: CategoryWithBudget) => (
      <TargetSection category={category} month={MONTH} />
    );

    await openEditAndDelete(user);
    rerender(render(makeCategory({ target: null })));
    expect(screen.getByText(/how much do you need/i)).toBeInTheDocument();

    rerender(render(makeCategory()));
    expect(screen.getByRole("button", { name: /edit target/i })).toBeInTheDocument();
    expect(screen.queryByText(/how much do you need/i)).not.toBeInTheDocument();
  });

  it("shows a target that arrives after the panel mounted empty", () => {
    const { rerender } = setup({ category: makeCategory({ target: null }) });
    rerender(<TargetSection category={makeCategory()} month={MONTH} />);
    expect(screen.getByRole("button", { name: /edit target/i })).toBeInTheDocument();
  });
});

describe("TargetSection save (F4)", () => {
  it("keeps the form open and warns when a create fails", async () => {
    const user = userEvent.setup();
    vi.mocked(createTarget).mockRejectedValue(new Error("db is gone"));
    // No target yet ⇒ starts in the empty state.
    setup({ category: makeCategory({ target: null }) });

    await user.click(screen.getByRole("button", { name: /create target/i }));
    await user.type(screen.getByPlaceholderText("0.00"), "500");
    await user.click(screen.getByRole("button", { name: /save target/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't save your target/i
    );
    // Still in the edit form — the input survived, so the user can retry.
    expect(
      screen.getByRole("button", { name: /save target/i })
    ).toBeInTheDocument();
  });

  it("closes the form back to the summary once an edit saves", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /edit target/i }));
    const amount = screen.getByDisplayValue("1000");
    await user.clear(amount);
    await user.type(amount, "1500");
    await user.click(screen.getByRole("button", { name: /save target/i }));

    expect(updateTarget).toHaveBeenCalled();
    // Back in the summary view — the edit form is gone.
    expect(
      await screen.findByRole("button", { name: /edit target/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save target/i })
    ).not.toBeInTheDocument();
  });
});
