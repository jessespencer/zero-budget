import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, deferred } from "@/__tests__/setup/render";
import { CategoryDetailPanel } from "@/components/budget/category-detail-panel";
import type { CategoryWithBudget } from "@/lib/types";
import type { MutationEntry } from "@/lib/use-undo-redo";

// getTransactions is mocked to resolve empty so the panel's Transactions tab
// (fetched on mount) never becomes the thing under test here.
vi.mock("@/app/(app)/transactions/actions", () => ({
  getTransactions: vi.fn(() => Promise.resolve([])),
  getAccountsAndCategories: vi.fn(() =>
    Promise.resolve({ accounts: [], categories: [], categoryGroups: [] })
  ),
  getPayees: vi.fn(() => Promise.resolve([])),
}));

// TargetSection and CategoryAutoAssignSection (rendered on the Goals tab,
// which mounts first) import their own actions from this same module — they
// are stubbed here even though the notes tests never trigger them, so the
// child components don't blow up on an undefined import.
vi.mock("@/app/(app)/budget/actions", () => ({
  updateCategoryNotesWithSnapshot: vi.fn(),
  restoreCategoryNotes: vi.fn(() => Promise.resolve()),
  createTarget: vi.fn(),
  updateTarget: vi.fn(),
  deleteTargetWithSnapshot: vi.fn(),
  restoreTarget: vi.fn(),
  updateAssigned: vi.fn(),
  setCategoryAssignedWithSnapshot: vi.fn(),
}));
import {
  updateCategoryNotesWithSnapshot,
  restoreCategoryNotes,
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
    notes: "Original note",
    created_at: "",
    updated_at: "",
    assigned: 100,
    activity: -20,
    available: 80,
    cumulative_assigned: 100,
    target: null,
    autoAssign: {
      assignedLastMonth: 0,
      spentLastMonth: 0,
      averageAssigned: 0,
      averageSpent: 0,
    },
    ...overrides,
  };
}

function setup(props: Partial<Parameters<typeof CategoryDetailPanel>[0]> = {}) {
  const onMutate = vi.fn((_entry: MutationEntry) => "mutation-1");
  const undoEntry = vi.fn();
  const category = props.category ?? makeCategory();
  const result = renderWithProviders(
    <CategoryDetailPanel
      category={category}
      groupName="Everyday"
      month={MONTH}
      onClose={() => {}}
      onMutate={onMutate}
      undoEntry={undoEntry}
      {...props}
    />
  );
  return { onMutate, undoEntry, category, ...result };
}

async function openNotesTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: /notes/i }));
  return screen.findByPlaceholderText(/add a description/i);
}

beforeEach(() => {
  vi.mocked(updateCategoryNotesWithSnapshot)
    .mockReset()
    .mockResolvedValue({ previous: "Original note" });
  vi.mocked(restoreCategoryNotes).mockReset().mockResolvedValue(undefined);
});

describe("CategoryDetailPanel notes", () => {
  it("saves the trimmed text on blur", async () => {
    const user = userEvent.setup();
    setup();
    const textarea = await openNotesTab(user);

    await user.clear(textarea);
    await user.type(textarea, "  New note  ");
    await act(async () => {
      textarea.blur();
    });

    expect(updateCategoryNotesWithSnapshot).toHaveBeenCalledWith(CATEGORY_ID, "New note");
  });

  it("makes no server call when the text did not change", async () => {
    const user = userEvent.setup();
    const { onMutate } = setup();
    const textarea = await openNotesTab(user);

    // Focus and blur without typing anything — the classic "clicked into the
    // field, changed their mind" case.
    await user.click(textarea);
    await act(async () => {
      textarea.blur();
    });

    expect(updateCategoryNotesWithSnapshot).not.toHaveBeenCalled();
    expect(onMutate).not.toHaveBeenCalled();
  });

  // The important one: undo must restore whatever the server says it actually
  // replaced, not whatever `category.notes` happened to hold when the blur
  // handler closed over it. That prop goes stale the instant anything else
  // touches this category (another edit, a route revalidation) before Cmd+Z
  // fires.
  it("undo restores the value the server returned, not the stale category prop", async () => {
    const user = userEvent.setup();
    vi.mocked(updateCategoryNotesWithSnapshot).mockResolvedValue({
      previous: "server-side text",
    });
    // The prop the component was rendered with deliberately disagrees with
    // what the mocked server says it replaced.
    const { onMutate } = setup({ category: makeCategory({ notes: "prop-stale-text" }) });
    const textarea = await openNotesTab(user);

    await user.clear(textarea);
    await user.type(textarea, "New note");
    await act(async () => {
      textarea.blur();
    });

    expect(onMutate).toHaveBeenCalledTimes(1);
    const entry = onMutate.mock.calls[0][0];

    vi.mocked(restoreCategoryNotes).mockClear();
    await entry.backward();
    expect(restoreCategoryNotes).toHaveBeenCalledWith(CATEGORY_ID, "server-side text");
  });

  it("does not register the undo entry until the save resolves", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ previous: string }>();
    vi.mocked(updateCategoryNotesWithSnapshot).mockReturnValue(pending.promise);

    const { onMutate } = setup();
    const textarea = await openNotesTab(user);

    await user.clear(textarea);
    await user.type(textarea, "New note");
    await act(async () => {
      textarea.blur();
    });

    // Still in flight: an entry here would let Cmd+Z target text the database
    // never received.
    expect(onMutate).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ previous: "Original note" });
      await pending.promise;
    });
    expect(onMutate).toHaveBeenCalledTimes(1);
  });

  it("tells the user, registers no undo entry, and reverts the field when the save rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(updateCategoryNotesWithSnapshot).mockRejectedValue(new Error("db is gone"));

    const { onMutate } = setup();
    const textarea = await openNotesTab(user);

    await user.clear(textarea);
    await user.type(textarea, "New note");
    await act(async () => {
      textarea.blur();
    });

    // Unlike an assign cell, the textarea keeps showing whatever was typed
    // whether or not it saved — that's the lie a failed write leaves behind
    // if nothing corrects it.
    expect(await screen.findByRole("status")).toHaveTextContent(/couldn't save your notes/i);
    expect(onMutate).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("Original note");
  });
});
