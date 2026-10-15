import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/__tests__/setup/render";
import { SetupChecklist } from "@/components/budget/setup-checklist";
import type { OnboardingState } from "@/lib/onboarding";
import { onAddCategoryGroupRequest } from "@/components/budget/add-group-request";

const actions = vi.hoisted(() => ({
  addStarterCategories: vi.fn(),
  dismissOnboarding: vi.fn(),
  markOnboardingTransferPlanSeen: vi.fn(),
}));
vi.mock("@/app/(app)/budget/actions", () => actions);
vi.mock("@/app/(app)/accounts/[id]/actions", () => ({
  createAccount: vi.fn(),
  setPrimaryAccount: vi.fn(),
}));

const emptyState: OnboardingState = {
  primaryCandidates: [],
  accountCount: 0,
  primaryAccountName: null,
  hasGroups: false,
  hasCategories: false,
  transferPlanSeen: false,
};

const doneState: OnboardingState = {
  primaryCandidates: [{ id: "a1", name: "Checking" }],
  accountCount: 1,
  primaryAccountName: "Checking",
  hasGroups: true,
  hasCategories: true,
  transferPlanSeen: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SetupChecklist", () => {
  it("starts a fresh install at 0 of 5 with every step to do", () => {
    renderWithProviders(<SetupChecklist state={emptyState} readyToAssign={0} totalIncome={0} />);
    expect(screen.getByRole("heading", { name: "Get Zero set up" })).toBeInTheDocument();
    expect(screen.getByText("0 of 5")).toBeInTheDocument();
    expect(screen.getAllByText("To do:")).toHaveLength(5);
  });

  it("only counts money as assigned once there was money to assign", () => {
    // $0 left with nothing coming in is an empty budget, not a finished one.
    renderWithProviders(<SetupChecklist state={doneState} readyToAssign={0} totalIncome={0} />);
    expect(screen.getByText("4 of 5")).toBeInTheDocument();
  });

  it("switches to a done state when every step is complete", async () => {
    actions.dismissOnboarding.mockResolvedValue(undefined);
    renderWithProviders(<SetupChecklist state={doneState} readyToAssign={0} totalIncome={3000} />);
    expect(screen.getByRole("heading", { name: "You're all set" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(actions.dismissOnboarding).toHaveBeenCalledOnce();
  });

  it("adds the starter set and hides the button once categories exist", async () => {
    actions.addStarterCategories.mockResolvedValue({ ok: true });
    const { rerender } = renderWithProviders(
      <SetupChecklist state={emptyState} readyToAssign={0} totalIncome={0} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Use starter set" }));
    expect(actions.addStarterCategories).toHaveBeenCalledOnce();

    rerender(<SetupChecklist state={{ ...emptyState, hasCategories: true }} readyToAssign={0} totalIncome={0} />);
    expect(screen.queryByRole("button", { name: "Use starter set" })).not.toBeInTheDocument();
  });

  it("toasts when the starter set fails instead of doing nothing", async () => {
    actions.addStarterCategories.mockRejectedValue(new Error("database is locked"));
    renderWithProviders(<SetupChecklist state={emptyState} readyToAssign={0} totalIncome={0} />);
    await userEvent.click(screen.getByRole("button", { name: "Use starter set" }));
    await waitFor(() =>
      expect(screen.getByText("Could not add the starter categories.")).toBeInTheDocument()
    );
  });

  it("opens the budget's add-group dialog instead of ticking the step itself", async () => {
    const opened = vi.fn();
    const stop = onAddCategoryGroupRequest(opened);
    renderWithProviders(<SetupChecklist state={emptyState} readyToAssign={0} totalIncome={0} />);

    await userEvent.click(screen.getByRole("button", { name: "Add category group" }));
    expect(opened).toHaveBeenCalledOnce();
    expect(screen.getByText("0 of 5")).toBeInTheDocument();
    stop();
  });

  it("keeps the step open for an empty group and says what's missing", () => {
    renderWithProviders(
      <SetupChecklist state={{ ...emptyState, hasGroups: true }} readyToAssign={0} totalIncome={0} />
    );
    expect(
      screen.getByText("Now add categories to your group with “Add budget item” under it.")
    ).toBeInTheDocument();
    expect(screen.getByText("0 of 5")).toBeInTheDocument();
  });
});
