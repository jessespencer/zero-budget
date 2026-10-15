import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { CategoryAutoAssignSection } from "@/components/budget/category-auto-assign-section";
import type { CategoryWithBudget } from "@/lib/types";
import type { MutationEntry } from "@/lib/use-undo-redo";

// Call-site tier — server actions mocked. Asserts the row wires undo + toast
// and catches failure; the DB round-trip is budget-actions.test.ts.
vi.mock("@/app/(app)/budget/actions", () => ({
  setCategoryAssignedWithSnapshot: vi.fn(),
  updateAssigned: vi.fn(() => Promise.resolve()),
}));
import {
  setCategoryAssignedWithSnapshot,
  updateAssigned,
} from "@/app/(app)/budget/actions";

const CATEGORY_ID = "cat-groceries";
const MONTH = "2026-07-01";

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
    target: null,
    autoAssign: {
      // Differs from `assigned` (200) so the "Assigned last month" row is a
      // real change, not a disabled no-op.
      assignedLastMonth: 300,
      spentLastMonth: 0,
      averageAssigned: 0,
      averageSpent: 0,
    },
    ...overrides,
  };
}

function setup() {
  const onMutate = vi.fn((_entry: MutationEntry) => "mutation-99");
  const undoEntry = vi.fn();
  const result = renderWithProviders(
    <CategoryAutoAssignSection
      category={makeCategory()}
      month={MONTH}
      onMutate={onMutate}
      undoEntry={undoEntry}
    />
  );
  return { onMutate, undoEntry, ...result };
}

beforeEach(() => {
  vi.mocked(setCategoryAssignedWithSnapshot)
    .mockReset()
    .mockResolvedValue({ previous: 200 });
  vi.mocked(updateAssigned).mockReset().mockResolvedValue(undefined);
});

describe("CategoryAutoAssignSection (F10/F11)", () => {
  it("toasts with a working Undo wired to the entry onMutate returned", async () => {
    const user = userEvent.setup();
    const { onMutate, undoEntry } = setup();

    await user.click(screen.getByRole("button", { name: /assigned last month/i }));

    expect(setCategoryAssignedWithSnapshot).toHaveBeenCalledWith(
      CATEGORY_ID,
      MONTH,
      300
    );
    expect(onMutate).toHaveBeenCalledTimes(1);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/assigned to groceries/i);

    // The identity that makes Toast-Undo undo THIS row, not the top of the
    // stack: the id push returned must be the id handed to undoEntry.
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(undoEntry).toHaveBeenCalledWith("mutation-99");
  });

  it("undo restores the DB-read previous value, not the clicked target", async () => {
    const user = userEvent.setup();
    vi.mocked(setCategoryAssignedWithSnapshot).mockResolvedValue({ previous: 175 });
    const { onMutate } = setup();

    await user.click(screen.getByRole("button", { name: /assigned last month/i }));
    const entry = onMutate.mock.calls[0][0];

    vi.mocked(updateAssigned).mockClear();
    await entry.backward();
    expect(updateAssigned).toHaveBeenCalledWith(CATEGORY_ID, MONTH, 175);
  });

  it("tells the user and registers no undo entry when the assign fails", async () => {
    const user = userEvent.setup();
    vi.mocked(setCategoryAssignedWithSnapshot).mockRejectedValue(
      new Error("db is gone")
    );
    const { onMutate } = setup();

    await user.click(screen.getByRole("button", { name: /assigned last month/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't assign to groceries/i
    );
    expect(onMutate).not.toHaveBeenCalled();
  });
});
