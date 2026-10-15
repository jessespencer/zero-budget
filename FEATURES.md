# Features

A tour of what Zero does, organized by page. For architecture and conventions, see
[CLAUDE.md](CLAUDE.md); for setup, see [README.md](README.md).

Zero is a single-user, self-hosted envelope budgeting app. All of your money gets
assigned, the whole database is one portable SQLite file, and nothing leaves your network.

---

## Budget — `/budget`

The core envelope grid. Four columns: **Category**, **Assigned**, **Activity**, **Available**.

### First-run setup

- A fresh install opens on a **Get Zero set up** checklist above the grid: add accounts,
  choose a primary account, create categories, assign all your money, see the transfer
  plan. Steps tick themselves off from real data; the first checking account becomes
  primary automatically, and **Use starter set** adds three editable groups (Bills,
  Everyday, Savings goals). Dismissible at any point; existing installs never see it.
- A new database starts budgeting in the month it was created.

### Month navigation and header

- Month selector with prev/next arrows; forward navigation stops at current month + 1,
  so you can't budget indefinitely into the future. A **Today** button appears when
  you're viewing any other month. The month is a URL param, so months are linkable.
- **Ready to Assign** pill, center header. Click it for a signed breakdown — inflow this
  month, assigned this month, assigned in future months, carried over from prior months,
  carried credit-card debt, and prior-month overspending. Zero rows are suppressed.
  At exactly $0 the pill becomes a non-interactive celebratory state with one of five
  rotating headlines — unless nothing has come in or been assigned yet, when it's a
  plain $0.00.
- Credit-card debt indicator, far right, showing total active card balances (hidden at zero).

### Filtering

Pills for **All**, **Overspent** (with a live count; auto-hides at zero), **Underfunded**,
**Overfunded**, and **Money available**. Filtering hides non-matching categories, hides
emptied groups, and re-scopes the summary panel to the filtered subset. Each filter has
its own empty state with a "Clear filter" action.

Every filter compares the cents you see, not the raw float behind them. `available` is a
running sum of assigned plus activity, so a category funded to exact break-even lands a
hair off zero rather than on it — and a category sitting at −0.0000000000001 is not
overspent in any sense a person means. Rounding first is what keeps the Overspent count,
the pill, the detail panel, and the Move money warning all telling the same story.

### Assigning money

- Click any Assign cell to edit — auto-selects, Enter or blur saves, Escape reverts.
- The **Available** pill is a button that opens a **move money** popover: prefilled with
  the full available balance, destination grouped by category group with Ready to Assign
  pinned at the top, and a live "this will overspend by $X" warning.
- The pill's appearance is derived state: overspent (red + triangle), underfunded
  (amber + clock), funded (green + progress ring, filled check when the goal is complete),
  saving, or neutral at zero.

### Auto-assign

- **Fund underfunded** — opens a preview dialog listing every category that will receive
  money, grouped, with per-row amounts and a grand total, plus a count of how many
  categories come out of the red. Runs as a single undoable transaction.
- **Copy last month's budget** — overwrites this month's assigned values from the previous month.
- Per-category one-click assigns on the Goals tab: underfunded amount, round up to the next
  $10, assigned last month, spent last month, 3-month average assigned, 3-month average spent,
  reset available to $0, reset assigned to $0. Each disables itself when it would be a no-op.

### Targets

Cadence tabs for **Weekly**, **Monthly**, **Yearly**, and **Custom**.

- Weekly shows the monthly equivalent (×52/12), which is what actually gets stored.
- Custom offers three goal shapes: **set aside $X** (bills, subscriptions), **fill up to $X**
  (gas, fun money, dining), and **have a balance of $X** (long-term savings). The first two
  support an optional due-by date; the third is always open-ended.
- Target view shows a progress ring, the total to assign by the deadline, progress so far,
  and the remaining gap. Underfunded targets get a one-click "assign $X more" CTA.
- Open-ended savings goals get **5% / 10% / 25%** quick-assign buttons against the gap.
- Recurring dated targets behave as sinking funds — the deadline rolls forward by whole
  years and progress measures against the current balance, so a spent-down fund correctly
  reads underfunded again next cycle.

### Category and group management

- Rename inline, move up/down, move to another group — via the kebab menu or by dragging.
  Drag-and-drop works within a group and across groups; the menu path mirrors it exactly.
- Groups reorder via a grip handle on the group header.
- Delete dialogs pre-fetch and state exactly how many transactions become uncategorized.
  A category that carries budget history requires a destination before Delete enables —
  dropping those rows would return money to Ready to Assign that has already been spent,
  so "leave uncategorized" is withheld and the dialog says why. Group delete uses the same
  picker. Budget history moves with the transactions.
