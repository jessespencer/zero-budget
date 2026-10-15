import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter, useSearchParams } from "next/navigation";
import { renderWithProviders } from "@/__tests__/setup/render";
import { BudgetTable } from "@/components/budget/budget-table";
import { BUDGET_VIEW_COOKIE, BUDGET_OVERVIEW_COOKIE } from "@/components/budget/budget-view";
import { CHECKED_ROW_CLASS, OPEN_ROW_CLASS } from "@/lib/row-classes";
import { requestAddCategoryGroup } from "@/components/budget/add-group-request";
import type { Account, BudgetMonth, CategoryWithBudget, CategoryGroupWithCategories } from "@/lib/types";

// Call-site tier. Server actions are mocked (the DB round-trip lives in the
// action tests). Every "use server" module reachable from BudgetTable's tree
// needs a stub, or the import fails at module load.

// SortableJS needs real layout and pointer events, which happy-dom can't give
// it. Stubbing `create` keeps the options (including `onEnd`) so a test can
// play the drop event by hand and assert on what the component does with it.
type SortableOptions = {
  handle?: string;
  group?: string;
  onEnd?: (evt: unknown) => void;
};
const sortables = vi.hoisted(() => ({
  instances: [] as { node: HTMLElement; options: SortableOptions }[],
}));
vi.mock("sortablejs", () => ({
  default: {
    create: vi.fn((node: HTMLElement, options: SortableOptions) => {
      sortables.instances.push({ node, options });
      return { destroy: vi.fn() };
    }),
  },
}));

