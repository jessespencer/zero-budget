import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { CategoryMenu } from "@/components/budget/category-menu";
import type { CategoryWithBudget } from "@/lib/types";

// Call-site tier: this asks "did the menu call the right action, in the right
// order, and acknowledge the result" — not "did the database end up right".
// restoreCategoryDeletionSnapshot is mocked too because useCategoryRestore
// (handleDelete's backward()) imports it directly; it's never invoked here
// since none of these tests call entry.backward().
vi.mock("@/app/(app)/budget/actions", () => ({
  archiveCategoryWithSnapshot: vi.fn(),
  restoreArchiveCategorySnapshot: vi.fn(() => Promise.resolve()),
  bulkDeleteCategoriesWithSnapshot: vi.fn(),
  restoreCategoryDeletionSnapshot: vi.fn(() => Promise.resolve({ ok: true })),
  getCategoryDeletionImpact: vi.fn(() =>
    Promise.resolve({ transactionCount: 0, splitCount: 0, categoryCount: 1 })
  ),
  reorderCategory: vi.fn(),
}));
import {
  archiveCategoryWithSnapshot,
  bulkDeleteCategoriesWithSnapshot,
  getCategoryDeletionImpact,
  reorderCategory,
} from "@/app/(app)/budget/actions";

const CATEGORY_ID = "cat-groceries";
const CATEGORY_NAME = "Groceries";
const GROUP_ID = "group-1";
const MONTH = "2026-07-01";

const category: CategoryWithBudget = {
  id: CATEGORY_ID,
  category_group_id: GROUP_ID,
  user_id: "u1",
  name: CATEGORY_NAME,
  sort_order: 0,
  archived: false,
  allocation_account_id: null,
  is_buffer: false,
  pinned_quick: false,
  notes: "",
  created_at: "",
  updated_at: "",
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

function setup(props: Partial<Parameters<typeof CategoryMenu>[0]> = {}) {
  const onMutate = vi.fn(() => "entry-id");
  const result = renderWithProviders(
    <CategoryMenu
      categoryId={CATEGORY_ID}
      categoryName={CATEGORY_NAME}
      groupId={GROUP_ID}
      month={MONTH}
      isFirst={false}
      isLast={false}
      reassignOptions={[
        { id: "c-household", name: "Household", groupName: "Bills" },
      ]}
      onRenameStart={() => {}}
      onMutate={onMutate}
      accounts={[]}
      category={category}
      otherGroups={[]}
      onMoveToGroup={() => {}}
      {...props}
    />
  );
  return { onMutate, ...result };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /options for groceries/i }));
}

async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>) {
  await openMenu(user);
  await user.click(await screen.findByRole("menuitem", { name: /^delete$/i }));
}

beforeEach(() => {
  vi.mocked(archiveCategoryWithSnapshot)
    .mockReset()
    .mockResolvedValue({ categoryId: CATEGORY_ID, month: MONTH, previousAssigned: 0 });
  vi.mocked(bulkDeleteCategoriesWithSnapshot)
    .mockReset()
    // Shape doesn't matter here — the call site forwards it verbatim to
    // useCategoryRestore, which none of these tests exercise.
    .mockResolvedValue({} as never);
  vi.mocked(reorderCategory).mockReset().mockResolvedValue(undefined);
});

