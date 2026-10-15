import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { HiddenCategoriesSection } from "@/components/budget/hidden-categories-section";
import { useUndoRedo, __resetUndoRedo } from "@/lib/use-undo-redo";
import type {
  CategoryWithBudget,
  CategoryGroupWithCategories,
} from "@/lib/types";

// Call-site tier — the server actions are mocked. This asks whether unhide
// acknowledges itself, survives a rejection, and undoes *this* unhide rather
// than whatever is on top of the stack. The flag flip and the re-hide set are
// budget-actions.test.ts.
vi.mock("@/app/(app)/budget/actions", () => ({
  unarchiveCategoryWithSnapshot: vi.fn(),
  restoreUnarchiveCategorySnapshot: vi.fn(() => Promise.resolve()),
  unarchiveGroupWithSnapshot: vi.fn(),
  restoreUnarchiveGroupSnapshot: vi.fn(() => Promise.resolve()),
}));
import {
  unarchiveCategoryWithSnapshot,
  restoreUnarchiveCategorySnapshot,
  unarchiveGroupWithSnapshot,
  restoreUnarchiveGroupSnapshot,
} from "@/app/(app)/budget/actions";

const MONTH = "2026-07-01";

function makeCategory(
  id: string,
  name: string,
  groupId = "grp-everyday"
): CategoryWithBudget {
  return {
    id,
    category_group_id: groupId,
    user_id: "u1",
    name,
    sort_order: 0,
    archived: true,
    allocation_account_id: null,
    is_buffer: false,
    pinned_quick: false,
    notes: "",
    created_at: MONTH,
    updated_at: MONTH,
    assigned: 0,
    activity: 0,
    available: 0,
    cumulative_assigned: 0,
    target: null,
    autoAssign: {
      assignedLastMonth: 0,
      spentLastMonth: 0,
      averageAssigned: 0,
      averageSpent: 0,
    },
  };
}

function makeGroup(
  id: string,
  name: string,
  categories: CategoryWithBudget[] = []
): CategoryGroupWithCategories {
  return {
    id,
    user_id: "u1",
    name,
    sort_order: 0,
    archived: true,
    is_income: false,
    is_system: false,
    created_at: MONTH,
    updated_at: MONTH,
    categories,
    groupAssigned: 0,
    groupActivity: 0,
    groupAvailable: 0,
  };
}

/**
 * Wires `onMutate` to the real undo stack the way BudgetTable does, so the
 * toast's Undo goes through `undoEntry` for real rather than against a stub.
 * That is the only way to prove the entry it reaches is its own — a mocked
 * `onMutate` returning a fake id would make `undoEntry` a silent no-op and the
 * assertion vacuous.
 */
function Harness({
  categories = [],
  groups = [],
}: {
  categories?: CategoryWithBudget[];
  groups?: CategoryGroupWithCategories[];
}) {
  const { push } = useUndoRedo();
  return (
    <HiddenCategoriesSection
      categories={categories}
      groups={groups}
      month={MONTH}
      onMutate={push}
      selectedGroupIds={new Set()}
      selectedCategoryIds={new Set()}
      onToggleGroup={() => {}}
      onToggleCategory={() => {}}
    />
  );
}

// The section is collapsed by default and its children carry `hidden`, which
// takes them out of the accessibility tree — so every test has to open it
// first, exactly as a user would.
async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^hidden/i }));
}

beforeEach(() => {
  __resetUndoRedo();
  vi.mocked(unarchiveCategoryWithSnapshot).mockReset();
  vi.mocked(unarchiveGroupWithSnapshot).mockReset();
  vi.mocked(restoreUnarchiveCategorySnapshot)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(restoreUnarchiveGroupSnapshot)
    .mockReset()
    .mockResolvedValue(undefined);
});

describe("HiddenCategoriesSection", () => {
  it("toasts when a category is unhidden", async () => {
    const user = userEvent.setup();
    vi.mocked(unarchiveCategoryWithSnapshot).mockResolvedValue({
      categoryId: "cat-groceries",
    });
    renderWithProviders(
      <Harness categories={[makeCategory("cat-groceries", "Groceries")]} />
    );

    await expand(user);
    await user.click(screen.getByRole("button", { name: /unhide groceries/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /unhid "groceries"/i
    );
    expect(unarchiveCategoryWithSnapshot).toHaveBeenCalledWith("cat-groceries");
  });

  it("toasts when a group is unhidden", async () => {
    const user = userEvent.setup();
    vi.mocked(unarchiveGroupWithSnapshot).mockResolvedValue({
      groupId: "grp-housing",
      reHiddenCategoryIds: [],
    });
    renderWithProviders(<Harness groups={[makeGroup("grp-housing", "Housing")]} />);

    await expand(user);
    await user.click(
      screen.getByRole("button", { name: /unhide group housing/i })
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /unhid group "housing"/i
    );
    expect(unarchiveGroupWithSnapshot).toHaveBeenCalledWith("grp-housing");
  });

  it("reports a failed unhide and registers no undo entry", async () => {
    const user = userEvent.setup();
    vi.mocked(unarchiveCategoryWithSnapshot).mockRejectedValue(
      new Error("db is gone")
    );
    renderWithProviders(
      <Harness categories={[makeCategory("cat-groceries", "Groceries")]} />
    );

    await expand(user);
    await user.click(screen.getByRole("button", { name: /unhide groceries/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't unhide "groceries"\. nothing was changed\./i
    );
    // No Undo affordance on a failure — there is nothing to undo.
    expect(
      screen.queryByRole("button", { name: /^undo$/i })
    ).not.toBeInTheDocument();
  });

  it("undoes the unhide it was raised for, not the top of the stack", async () => {
    const user = userEvent.setup();
    vi.mocked(unarchiveCategoryWithSnapshot)
      .mockResolvedValueOnce({ categoryId: "cat-groceries" })
      .mockResolvedValueOnce({ categoryId: "cat-dining" });
    renderWithProviders(
      <Harness
        categories={[
          makeCategory("cat-groceries", "Groceries"),
          makeCategory("cat-dining", "Dining"),
        ]}
      />
    );

    await expand(user);
    await user.click(screen.getByRole("button", { name: /unhide groceries/i }));
    await screen.findByRole("status");
    // A second mutation lands while the first toast is still on screen — the
    // exact six-second window where `undo()` would pop the wrong entry.
    await user.click(screen.getByRole("button", { name: /unhide dining/i }));
    await waitFor(() =>
      expect(screen.getAllByRole("status")).toHaveLength(2)
    );

    const groceriesToast = screen
      .getAllByRole("status")
      .find((t) => /groceries/i.test(t.textContent ?? ""))!;
    await user.click(
      within(groceriesToast).getByRole("button", { name: /^undo$/i })
    );

    await waitFor(() =>
      expect(restoreUnarchiveCategorySnapshot).toHaveBeenCalledWith({
        categoryId: "cat-groceries",
      })
    );
    expect(restoreUnarchiveCategorySnapshot).toHaveBeenCalledTimes(1);
  });
});