- **Category settings**: which account the money lives in (allocation account), a **buffer**
  flag (keeps the balance in checking, excluded from transfer-plan sweeps), and **pin to
  mobile quick-add** (limit 3, enforced server-side).

### Bulk operations

Per-row checkboxes with shift-click range select. Group header checkboxes select the group
and mirror its children with a proper indeterminate state; the column header checkbox
selects everything currently visible. A floating toolbar offers bulk **allocation account
reassignment** and **delete** — the delete dialog pre-computes the affected transaction
count and offers a "reassign transactions to…" picker rather than silently orphaning them.

### Hidden categories

A collapsed **Hidden** section at the bottom of the grid. Hidden groups render as muted
collapsible rows with their children beneath; individually hidden categories show a faint
breadcrumb of the group they'll return to. Hover any row for an eye button to unhide.

Hiding a category sweeps its positive available balance back to Ready to Assign by lowering
that month's assigned; overspent categories sweep nothing. Unhiding is a flag-only flip —
the money stays in Ready to Assign. Both directions undo cleanly, including restoring which
children of a group were individually hidden beforehand.

### Detail panel

Click any category row. Shows a pinned "this month" card (assigned / activity / available)
and three tabs: **Goals**, **Transactions** (this month's, click through to the full edit
dialog), and **Notes** (free-form, saves on blur, Enter saves and Shift+Enter breaks lines).

With no category selected, the panel shows the month summary, a **cost to be me** card
(total target obligations plus an editable expected-income forecast), and the auto-assign actions.

---

## Transactions — `/transactions` and `/accounts/[id]`

Both routes render the same register; the account page scopes it to one account and hides
the account filter.

### Filtering and search

- Date range popover with presets (this month, latest 3 months, this year, last year,
  all dates) plus a custom month/year range. The choice persists in a cookie, and presets
  are stored as *intent* — "this month" re-resolves against the clock rather than freezing.
- Debounced search (⌘K to focus) across payee, memo, and amount. Amount search matches
  formatted values, so "12.50" finds an outflow of −12.50. Searching auto-widens the date
  range so results aren't silently hidden, then reverts when cleared.
- Active filters render as removable chips: category, uncategorized, date range, import
  source, and the current search text.
- Server-side sorting on date, payee, category, account, and amount. Text sorts use
  `COLLATE NOCASE` so mixed-case payees interleave properly. Results cap at 5000 rows.

### Editing

- Inline edit of date, payee, category, account, memo, outflow, and inflow. Enter saves,
  Escape cancels, and only changed fields are sent — a no-op save skips the server entirely.
- Auto-focus targets the column you clicked. The viewport pins during typing so the caret
  doesn't yank the list around.
- Payee selection autofills the category when that payee has a learned default.

### Splits

Split parents show a chevron that expands read-only detail rows. Enter split mode from the
category picker; lines auto-distribute evenly with the remainder on the last row. Saving an
unbalanced split raises a "something doesn't add up" panel with three resolutions —
adjust manually, update the parent total, or auto-distribute. Choosing a single category
while in split mode demotes back to a plain transaction.

### Transfers

Two-leg atomic pairs. Selecting one leg auto-selects its sibling (mirroring the delete
cascade). Editing routes through a dialog that resolves the sibling server-side and updates
both legs together, so it works even in an account-scoped view where the other leg isn't
loaded. Deleting one leg cascades; undo restores both.

### Bulk operations

Shift-click for ranges, Cmd/Ctrl-click to toggle, Escape to clear, Delete/Backspace to
remove. The floating toolbar offers approve, categorize, rename payee, mark cleared,
duplicate, move to account, add schedule, and delete. Transfer-aware throughout —
categorize, rename, move, and duplicate skip transfer legs in a mixed selection, and the
delete confirm reports the *effective* count including auto-cascaded siblings.

### CSV import

Auto-detects ten bank formats: YNAB, Chase, Capital One, Elevations, Discover, Bank of
America, Wells Fargo (including headerless exports), American Express, Ally, and USAA.
Sign conventions are normalized per bank.

Unrecognized formats fall through to manual column mapping — date, payee, amount, and
optional memo pickers with header auto-detection, a live preview, and a "flip amount sign"
checkbox. Multi-account YNAB exports get an account-mapping step pre-filled by name match.

Duplicate detection runs against the database *and* within the file itself; duplicates are
surfaced at the top of the preview, badged, dimmed, and auto-deselected. Category resolution
falls back through CSV-provided category → exact payee default → fuzzy payee match.