describe("CategoryMenu", () => {
  describe("Hide category", () => {
    it("archives the category and toasts an undoable confirmation", async () => {
      const user = userEvent.setup();
      setup();
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: /hide category/i }));

      expect(archiveCategoryWithSnapshot).toHaveBeenCalledWith(CATEGORY_ID, MONTH);
      // Hiding sweeps money back to Ready to Assign with no on-screen number
      // changing at the moment it happens — CLAUDE.md requires a toast for
      // exactly this case.
      expect(await screen.findByRole("status")).toHaveTextContent(/hid "groceries"/i);
      expect(await screen.findByRole("button", { name: /undo/i })).toBeInTheDocument();
    });

    it("does not register the undo entry until the archive resolves", async () => {
      const user = userEvent.setup();
      const pending = deferred<{ categoryId: string; month: string; previousAssigned: number }>();
      vi.mocked(archiveCategoryWithSnapshot).mockReturnValue(pending.promise);

      const { onMutate } = setup();
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: /hide category/i }));

      // Still in flight: an entry here would let Cmd+Z "restore" a state the
      // archive never actually reached.
      expect(onMutate).not.toHaveBeenCalled();

      await act(async () => {
        pending.resolve({ categoryId: CATEGORY_ID, month: MONTH, previousAssigned: 0 });
        await pending.promise;
      });
      expect(onMutate).toHaveBeenCalledTimes(1);
    });

    it("tells the user and registers no undo entry when the archive rejects", async () => {
      const user = userEvent.setup();
      vi.mocked(archiveCategoryWithSnapshot).mockRejectedValue(new Error("db is gone"));

      const { onMutate } = setup();
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: /hide category/i }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /couldn't hide "groceries"/i
      );
      expect(onMutate).not.toHaveBeenCalled();
    });
  });

  describe("Delete", () => {
    // A category with assign history can't be deleted into nowhere: the server
    // refuses it, because dropping monthly_budgets rows inflates Ready to
    // Assign by whatever was already spent out of that envelope. The dialog
    // has to collect a destination rather than let the user hit that error.
    it("requires a destination when the category has budget history", async () => {
      const user = userEvent.setup();
      vi.mocked(getCategoryDeletionImpact).mockResolvedValueOnce({
        transactionCount: 12,
        splitCount: 0,
        categoryCount: 1,
        budgetHistoryCount: 6,
      });
      setup();
      await openDeleteConfirm(user);

      const deleteButton = await screen.findByRole("button", { name: /^delete$/i });
      expect(deleteButton).toBeDisabled();
      // "Leave uncategorized" is exactly the option that would lose the
      // history, so it must not be offered at all.
      await user.click(screen.getByRole("combobox"));
      expect(
        screen.queryByRole("option", { name: /leave uncategorized/i })
      ).not.toBeInTheDocument();

      await user.click(await screen.findByRole("option", { name: /household/i }));
      expect(deleteButton).toBeEnabled();

      // Base UI renders the raw value unless SelectValue is given children to
      // map it back to a label. A bare <SelectValue /> put the category's UUID
      // in the trigger — caught by driving this in the browser, invisible to
      // every assertion that only looked at the button's disabled state.
      expect(screen.getByRole("combobox")).toHaveTextContent("Household");
      expect(screen.getByRole("combobox")).not.toHaveTextContent("c-household");
      await user.click(deleteButton);

      expect(bulkDeleteCategoriesWithSnapshot).toHaveBeenCalledWith({
        categoryIds: [CATEGORY_ID],
        groupIds: [],
        reassignToCategoryId: "c-household",
      });
    });

    it("deletes the category through the confirm dialog and toasts an undoable confirmation", async () => {
      const user = userEvent.setup();
      setup();
      await openDeleteConfirm(user);
      await user.click(await screen.findByRole("button", { name: /^delete$/i }));

      expect(bulkDeleteCategoriesWithSnapshot).toHaveBeenCalledWith({
        categoryIds: [CATEGORY_ID],
        groupIds: [],
        reassignToCategoryId: null,
      });
      expect(await screen.findByRole("status")).toHaveTextContent(/deleted "groceries"/i);
      expect(await screen.findByRole("button", { name: /undo/i })).toBeInTheDocument();
    });

    it("does not register the undo entry until the delete resolves", async () => {
      const user = userEvent.setup();
      const pending = deferred<unknown>();
      vi.mocked(bulkDeleteCategoriesWithSnapshot).mockReturnValue(pending.promise as never);

      const { onMutate } = setup();
      await openDeleteConfirm(user);
      await user.click(await screen.findByRole("button", { name: /^delete$/i }));

      expect(onMutate).not.toHaveBeenCalled();

      await act(async () => {
        pending.resolve({});
        await pending.promise;
      });
      expect(onMutate).toHaveBeenCalledTimes(1);
    });

    it("tells the user and registers no undo entry when the delete rejects", async () => {
      const user = userEvent.setup();
      vi.mocked(bulkDeleteCategoriesWithSnapshot).mockRejectedValue(new Error("fk violation"));

      const { onMutate } = setup();
      await openDeleteConfirm(user);
      await user.click(await screen.findByRole("button", { name: /^delete$/i }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /couldn't delete "groceries"/i
      );
      expect(onMutate).not.toHaveBeenCalled();
    });
  });

  describe("Move up / Move down", () => {
    it("reorders and registers the undo entry only after the reorder resolves", async () => {
      const user = userEvent.setup();
      const pending = deferred<void>();
      vi.mocked(reorderCategory).mockReturnValue(pending.promise);

      const { onMutate } = setup();
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: /move down/i }));

      expect(reorderCategory).toHaveBeenCalledWith(CATEGORY_ID, GROUP_ID, "down");
      // A push here, before the write is confirmed, is the exact regression
      // called out in the component's comment: a failed move would still
      // leave an undo entry whose backward() reorders from wherever the row
      // actually ended up, not where the entry thinks it started.
      expect(onMutate).not.toHaveBeenCalled();

      await act(async () => {
        pending.resolve();
        await pending.promise;
      });
      expect(onMutate).toHaveBeenCalledTimes(1);
    });

    it("toasts an error and registers no undo entry when the reorder rejects", async () => {
      const user = userEvent.setup();
      vi.mocked(reorderCategory).mockRejectedValue(new Error("gone"));

      const { onMutate } = setup();
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: /move up/i }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /couldn't move "groceries"/i
      );
      expect(onMutate).not.toHaveBeenCalled();
    });
  });
});
