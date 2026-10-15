"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Eye, EyeOff, MoreVertical, Pencil, Scale, Star, Trash2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolbarIconButton } from "@/components/shared/toolbar-icon-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { AdjustBalanceDialog } from "./adjust-balance-dialog";
import { EditAccountDialog } from "./edit-account-dialog";
import { ReconcileDialog } from "./reconcile-dialog";
import {
  closeAccountWithSnapshot,
  deleteAccount,
  reopenAccount,
  reopenAccountFromSnapshot,
  setPrimaryAccount,
  setAccountBudgetStatusWithSnapshot,
  undoSetAccountBudgetStatus,
  type AccountCloseSnapshot,
  type AccountRemovalError,
  type SetPrimaryError,
  type BudgetStatusSnapshot,
} from "@/app/(app)/accounts/[id]/actions";
import { useToast } from "@/components/ui/toast";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { useUndoRedo } from "@/lib/use-undo-redo";
import { roundCents } from "@/lib/db-utils";
import type { Account } from "@/lib/types";

type CategoryRow = { id: string; name: string; category_group_id: string };
type CategoryGroupRow = { id: string; name: string; is_income: boolean };

type AccountMenuProps = {
  account: Account;
  /**
   * Total transaction count for this account. Used to tailor the delete
   * confirmation copy. When undefined, a generic warning is shown instead.
   */
  transactionCount?: number;
  /**
   * - `"kebab"`: vertical-dots icon button with a tooltip. Use on page headers.
   * - `"pencil"`: small Pencil trigger styled to live inside the sidebar's
   *   hover-revealed icon slot. Use in the sidebar account list.
   */
  triggerVariant?: "kebab" | "pencil";
  /**
   * Categories + groups for the Reconcile dialog's required category picker.
   * Required when `showReconcile` is true. Filtered against `is_income` so
   * income groups are not offered (reconcile is expense-shaped).
   */
  categories?: CategoryRow[];
  categoryGroups?: CategoryGroupRow[];
  /**
   * Whether the menu shows the "Reconcile" item. Defaults to `true`. The
   * sidebar pencil variant opts out so it doesn't need to thread category
   * data through.
   */
  showReconcile?: boolean;
  /**
   * What Convert would actually move into or out of Ready to assign, from
   * `getStartingBalanceImpact`. Only the kebab variant renders Convert, so
   * only `/accounts/[id]` needs to pass it; the sidebar pencil variant leaves
   * it undefined and the copy falls back to naming the mechanism without a
   * figure. Never pass `account.current_balance` here — that is the bug this
   * prop exists to fix.
   */
  startingBalanceImpact?: number;
};

const REASON_COPY: Record<AccountRemovalError["reason"], string> = {
  not_found: "Account not found.",
  is_primary:
    "This is your primary account — pick a different account as primary first.",
};

const SET_PRIMARY_REASON_COPY: Record<SetPrimaryError["reason"], string> = {
  not_found: "Account not found.",
  archived: "Reopen this account before setting it as primary.",
};