### CSV export

Uses YNAB's column shape (`Account,Date,Payee,Category,Memo,Outflow,Inflow`), chosen so
Zero's own exports round-trip back through Zero's importer with no manual mapping. Two
scopes: **current view** (the loaded filtered/sorted rows, serialized client-side) and
**all history** (uncapped, ignores filters). RFC-4180 quoting, CRLF, no BOM.

### AI import

No bank sync — instead, hand a statement (screenshot, CSV or pasted text) to an AI
coding agent like Claude Code or Codex, and the bundled `import-txns` skill reconciles it:
it matches every line against Zero (allowing for date drift, renamed payees and pending
charges), checks the balance against the statement, backs up, and inserts only what's
missing. It runs in your agent, not in Zero, against the local database or your server's.
See [docs/AI-IMPORT.md](docs/AI-IMPORT.md).

### Payees

Learned automatically — creating a transaction upserts the payee with its category, and
recategorizing updates that payee's default for future autofill. Fuzzy matching normalizes
noisy bank strings ("KROGER #1234" → Kroger, "AMAZON.COM*AB12CD" → Amazon) with a
longest-match-wins rule and a 3-character minimum.

A **Manage payees** dialog (sidebar settings) offers search, rename, default-category
editing, delete, bulk delete, and merge — including a "merge instead" escape hatch when a
rename collides with an existing name.

### Uncategorized banner

Shows the **all-time** uncategorized count, deliberately ignoring the active filter (scoped
per-account on the register). Clicking View both sets the filter and widens the date range,
so the revealed count matches the promise the banner made. Excludes transfers and split
parents so only genuinely uncategorized rows surface.

---

## Accounts — `/accounts/[id]`

Header shows the name, type badge, and current balance. Actions: account menu, import CSV,
export CSV, pay card (credit cards only), and add transaction.

- **Edit** — rename, change type (checking, cash, savings, credit card, other)
- **Set as primary** — atomic swap that clears the previous primary
- **Adjust balance** — enter the new balance and Zero writes the delta as an adjustment
  transaction; credit cards show "amount owed" and prefill the positive value
- **Reconcile** — cash accounts only, by deliberate design: drift on a real bank account is
  a missing-import problem, not lost money
- **Include / exclude starting balance** — toggles on-budget status, with a confirm that
  explains the effect on Ready to Assign and which pickers the account disappears from
- **Close** — archives it and zeroes the balance with a Ready-to-assign adjustment, so a
  closed account stops counting toward net worth. Transactions are preserved. Undoable, and
  reopenable later from the sidebar's **Closed** section — a deliberate reopen, which leaves
  the zeroing adjustment on the ledger rather than reversing it. Blocked for the primary
  account.
- **Delete** — permanent; the confirm names the exact transaction count and suggests closing instead
- **Pay card** — amount field with a "full balance" shortcut, pay-from picker defaulting to
  primary, records a transfer pair

Adding an account takes a name, type, and starting balance, and creates the appropriate
starting-balance transaction routed to Ready to Assign or the system category depending on
debt and on-budget status.

---

## Insights — `/insights`

Five tabs. All state is URL-driven, so any view is linkable. Legacy deep links still resolve.

### Net worth

Line chart with 1M / 3M / 6M / 1Y / All ranges, filtered client-side over a preloaded series
so switching is instant. Headline shows current net worth, absolute delta, and percent change.

The series is derived live from transactions and tracked-asset history — there is no snapshot
table. Account balances walk backward from today; tracked assets step-interpolate to their most
recent recorded value at or before each date. Debt subtracts; off-budget accounts still count.

**Holdings list** across eight groups (cash and checking, credit cards, investments, retirement,
real estate, crypto, vehicles, other), hiding empty ones. Tracked-asset rows show freshness
("last updated 3 days ago"). Archived assets collect in a collapsed **Archived** section with a
one-click Unarchive — headed by a count rather than a total, since archived assets are excluded
from net worth and a sum there would read as money that still counts.

### Spending breakdown

Month-navigable donut chart, toggleable between categories and groups. Slices cap at the top 8
plus an "everything else" bucket. Colors are hashed per category name, so a category keeps its
hue month over month. Hovering grows the slice, dims the rest, and swaps the center label.
Clicking drills into a transaction dialog (preloaded server-side, so it opens with no spinner).

Alongside: a scrollable legend table with proportional bars and percentages, and a stats card
showing average monthly spend, average daily spend, most frequent category, and largest outflow.