vi.mock("@/app/(app)/budget/actions", () => ({
  addCategoryGroup: vi.fn(),
  addCategory: vi.fn(),
  deleteCategory: vi.fn(),
  deleteCategoryGroup: vi.fn(),
  renameCategoryGroup: vi.fn(),
  bulkDeleteCategoriesWithSnapshot: vi.fn(),
  bulkUpdateCategorySettings: vi.fn(),
  bulkUpdateCategorySettingsWithSnapshot: vi.fn(),
  getCategoryDeletionImpact: vi.fn(),
  moveCategoryToGroup: vi.fn(),
  reorderCategoriesInGroup: vi.fn(),
  reorderCategoryGroups: vi.fn(),
  restoreCategorySettingsBatch: vi.fn(),
  restoreCategoryDeletionSnapshot: vi.fn(),
  unarchiveCategoryWithSnapshot: vi.fn(),
  restoreUnarchiveCategorySnapshot: vi.fn(),
  unarchiveGroupWithSnapshot: vi.fn(),
  restoreUnarchiveGroupSnapshot: vi.fn(),
  // Children
  updateAssigned: vi.fn(() => Promise.resolve()),
  updateExpectedIncome: vi.fn(() => Promise.resolve()),
  copyLastMonthBudgetWithSnapshot: vi.fn(),
  fundUnderfundedWithSnapshot: vi.fn(),
  restoreAssignedSnapshot: vi.fn(() => Promise.resolve()),
  getFundUnderfundedPreview: vi.fn(() => Promise.resolve([])),
  updateCategoryNotesWithSnapshot: vi.fn(),
  restoreCategoryNotes: vi.fn(() => Promise.resolve()),
  createTarget: vi.fn(),
  updateTarget: vi.fn(),
  deleteTargetWithSnapshot: vi.fn(),
  restoreTarget: vi.fn(),
  setCategoryAssignedWithSnapshot: vi.fn(),
  renameCategory: vi.fn(),
  archiveCategoryWithSnapshot: vi.fn(),
  archiveGroupWithSnapshot: vi.fn(),
}));
vi.mock("@/app/(app)/transactions/actions", () => ({
  getTransactions: vi.fn(() => Promise.resolve([])),
  getAccountsAndCategories: vi.fn(() =>
    Promise.resolve({ accounts: [], categories: [], categoryGroups: [] })
  ),
  getPayees: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/app/(app)/accounts/[id]/actions", () => ({}));

import {
  moveCategoryToGroup,
  reorderCategoriesInGroup,
  reorderCategoryGroups,
} from "@/app/(app)/budget/actions";

const MONTH = "2026-07-01";

function makeCat(id: string, name: string, groupId: string, sort: number): CategoryWithBudget {
  return {
    id,
    category_group_id: groupId,
    user_id: "u1",
    name,
    sort_order: sort,
    archived: false,
    allocation_account_id: null,
    is_buffer: false,
    pinned_quick: false,
    notes: "",
    created_at: "",
    updated_at: "",
    assigned: 100,
    activity: -20,
    available: 80,
    cumulative_assigned: 100,
    target: null,
    autoAssign: { assignedLastMonth: 0, spentLastMonth: 0, averageAssigned: 0, averageSpent: 0 },
  };
}

function makeGroup(
  id: string,
  name: string,
  categories: CategoryWithBudget[]
): CategoryGroupWithCategories {
  return {
    id,
    user_id: "u1",
    name,
    sort_order: 0,
    archived: false,
    is_income: false,
    is_system: false,
    created_at: "",
    updated_at: "",
    categories,
    groupAssigned: 0,
    groupActivity: 0,
    groupAvailable: 0,
  };
}

function makeBudget(groups: CategoryGroupWithCategories[] = defaultGroups()): BudgetMonth {
  return {
    month: MONTH,
    readyToAssign: 0,
    groups,
    hiddenCategories: [],
    hiddenGroups: [],
    totalIncome: 0,
    totalAssigned: 0,
    overspentLastMonth: 0,
    currentMonthIncome: 0,
    currentMonthAssigned: 0,
    expectedIncome: null,
    openingCcDebt: 0,
    futureAssigned: 0,
  };
}

function defaultGroups(): CategoryGroupWithCategories[] {
  return [
    makeGroup("g-everyday", "Everyday", [
      makeCat("c-groceries", "Groceries", "g-everyday", 0),
      makeCat("c-gas", "Gas", "g-everyday", 1),
    ]),
    makeGroup("g-bills", "Bills", [makeCat("c-rent", "Rent", "g-bills", 0)]),
  ];
}

// --- environment ------------------------------------------------------------

const replace = vi.fn();

function stubViewport(narrow: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: narrow,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function clearCookies() {
  for (const name of [BUDGET_VIEW_COOKIE, BUDGET_OVERVIEW_COOKIE]) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
}

beforeEach(() => {
  replace.mockReset();
  vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>
  );
  stubViewport(false);
  clearCookies();
  window.localStorage.clear();
  sortables.instances.length = 0;
  vi.mocked(moveCategoryToGroup).mockReset();
  vi.mocked(reorderCategoriesInGroup).mockReset().mockResolvedValue(undefined);
  vi.mocked(reorderCategoryGroups).mockReset().mockResolvedValue(undefined);
});

afterEach(() => clearCookies());

function setup(
  props: Partial<Parameters<typeof BudgetTable>[0]> = {},
  accounts: Account[] = []
) {
  return renderWithProviders(
    <BudgetTable
      budget={makeBudget()}
      accounts={accounts}
      initialView="grid"
      initialOverviewDocked
      {...props}
    />
  );
}

// --- helpers ----------------------------------------------------------------

function gridRow(name: string): HTMLElement {
  const table = screen.getByRole("table", { name: "Budget categories" });
  const row = within(table).getByRole("rowheader", { name }).closest<HTMLElement>('[role="row"]');
  if (!row) throw new Error(`no grid row for ${name}`);
  return row;
}

/** The simple view's cards are <section>s; the grid's groups are role=rowgroup. */
function simpleView(container: HTMLElement): HTMLElement {
  const first = container.querySelector<HTMLElement>("section[data-budget-group]");
  if (!first?.parentElement) throw new Error("simple view not rendered");
  return first.parentElement;
}

function simpleRow(container: HTMLElement, name: string): HTMLElement {
  return within(simpleView(container)).getByRole("button", { name: new RegExp(name) });
}

function hasAllClasses(el: HTMLElement, classString: string): boolean {
  const have = new Set(el.className.split(/\s+/));
  return classString.split(/\s+/).every((c) => have.has(c));
}
const isOpenRow = (el: HTMLElement) => hasAllClasses(el, OPEN_ROW_CLASS);
const isCheckedRow = (el: HTMLElement) => hasAllClasses(el, CHECKED_ROW_CLASS);

// --- view toggle ------------------------------------------------------------

describe("BudgetTable view toggle", () => {
  it("renders the grid with column headers when the initial view is grid", () => {
    setup({ initialView: "grid" });
    const table = screen.getByRole("table", { name: "Budget categories" });
    expect(within(table).getByRole("columnheader", { name: "Assigned" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Grid" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Simple" })).toHaveAttribute("aria-checked", "false");
  });

  it("renders only the simple cards, with no grid, when the initial view is simple", () => {
    const { container } = setup({ initialView: "simple" });
    expect(screen.queryByRole("table", { name: "Budget categories" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Assigned" })).not.toBeInTheDocument();
    expect(within(simpleView(container)).getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Simple" })).toHaveAttribute("aria-checked", "true");
  });

  it("switches from grid to simple and back, and remembers the choice in a cookie", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("radio", { name: "Simple" }));
    expect(screen.queryByRole("table", { name: "Budget categories" })).not.toBeInTheDocument();
    expect(document.cookie).toContain(`${BUDGET_VIEW_COOKIE}=simple`);

    await user.click(screen.getByRole("radio", { name: "Grid" }));
    expect(screen.getByRole("table", { name: "Budget categories" })).toBeInTheDocument();
    expect(document.cookie).toContain(`${BUDGET_VIEW_COOKIE}=grid`);
  });

  it("hides the 'Category group' button in simple view since that view can't add groups", () => {
    setup({ initialView: "simple" });
    // Hidden via display:none class; the class is the only signal in jsdom.
    expect(screen.getByRole("button", { name: /category group/i }).className).toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("keeps the grid region for the empty state even in simple view", () => {
    setup({ initialView: "simple", budget: makeBudget([]) });
    expect(screen.getByText(/create your first category group/i)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Budget categories" })).toBeInTheDocument();
  });

  it("shares expanded state between views: collapsing a simple card hides its categories", async () => {
    const user = userEvent.setup();
    const { container } = setup({ initialView: "simple" });
    const card = within(simpleView(container));
    expect(card.getByText("Rent")).toBeInTheDocument();

    await user.click(card.getByRole("button", { name: /Bills/ }));
    expect(card.queryByText("Rent")).not.toBeInTheDocument();
    expect(card.getByText("Groceries")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Grid" }));
    const table = screen.getByRole("table", { name: "Budget categories" });
    expect(within(table).getByRole("button", { name: "Toggle Bills group" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});

// --- side panel: open row ---------------------------------------------------

describe("BudgetTable add-group requests", () => {
  it("opens its add-group dialog when another part of the page asks", () => {
    setup();
    expect(screen.queryByRole("dialog", { name: "Add category group" })).not.toBeInTheDocument();
    act(() => requestAddCategoryGroup());
    expect(screen.getByRole("dialog", { name: "Add category group" })).toBeInTheDocument();
  });
});

describe("BudgetTable side panel and open row (grid)", () => {
  it("shows the overview in the docked column by default and no category detail", () => {
    setup();
    expect(screen.getByRole("button", { name: "Hide side panel" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByRole("button", { name: "Close panel" })).not.toBeInTheDocument();
  });

  it("opens a clicked category in the side panel and marks only that row open", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(within(gridRow("Groceries")).getByText("Groceries"));

    expect(await screen.findByRole("button", { name: "Close panel" })).toBeInTheDocument();
    expect(gridRow("Groceries")).toHaveAttribute("aria-current", "true");
    expect(isOpenRow(gridRow("Groceries"))).toBe(true);
    expect(gridRow("Gas")).not.toHaveAttribute("aria-current");
    expect(isOpenRow(gridRow("Gas"))).toBe(false);
  });

  it("swaps the open row when another category is clicked", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(within(gridRow("Groceries")).getByText("Groceries"));
    await user.click(within(gridRow("Rent")).getByText("Rent"));

    expect(isOpenRow(gridRow("Rent"))).toBe(true);
    expect(isOpenRow(gridRow("Groceries"))).toBe(false);
    expect(gridRow("Groceries")).not.toHaveAttribute("aria-current");
    // Still exactly one detail panel.
    expect(screen.getAllByRole("button", { name: "Close panel" })).toHaveLength(1);
  });

  it("clears the open row when the panel's close button is clicked", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(within(gridRow("Groceries")).getByText("Groceries"));
    await user.click(await screen.findByRole("button", { name: "Close panel" }));

    expect(gridRow("Groceries")).not.toHaveAttribute("aria-current");
    expect(isOpenRow(gridRow("Groceries"))).toBe(false);
    expect(screen.queryByRole("button", { name: "Close panel" })).not.toBeInTheDocument();
  });

  it("clears the open row when Escape is pressed on the page", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(within(gridRow("Groceries")).getByText("Groceries"));
    expect(isOpenRow(gridRow("Groceries"))).toBe(true);
    await user.keyboard("{Escape}");

    expect(isOpenRow(gridRow("Groceries"))).toBe(false);
  });

  it("writes the open category to ?category= with router.replace, and removes it on close", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(within(gridRow("Groceries")).getByText("Groceries"));
    expect(replace).toHaveBeenLastCalledWith("/?category=c-groceries", { scroll: false });

    await user.click(await screen.findByRole("button", { name: "Close panel" }));
    expect(replace).toHaveBeenLastCalledWith("/", { scroll: false });
  });

  it("opens the category named in ?category= on first render", () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("category=c-gas") as unknown as ReturnType<typeof useSearchParams>
    );
    setup();
    expect(isOpenRow(gridRow("Gas"))).toBe(true);
  });

  it("strips an unknown ?category= id from the URL instead of opening anything", () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("category=deleted-long-ago&month=2026-07-01") as unknown as ReturnType<
        typeof useSearchParams
      >
    );
    setup();
    expect(replace).toHaveBeenCalledWith("/?month=2026-07-01", { scroll: false });
    expect(screen.queryByRole("button", { name: "Close panel" })).not.toBeInTheDocument();
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });

  it("collapses the docked column when the Overview button is pressed while a category is open", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(within(gridRow("Groceries")).getByText("Groceries"));

    await user.click(screen.getByRole("button", { name: "Hide side panel" }));

    expect(isOpenRow(gridRow("Groceries"))).toBe(false);
    expect(screen.getByRole("button", { name: "Show overview panel" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(document.cookie).toContain(`${BUDGET_OVERVIEW_COOKIE}=hidden`);
  });

  it("still docks the column for an open category when the overview was hidden", async () => {
    const user = userEvent.setup();
    setup({ initialOverviewDocked: false });
    expect(screen.getByRole("button", { name: "Show overview panel" })).toBeInTheDocument();

    await user.click(within(gridRow("Groceries")).getByText("Groceries"));

    expect(await screen.findByRole("button", { name: "Close panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide side panel" })).toBeInTheDocument();
  });
});

describe("BudgetTable side panel and open row (simple view)", () => {
  it("marks the clicked simple row as open and moves the mark when another is clicked", async () => {
    const user = userEvent.setup();
    const { container } = setup({ initialView: "simple" });

    await user.click(simpleRow(container, "Groceries"));
    expect(simpleRow(container, "Groceries")).toHaveAttribute("aria-current", "true");
    expect(isOpenRow(simpleRow(container, "Groceries"))).toBe(true);
    expect(await screen.findByRole("button", { name: "Close panel" })).toBeInTheDocument();

    await user.click(simpleRow(container, "Rent"));
    expect(isOpenRow(simpleRow(container, "Rent"))).toBe(true);
    expect(isOpenRow(simpleRow(container, "Groceries"))).toBe(false);

    await user.click(await screen.findByRole("button", { name: "Close panel" }));
    expect(isOpenRow(simpleRow(container, "Rent"))).toBe(false);
  });

  it("carries the open category across a view switch", async () => {
    const user = userEvent.setup();
    const { container } = setup({ initialView: "simple" });
    await user.click(simpleRow(container, "Gas"));

    await user.click(screen.getByRole("radio", { name: "Grid" }));

    expect(isOpenRow(gridRow("Gas"))).toBe(true);
  });
});

// --- narrow viewport: drawer + assign cell (4e23e96) -------------------------

describe("BudgetTable drawer below 1400px", () => {
  it("opens the detail drawer when a category name is clicked", async () => {
    stubViewport(true);
    const user = userEvent.setup();
    setup();

    await user.click(within(gridRow("Groceries")).getByText("Groceries"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(isOpenRow(gridRow("Groceries"))).toBe(true);
  });

  it("does NOT open the drawer when an assign cell is clicked, but still selects the row", async () => {
    stubViewport(true);
    const user = userEvent.setup();
    setup();

    // The assign cell is the row's only <button> showing the assigned amount.
    const assign = within(gridRow("Groceries")).getByRole("button", { name: "$100.00" });
    await user.click(assign);

    // The inline editor is up, and nothing has stolen focus into a drawer.
    const input = within(gridRow("Groceries")).getByRole("spinbutton");
    expect(input).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The row is still the selected category (URL + open mark).
    expect(replace).toHaveBeenLastCalledWith("/?category=c-groceries", { scroll: false });
    expect(isOpenRow(gridRow("Groceries"))).toBe(true);
  });

  it("opens the drawer on a later name click even after an assign-cell click selected the row", async () => {
    stubViewport(true);
    const user = userEvent.setup();
    setup();

    await user.click(within(gridRow("Groceries")).getByRole("button", { name: "$100.00" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(within(gridRow("Groceries")).getByText("Groceries"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("clears the open row and closes the drawer from the detail panel's close button", async () => {
    stubViewport(true);
    const user = userEvent.setup();
    setup();
    await user.click(within(gridRow("Groceries")).getByText("Groceries"));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Close panel" }));

    await waitFor(() => expect(isOpenRow(gridRow("Groceries"))).toBe(false));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

// --- bulk selection ---------------------------------------------------------

describe("BudgetTable bulk selection row state", () => {
  it("applies the checked treatment to a ticked row without opening it", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("checkbox", { name: "Select Groceries" }));

    expect(isCheckedRow(gridRow("Groceries"))).toBe(true);
    expect(isOpenRow(gridRow("Groceries"))).toBe(false);
    expect(gridRow("Groceries")).not.toHaveAttribute("aria-current");
    // Ticking a box is not a click on the row: no detail panel.
    expect(screen.queryByRole("button", { name: "Close panel" })).not.toBeInTheDocument();
    expect(isCheckedRow(gridRow("Gas"))).toBe(false);
  });

  it("shows the bulk toolbar with a count and hides it again when cleared", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("checkbox", { name: "Select Groceries" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Gas" }));
    expect(screen.getByRole("button", { name: /2 selected/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /2 selected/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /2 selected/ })).not.toBeInTheDocument());
    expect(isCheckedRow(gridRow("Groceries"))).toBe(false);
    expect(isCheckedRow(gridRow("Gas"))).toBe(false);
  });

  it("lets the open treatment win when a row is both open and ticked", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("checkbox", { name: "Select Groceries" }));
    await user.click(within(gridRow("Groceries")).getByText("Groceries"));

    const row = gridRow("Groceries");
    expect(isOpenRow(row)).toBe(true);
    expect(isCheckedRow(row)).toBe(false);
    // The tick itself is preserved underneath.
    expect(screen.getByRole("checkbox", { name: "Select Groceries" })).toBeChecked();
  });

  it("falls back to the checked treatment when the open row is closed while still ticked", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("checkbox", { name: "Select Groceries" }));
    await user.click(within(gridRow("Groceries")).getByText("Groceries"));

    await user.click(await screen.findByRole("button", { name: "Close panel" }));

    expect(isOpenRow(gridRow("Groceries"))).toBe(false);
    expect(isCheckedRow(gridRow("Groceries"))).toBe(true);
  });

  it("select-all in the column header ticks every visible row", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("checkbox", { name: "Select all categories" }));

    for (const name of ["Groceries", "Gas", "Rent"]) {
      expect(isCheckedRow(gridRow(name))).toBe(true);
    }
    expect(screen.getByRole("button", { name: /3 selected/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Deselect all categories" })).toBeChecked();
  });

  it("shift-click ticks the range within a group", async () => {
    const user = userEvent.setup();
    const groups = [
      makeGroup("g", "Everyday", [
        makeCat("a", "Alpha", "g", 0),
        makeCat("b", "Bravo", "g", 1),
        makeCat("c", "Charlie", "g", 2),
      ]),
    ];
    setup({ budget: makeBudget(groups) });

    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select Charlie" }));
    await user.keyboard("{/Shift}");

    expect(isCheckedRow(gridRow("Bravo"))).toBe(true);
    expect(screen.getByRole("button", { name: /3 selected/ })).toBeInTheDocument();
  });
});

// --- drag and drop (optimistic client half) ---------------------------------

type DropEvent = {
  item: HTMLElement;
  from: HTMLElement;
  to: HTMLElement;
  oldIndex: number;
  newIndex: number;
};

/** The per-group category sortables are the ones created with a shared `group`. */
function categorySortables() {
  return sortables.instances.filter((s) => s.options.group === "budget-categories");
}
function groupSortable() {
  const found = sortables.instances.find((s) => s.options.handle === "[data-group-handle]");
  if (!found) throw new Error("group sortable not created");
  return found;
}

/**
 * Play a drop. Sortable has already moved the DOM node by the time onEnd fires
 * and the component puts it back, so mimic that: the item sits in `to` at
 * `newIndex`.
 */
function dropCategory(fromGroupId: string, toGroupId: string, itemId: string, oldIndex: number, newIndex: number) {
  const containers = categorySortables().map((s) => s.node);
  const from = containers.find((n) => n.dataset.groupId === fromGroupId);
  const to = containers.find((n) => n.dataset.groupId === toGroupId);
  const item = from?.querySelector<HTMLElement>(`[data-id="${itemId}"]`);
  const owner = categorySortables().find((s) => s.node === from);
  if (!from || !to || !item || !owner) throw new Error("drop fixtures missing");
  // Sortable has already moved the node by the time onEnd fires.
  if (from !== to) to.insertBefore(item, to.children[newIndex] ?? null);
  const evt: DropEvent = { item, from, to, oldIndex, newIndex };
  return act(async () => {
    owner.options.onEnd?.(evt);
  });
}

function rowOrder(groupName: string): string[] {
  const group = screen.getByRole("rowgroup", { name: groupName });
  return within(group)
    .getAllByRole("rowheader")
    .map((h) => h.getAttribute("aria-label") ?? "")
    .filter((n) => n !== groupName);
}

describe("BudgetTable drag and drop", () => {
  it("reorders a category within its group optimistically and persists the new order", async () => {
    setup();
    await dropCategory("g-everyday", "g-everyday", "c-groceries", 0, 1);

    expect(rowOrder("Everyday")).toEqual(["Gas", "Groceries"]);
    expect(reorderCategoriesInGroup).toHaveBeenCalledWith("g-everyday", ["c-gas", "c-groceries"]);
  });

  it("rolls the order back and toasts when the within-group reorder is rejected", async () => {
    vi.mocked(reorderCategoriesInGroup).mockRejectedValue(new Error("db down"));
    setup();
    await dropCategory("g-everyday", "g-everyday", "c-groceries", 0, 1);

    await waitFor(() => expect(rowOrder("Everyday")).toEqual(["Groceries", "Gas"]));
    expect(await screen.findByRole("status")).toHaveTextContent(/couldn't move "Groceries"/i);
  });

  it("does nothing when a category is dropped back where it started", async () => {
    setup();
    await dropCategory("g-everyday", "g-everyday", "c-groceries", 0, 0);

    expect(reorderCategoriesInGroup).not.toHaveBeenCalled();
    expect(rowOrder("Everyday")).toEqual(["Groceries", "Gas"]);
  });

  it("moves a category across groups optimistically, then moves and positions it on the server", async () => {
    vi.mocked(moveCategoryToGroup).mockResolvedValue({ oldGroupId: "g-everyday", oldSortOrder: 0 });
    setup();
    await dropCategory("g-everyday", "g-bills", "c-groceries", 0, 0);

    expect(rowOrder("Everyday")).toEqual(["Gas"]);
    expect(rowOrder("Bills")).toEqual(["Groceries", "Rent"]);
    await waitFor(() => expect(moveCategoryToGroup).toHaveBeenCalledWith("c-groceries", "g-bills"));
    await waitFor(() =>
      expect(reorderCategoriesInGroup).toHaveBeenCalledWith("g-bills", ["c-groceries", "c-rent"])
    );
  });

  it("reverts a cross-group move and toasts when the move itself fails", async () => {
    vi.mocked(moveCategoryToGroup).mockRejectedValue(new Error("db down"));
    setup();
    await dropCategory("g-everyday", "g-bills", "c-groceries", 0, 0);

    await waitFor(() => expect(rowOrder("Everyday")).toEqual(["Groceries", "Gas"]));
    expect(rowOrder("Bills")).toEqual(["Rent"]);
    expect(reorderCategoriesInGroup).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(/couldn't move "Groceries"/i);
  });

  it("keeps the row in its new group, and says so, when only the reposition fails", async () => {
    vi.mocked(moveCategoryToGroup).mockResolvedValue({ oldGroupId: "g-everyday", oldSortOrder: 0 });
    vi.mocked(reorderCategoriesInGroup).mockRejectedValue(new Error("db down"));
    setup();
    await dropCategory("g-everyday", "g-bills", "c-groceries", 0, 0);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /moved "Groceries", but couldn't set its position/i
    );
    expect(rowOrder("Bills")).toEqual(["Groceries", "Rent"]);
    expect(rowOrder("Everyday")).toEqual(["Gas"]);
  });

  it("reorders groups optimistically and persists the new group order", async () => {
    setup();
    const { options, node } = groupSortable();
    const item = node.children[0] as HTMLElement;
    await act(async () => {
      options.onEnd?.({ item, from: node, oldIndex: 0, newIndex: 1 });
    });

    const names = screen
      .getAllByRole("rowgroup")
      .map((g) => g.getAttribute("aria-label"));
    expect(names).toEqual(["Bills", "Everyday"]);
    expect(reorderCategoryGroups).toHaveBeenCalledWith(["g-bills", "g-everyday"]);
  });

  it("restores the group order and toasts when the group reorder is rejected", async () => {
    vi.mocked(reorderCategoryGroups).mockRejectedValue(new Error("db down"));
    setup();
    const { options, node } = groupSortable();
    const item = node.children[0] as HTMLElement;
    await act(async () => {
      options.onEnd?.({ item, from: node, oldIndex: 0, newIndex: 1 });
    });

    await waitFor(() =>
      expect(screen.getAllByRole("rowgroup").map((g) => g.getAttribute("aria-label"))).toEqual([
        "Everyday",
        "Bills",
      ])
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/couldn't reorder the groups/i);
  });
});