// `deleteAccount` ends in `redirect("/insights")`, which works by throwing.
// Whether that digest reaches the client depends on how the action result is
// transported, so the catch below re-throws it rather than betting either way —
// swallowing it would strand the user on a page for an account that no longer
// exists. Checked by digest instead of importing Next's `isRedirectError`,
// which lives behind a `next/dist/...` internal path.
//
// Close no longer needs this: it returns a snapshot and stays put, because the
// account is still reachable from the sidebar's Closed section.
function isRedirectError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    typeof (e as { digest?: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export function AccountMenu({
  account,
  transactionCount,
  triggerVariant = "kebab",
  categories,
  categoryGroups,
  showReconcile = true,
  startingBalanceImpact,
}: AccountMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { push: pushUndoEntry, undoEntry } = useUndoRedo();
  const { toast } = useToast();

  // The Convert menu item only appears on the kebab variant (page header) and
  // never on credit cards — credit-card tracking is handled via the
  // STARTING_BALANCE_CATEGORY_ID + is_debt machinery and the server action
  // rejects the type explicitly.
  const canConvert =
    triggerVariant === "kebab" && account.type !== "credit_card";
  const isOnBudget = account.is_budget_account;
  const convertLabel = isOnBudget
    ? "Exclude starting balance"
    : "Include starting balance";
  const convertTitle = isOnBudget
    ? `Exclude ${account.name}'s starting balance?`
    : `Include ${account.name}'s starting balance?`;
  // The figure comes from `getStartingBalanceImpact` and nowhere else. It once
  // interpolated `account.current_balance`, which is not the number that moves:
  // the action recategorises the *"Starting balance" transaction*, and those
  // two amounts diverge the moment the account has any activity. The server
  // helper also drops rows dated before `budget_start_month`, which the budget
  // engine skips — for an account opened before the user's budget start the
  // real impact is exactly zero however large the row is, and that's the case
  // this copy has to get right rather than paper over.
  //
  // Three states, because "$0.00" and "we don't know" are different claims:
  // a known non-zero amount names it, a known zero says plainly that nothing
  // moves, and an absent prop (sidebar variant) names only the mechanism.
  const fmt = useMaskedCurrency();
  const impactPhrase =
    startingBalanceImpact === undefined
      ? `${account.name}'s starting balance`
      : startingBalanceImpact === 0
        ? null
        : fmt(Math.abs(startingBalanceImpact));
  const pickers = isOnBudget
    ? `hides ${account.name} from budget pickers (transfer plan, category funding, reconciliation)`
    : `re-enables ${account.name} as a budget account in transfer plan, category funding, and reconciliation pickers`;
  const convertDescription =
    impactPhrase === null
      ? // Zero impact: the starting balance predates the budget start (or there
        // isn't one), so Ready to assign genuinely does not move. Saying so is
        // more useful than a "$0.00" the user would read as a rounding error.
        `Ready to assign won't change — ${account.name}'s starting balance predates your budget start, so the budget never counted it. This still ${pickers}.`
      : isOnBudget
        ? `Removes ${impactPhrase} from Ready to assign and ${pickers}. Transactions still affect the budget normally.`
        : `Adds ${impactPhrase} back to Ready to assign and ${pickers}.`;

  // Converting moves money into or out of Ready to assign — a number on
  // /budget, not on this page. Nothing here moves, so without the toast the
  // click had no acknowledgement at all.
  //
  // The entry itself was reachable: Convert is kebab-only, so it only fires on
  // /accounts/[id], which renders TransactionsClient → TransactionToolbar and
  // its Undo/Redo buttons, wired to the same module-singleton stack. What's
  // missing on this page is the Cmd+Z *handler* (that lives in budget-table.tsx
  // and transfer-plan-client.tsx), not the affordance.
  const handleConvert = () => {
    const nextOnBudget = !account.is_budget_account;
    setError(null);
    startTransition(async () => {
      try {
        const snapshot = await setAccountBudgetStatusWithSnapshot(
          account.id,
          nextOnBudget
        );
        if (!snapshot) return;
        const ref: { current: BudgetStatusSnapshot } = { current: snapshot };
        const entryId = pushUndoEntry({
          label: nextOnBudget
            ? "Include starting balance"
            : "Exclude starting balance",
          forward: async () => {
            const next = await setAccountBudgetStatusWithSnapshot(
              account.id,
              nextOnBudget
            );
            if (next) ref.current = next;
          },
          backward: async () => {
            await undoSetAccountBudgetStatus(ref.current);
          },
        });
        toast({
          message: nextOnBudget
            ? `${account.name}'s starting balance added to Ready to assign`
            : `${account.name}'s starting balance removed from Ready to assign`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        setError("Could not change this account's budget status.");
      }
    });
  };

  // The Reconcile item is only ever wired when categories were provided
  // alongside `showReconcile=true`. Hide the item rather than render it
  // broken if a consumer forgets to pass the data. Reconcile is also gated
  // to `cash` accounts: drift on a real checking/savings/credit account is
  // a missing-import issue, not lost money — the envelope-vs-wallet mental
  // model only applies to cash. (260514-ux8)
  const canReconcile =
    showReconcile &&
    categories !== undefined &&
    categoryGroups !== undefined &&
    account.type === "cash";

  const isPrimary = account.is_primary;

  // Each of these handles the `{ ok: false }` *return* path. The *throw* path
  // — a locked database, an FK failure — had no handling at all, and
  // ConfirmDialog doesn't cover for it: its confirm button is synchronous and
  // dismisses immediately, so a rejection closed the dialog with nothing
  // rendered in the error span and the user believing the account was gone.
  const handleSetPrimary = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setPrimaryAccount(account.id);
        if (result.ok === false)
          setError(SET_PRIMARY_REASON_COPY[result.reason]);
      } catch {
        setError("Could not set this account as primary.");
      }
    });
  };

  // Closing zeroes the balance (writing a real adjustment against Ready to
  // assign) and archives, in one server transaction. Neither half shows up on
  // this page — the sidebar loses a row, /budget gains money — and the action
  // no longer redirects, so the toast is the only thing that says it happened.
  //
  // Same `ref` idiom as handleAdjusted: each redo mints a fresh adjustment txn,
  // so the next backward() has to reverse the newest snapshot, not the first.
  const handleClose = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await closeAccountWithSnapshot(account.id);
        if ("ok" in result) {
          // Toast as well as the inline span, for the same reason the catch
          // below does: in the sidebar's pencil variant this component is
          // mounted inside a 16x16 absolutely-positioned box, so the error span
          // renders on top of the account name rather than anywhere readable.
          setError(REASON_COPY[result.reason]);
          toast({ message: REASON_COPY[result.reason], variant: "error" });
          return;
        }
        const ref: { current: AccountCloseSnapshot } = { current: result };
        const entryId = pushUndoEntry({
          label: "Close account",
          forward: async () => {
            const next = await closeAccountWithSnapshot(account.id);
            // Throw rather than swallow: a redo that returns `ok: false` (the
            // account became primary while it sat on the redo stack) has closed
            // nothing. Resolving anyway would move the entry back to the undo
            // stack as though it had worked, leaving `ref.current` pointing at
            // a snapshot whose adjustment txn is already gone — so the next
            // Cmd+Z would throw inside revertBalanceAdjustment instead. The
            // throw keeps it redoable and reports through useUndoRedo's
            // onError.
            if ("ok" in next) {
              throw new Error(REASON_COPY[next.reason]);
            }
            ref.current = next;
          },
          backward: async () => {
            await reopenAccountFromSnapshot(ref.current);
          },
        });
        toast({
          message: `${account.name} closed`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        // Both, not either: ConfirmDialog dismisses synchronously, and the
        // sidebar's pencil variant fires this from pages where the inline error
        // span is nowhere near the user's eye.
        setError("Could not close this account.");
        toast({
          message: `Couldn't close ${account.name}`,
          variant: "error",
        });
      }
    });
  };

  // Deliberate reopen, not an undo — the zeroing adjustment stays on the
  // ledger. Reversible with an off-screen effect (the account reappears in
  // another sidebar section), so: toast, no confirm.
  const handleReopen = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await reopenAccount(account.id);
        if (result.ok === false) {
          setError(REASON_COPY[result.reason]);
          toast({ message: REASON_COPY[result.reason], variant: "error" });
          return;
        }
        toast({ message: `${account.name} reopened` });
      } catch {
        setError("Could not reopen this account.");
        toast({
          message: `Couldn't reopen ${account.name}`,
          variant: "error",
        });
      }
    });
  };

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteAccount(account.id);
        if (result && result.ok === false) setError(REASON_COPY[result.reason]);
      } catch (e) {
        if (isRedirectError(e)) throw e;
        setError("Could not delete this account.");
      }
    });
  };

  // Closing a non-zero account writes an adjustment for the whole balance, so
  // the confirm has to name the figure before the user commits to it. Masked
  // via useMaskedCurrency, so privacy mode doesn't leak the one number on
  // screen — the reason the Convert copy above deliberately carries no amount.
  const needsZeroing = roundCents(Number(account.current_balance)) !== 0;
  const closeDescription = needsZeroing
    ? `Before this account can close, its balance has to be zeroed out. An adjustment transaction will be created for ${fmt(
        Math.abs(Number(account.current_balance))
      )}. Existing transactions stay put, and you can undo this from the toast.`
    : "The account will be hidden from the sidebar and from new transaction pickers. Existing transactions stay put. You can reopen it from the Closed section in the sidebar.";

  const deleteDescription =
    transactionCount === undefined
      ? "Permanently delete this account. Any transactions on it will also be deleted. This cannot be undone — consider closing instead."
      : transactionCount > 0
      ? `This will permanently delete the account and all ${transactionCount} transaction${transactionCount === 1 ? "" : "s"} on it. This cannot be undone — consider closing instead.`
      : "This account has no transactions. It will be permanently deleted.";

  const ariaLabel = `Options for ${account.name}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          render={
            triggerVariant === "kebab" ? (
              <ToolbarIconButton label="Account options" aria-label={ariaLabel} />
            ) : (
              <button
                type="button"
                aria-label={ariaLabel}
                className={cn(
                  // Fill the parent slot so the hit area matches the dot
                  // position and the icon stays centered regardless of any
                  // sibling focus-guard nodes Base UI injects while open.
                  "absolute inset-0 flex items-center justify-center",
                  "text-sidebar-foreground-muted hover:text-sidebar-foreground",
                  // Toggle visibility with opacity, NOT display. A `hidden`
                  // trigger collapses to a 0×0 box, so the instant the menu
                  // closes (row un-hovers + data-popup-open drops) the anchor
                  // vanishes while the popup is still playing its exit
                  // animation — Base UI's positioner then snaps the menu to the
                  // page's top-left for a frame. Keeping the box alive
                  // (opacity-0 + pointer-events-none) preserves the anchor rect
                  // through the close animation. The dot in the same slot
                  // mirrors this with group-hover/group-has-[data-popup-open]
                  // opacity swaps.
                  "opacity-0 pointer-events-none transition-opacity",
                  "group-hover:opacity-100 group-hover:pointer-events-auto",
                  "data-[popup-open]:opacity-100 data-[popup-open]:pointer-events-auto"
                )}
              />
            )
          }
        >
          {triggerVariant === "kebab" ? (
            <MoreVertical aria-hidden="true" />
          ) : (
            <Pencil className="h-3 w-3" aria-hidden="true" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={triggerVariant === "kebab" ? "end" : "start"}
          sideOffset={4}
          className="min-w-[200px]"
        >
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit account
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isPrimary}
            onClick={() => {
              if (!isPrimary) handleSetPrimary();
            }}
          >
            <Star
              className={cn("h-3.5 w-3.5", isPrimary && "fill-current")}
            />
            {isPrimary ? "Primary account" : "Set as primary"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAdjustOpen(true)}>
            <Scale className="h-3.5 w-3.5" />
            Adjust balance
          </DropdownMenuItem>
          {canReconcile ? (
            <DropdownMenuItem onClick={() => setReconcileOpen(true)}>
              <Wallet className="h-3.5 w-3.5" />
              Reconcile
            </DropdownMenuItem>
          ) : null}
          {canConvert ? (
            <DropdownMenuItem onClick={() => setConvertOpen(true)}>
              {isOnBudget ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {convertLabel}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {account.archived ? (
            <DropdownMenuItem onClick={handleReopen}>
              <ArchiveRestore className="h-3.5 w-3.5" />
              Reopen account
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={isPrimary}
              onClick={() => setCloseOpen(true)}
            >
              <Archive className="h-3.5 w-3.5" />
              Close account
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            disabled={isPrimary}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete account
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? (
        <span className="ml-3 text-sm text-negative" role="status">
          {error}
        </span>
      ) : null}

      <EditAccountDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        account={account}
        onRequestClose={() => setCloseOpen(true)}
      />

      <AdjustBalanceDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        accountId={account.id}
        accountName={account.name}
        currentBalance={Number(account.current_balance)}
        isDebt={account.is_debt}
      />

      {canReconcile ? (
        <ReconcileDialog
          open={reconcileOpen}
          onOpenChange={setReconcileOpen}
          accountId={account.id}
          accountName={account.name}
          currentBalance={Number(account.current_balance)}
          categories={categories ?? []}
          categoryGroups={categoryGroups ?? []}
        />
      ) : null}

      {canConvert ? (
        <ConfirmDialog
          open={convertOpen}
          onOpenChange={setConvertOpen}
          title={convertTitle}
          description={convertDescription}
          confirmLabel={convertLabel}
          destructive={false}
          onConfirm={handleConvert}
        />
      ) : null}

      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title={`Close "${account.name}"?`}
        description={closeDescription}
        confirmLabel={needsZeroing ? "Adjust balance & close" : "Close account"}
        destructive={false}
        onConfirm={handleClose}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${account.name}"?`}
        description={deleteDescription}
        confirmLabel="Delete account"
        onConfirm={handleDelete}
      />
    </>
  );
}