### Tables

Category × month grid (or × year with historical data enabled), with collapsible groups and a
master expand/collapse. Sortable on the category name, any period column, or the total. Non-zero
cells link into `/transactions` filtered to that category and date range. Each row gets a
sparkline — running envelope balance in month grain, so savings envelopes visibly climb even
when their cells read "—".

### Trends

*Requires `NEXT_PUBLIC_ZERO_HISTORICAL_DATA=1`.*

All-time ranked horizontal bars, toggleable between category and payee. Each row shows the
lifetime total, a bar scaled against the largest row, and an annotation of the monthly average
across the active span with the first–last year range. Payee view adds search (top 25 by default,
uncapped once you type).

### Patterns

*Requires `NEXT_PUBLIC_ZERO_HISTORICAL_DATA=1`.*

- **Seasonality heatmap** — category × 12 months, intensity normalized per row so each
  category's peak month is darkest, with a peak column and per-year tooltip breakdowns.
- **Spending calendar** — a GitHub contribution-graph of the year. Color uses a log scale
  anchored between the 10th-percentile day and the biggest day, so the median stays pale and
  only genuine blow-outs run dark. Clicking a day drills into that date's transactions, and
  the register's chip strip names the drilled day rather than the surrounding range. A
  weekday strip above shows each weekday's average with the heaviest one ringed.

Both heatmaps sum **outflows only** — a day that nets positive (refund, reimbursement, asset
sale) is not spending, and letting one set the color ramp washed out every real spending day
in that year. The seasonality/calendar toggle round-trips through `?view=`, so a shared
Patterns link opens on the view you were looking at.

Every spend report on this page — calendar, seasonality, both Tables pivots, Trends, and the
sparklines — reads split transactions through their children, so money on a split lands in
the report instead of vanishing with the uncategorized parent.

### Tracked assets — `/assets/[id]`

Per-asset value chart with the same range tabs, an update panel (value, recorded date for
backfilling old valuations, optional note), and a history table with a computed change column
versus the prior entry. Rows are editable and deletable; the asset itself can be renamed,
retyped, archived, or deleted. Everything is undoable.

---

## Transfer plan — `/transfer-plan`

Read-only and derived on every page load — there is no stored plan and no "execute" button.

For the current month, Zero computes:

- **Savings transfers** — for each budget account with categories pointed at it, the total
  allocated versus the actual balance, and the shortfall to move
- **Credit card payments** — the amount due on each active card
- **Buffers** — every category flagged as a buffer, which must stay parked in checking
- **Summary** — checking actual, total outflows, buffer total, required in checking, and
  the remaining figure

Requires exactly one account flagged primary; without it the page shows a warning banner
instead of a plan.

You can override each account's actual balance inline (Enter commits, Escape cancels).
Overrides persist per month per account as a what-if layer — they never touch the real
balance. Credit-card values typed as positive are auto-negated. Any row with a non-zero
amount gets a **Record** button that opens a prefilled transfer dialog and writes the real
two-leg transfer, undoable.

---

## Schedules — `/schedules`

### Recurrence

Daily, weekly, every two weeks, monthly, yearly, or once — with an interval ("every N…"),
day-of-month (1–31 plus "last day"), day-of-week, and weekend handling (none / move to
Friday / move to Monday). Day-of-month clamps to the month length, so the 31st becomes
the 28th in February. Editing only recomputes the next date when a recurrence field actually
changed, and floors it at today so it can never regress into the past.

### The table

Six status badges: **missed** (past due), **due** (today), **upcoming** (within 7 days),
**paid** (a transaction already exists for this occurrence), **completed**, and **scheduled**.
Sorted incomplete-first, then by next date.

Row actions: post transaction (at the scheduled date), post today, skip next date, complete
or restart, and delete with a toast Undo and full snapshot restore.

### Auto-posting

Schedules flagged "auto-post when due" fire on app load, from whatever route you land on.
A correlated `NOT EXISTS` check guards against duplicates. Posting inserts the transaction,
applies the balance delta, upserts the payee for autocomplete, and advances the schedule —
auto-completing one-off schedules and any recurrence that has run past its end date.

---

## Quick add — `/quick`

An installable standalone PWA for fast mobile capture, living outside the desktop shell.

- **Plain dollar entry on the decimal pad** — `5` is $5, `12.34` is typed with its point.
  Capped at $9,999,999.99: keys past seven whole digits or two cents are ignored. A pasted
  amount (`$1,200.50`) is read as dollars.
