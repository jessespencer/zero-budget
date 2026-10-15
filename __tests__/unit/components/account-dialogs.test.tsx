import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { renderWithProviders } from "@/__tests__/setup/render";
import { makeAccount } from "@/__tests__/setup/fixtures";
import { AddAccountDialog } from "@/components/accounts/add-account-dialog";
import { EditAccountDialog } from "@/components/accounts/edit-account-dialog";

// Both dialogs used to await their server action bare, with no catch — a
// rejection just vanished, leaving the "Creating…"/"Saving…" label reverted
// and nothing else on screen to tell the user the write never landed. This
// tier asks "did the call site notice the rejection and do something about
// it", not "did the database end up right" (that's account-actions.test.ts).
vi.mock("@/app/(app)/accounts/[id]/actions", () => ({
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
}));
import {
  createAccount,
  updateAccount,
} from "@/app/(app)/accounts/[id]/actions";

beforeEach(() => {
  vi.mocked(createAccount).mockReset();
  vi.mocked(updateAccount).mockReset();
  vi.mocked(useRouter).mockReset();
});

describe("AddAccountDialog", () => {
  function setup(options?: { hidden?: boolean }) {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push,
      back: vi.fn(),
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    const onOpenChange = vi.fn();
    const result = renderWithProviders(
      <AddAccountDialog open onOpenChange={onOpenChange} />,
      { amountsHidden: options?.hidden ?? false }
    );
    return { push, onOpenChange, ...result };
  }

  const nameInput = () => screen.getByLabelText(/account name/i);
  const saveButton = () => screen.getByRole("button", { name: /create account/i });

  it("routes to the new account once the server confirms creation", async () => {
    const user = userEvent.setup();
    vi.mocked(createAccount).mockResolvedValue("acct-new-1");
    const { push } = setup();

    await user.type(nameInput(), "Chase checking");
    await user.click(saveButton());

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith("/accounts/acct-new-1");
  });

  it("shows the error and leaves the typed name in place when the server rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(createAccount).mockRejectedValue(new Error("db is gone"));
    const { push } = setup();

    await user.type(nameInput(), "Chase checking");
    await user.click(saveButton());

    expect(await screen.findByText(/db is gone/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    // A throw used to leave "Creating…" reverting with nothing else on
    // screen — the same as a no-op — so the form must not reset either;
    // otherwise a failure is indistinguishable from success at a glance.
    expect(nameInput()).toHaveValue("Chase checking");
  });

  it("privacy mode: the save control is locked and creates nothing", async () => {
    const user = userEvent.setup();
    setup({ hidden: true });

    await user.type(nameInput(), "Chase checking");
    expect(saveButton()).toBeDisabled();

    await user.click(saveButton());
    expect(createAccount).not.toHaveBeenCalled();
  });
});

describe("EditAccountDialog", () => {
  const account = makeAccount({
    id: "acct-1",
    name: "Everyday checking",
    type: "checking",
  });

  function setup() {
    const onOpenChange = vi.fn();
    const result = renderWithProviders(
      <EditAccountDialog open onOpenChange={onOpenChange} account={account} />
    );
    return { onOpenChange, ...result };
  }

  const nameInput = () => screen.getByLabelText(/account name/i);
  const saveButton = () => screen.getByRole("button", { name: /^save$/i });

  it("closes exactly once when the save succeeds", async () => {
    const user = userEvent.setup();
    vi.mocked(updateAccount).mockResolvedValue(undefined);
    const { onOpenChange } = setup();

    await user.clear(nameInput());
    await user.type(nameInput(), "Renamed checking");
    await user.click(saveButton());

    expect(updateAccount).toHaveBeenCalledWith("acct-1", { name: "Renamed checking" });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open and shows the error when the server rejects — does not strand the user on a silent failure", async () => {
    const user = userEvent.setup();
    vi.mocked(updateAccount).mockRejectedValue(new Error("db is gone"));
    const { onOpenChange } = setup();

    await user.clear(nameInput());
    await user.type(nameInput(), "Renamed checking");
    await user.click(saveButton());

    expect(await screen.findByText(/db is gone/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes without calling the server when nothing changed", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = setup();

    await user.click(saveButton());

    expect(updateAccount).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