- **Maths in the amount field** — type `5+5` or `45 + 12.50` straight into it; the field shows
  the expression and the total sits beside the label. `+ − × ÷`, normal precedence. Touch
  screens get a small operator row, since a phone's keypad has none. Backspace steps back
  through an operator into the previous number. The saved amount is the total.
- Three modes: expense, income, and transfer. Transfer mode swaps in a from/to account pair
  and hides the category and payee blocks; a memo is written to both legs.
- **Three category tiles** chosen server-side by a priority chain — pinned categories first,
  then usage frequency over the last 60 days, then padding from the rest, with system
  categories filtered out at every step.
- A full-category bottom sheet with search and grouping, which doubles as a **split** editor:
  multi-select 2+ categories and per-line amounts auto-distribute evenly, with a live
  allocated/remaining readout, a Balance button, and a hard block on saving while unbalanced.
- Payee sheet with search, clear, and inline creation of a new name.
- Account chips including tracking-only accounts, remembering your last choice.
- **Optimistic saves** — instant toast, keyboard dismissed, pending row prepended to Recent.
  Pending entries mirror to localStorage so an interrupted submit survives a reload.
- **Recent** shows the last 5 transactions with relative timestamps and a status glyph.
  Tap a row to edit it in a full sheet (including promoting it to a split or demoting back),
  or to delete. Transfer rows open a delete-only sheet — transfer editing is deliberately
  out of scope on mobile.

---

## App-wide

### Navigation

Collapsible sidebar (260px / 60px) with Budget, Insights, Transactions, Schedules, and
Transfer plan. Accounts are grouped into cash, credit card, and other, each section showing
a total. Per-account rows show the balance, dim at zero, and carry a warning dot when that
account has uncategorized transactions.

Closed accounts collect in a **Closed** section — collapsed by default, labeled with a count
rather than a total, and the route back to reopening one. The footer carries the app version
and build credit.

### Settings

A gear popover at the sidebar footer: theme (light / dark / system, in its own dialog),
manage payees, and the hide-amounts toggle.

### Privacy mode

Client-side "hide amounts" that masks every figure to `$••••••`. Persisted to localStorage
and applied pre-paint by a blocking inline script, with a CSS blur bridging the gap until
hydration — so nothing flashes on load. While hidden, every money-writing dialog is hard
blocked, not just visually masked. A banner explains that amount changes won't be saved.

### Undo / redo

A module-level singleton store, so the stack survives route changes. Cmd/Ctrl+Z and
Cmd/Ctrl+Shift+Z are registered per-surface (budget, transfer plan) and suppressed while
typing. Toolbar buttons on the transactions page show labeled entries.

Toast Undo buttons target *their own* entry by id rather than the top of the stack, so they
still do the right thing after you've done something else inside the toast's six seconds.

Covered operations span essentially every mutation: assign edits, money moves, renames,
add/delete of categories and groups, reorders, hide/unhide, notes, expected income, target
quick-assigns, transaction edits and splits, bulk delete, duplicate, categorize, payee merge,
transfer create/edit/delete, account balance adjustments, reconciles, and asset value history.

### Every mutation acknowledges itself

Feedback is chosen by what a mutation *does*, not by which component fires it. A change whose
effect is visible on screen right now needs nothing; one whose effect is off-screen toasts;
anything with a snapshot variant toasts *with Undo*; anything genuinely irreversible sits
behind a confirm. Failures surface too — an optimistic value that never persisted rolls back
and says so instead of lingering as a lie. Convention test suites enforce the mechanical half
of this in CI, with no grandfathered exemptions left.

### Other

- **Toasts** — bottom-center, hover pauses the timer, optional single action button
- **Empty states** — the entire first-run story; there is no onboarding flow or tour
- **Keyboard shortcuts** — Cmd/Ctrl+N or bare `n` for a new transaction, ⌘K to focus search,
  Cmd/Ctrl+Z undo, Delete to remove a selection, Escape to clear, Alt+click to expand all groups
- **Dev gallery** at `/dev` — every primitive, every toast, every empty state, and a
  one-page audit view of all production components

### Feature flags

| Flag | Default | Gates |
|---|---|---|
| `BANK_SYNC` | off | Approved column, pending section, approve workflow |
| `RECONCILIATION` | off | Cleared column, bulk clear action |
| `HISTORICAL_DATA` | env opt-in | Pre-cutoff year selectors, Insights Trends and Patterns tabs |

Gated code stays in the tree rather than being deleted. The standalone
`/reports/reconciliation` page was an exception — deleted 2026-07-26, superseded by the
per-account Reconcile action. The cleared-column gate it shared is untouched.
