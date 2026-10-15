# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build (webpack — Turbopack has SSR bugs in prod)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm start            # Start production server on port 4040
npm run deploy       # Build + restart pm2 production process
npm run backup       # Create a timestamped database backup
npm run db:info      # Print database path, size, schema version, row counts
npm run db:migrate   # Apply pending migrations without booting the app (see below — migrations otherwise run only at boot)
npm run db:slot      # Switch the local dev DB between onboarding / seeded / full
npm run seed:dev     # Wipe local dev DB and insert a demo household (4 accounts, 13 months of txns ending today, ~$500k tracked assets; Ready to assign lands on $0). Backs up first; refuses DBs under ~/.local/share/zero/ or in ZERO_PROTECTED_DB_PATHS.
npm run site         # Serve the launch site (site/ — static HTML/CSS, no build step) on http://localhost:4321; hosted on Cloudflare via wrangler.jsonc
npm run site:assets  # Recapture the screenshots the site and README share (site/assets/, dark + light WebP), and og.png from an app running seed:dev data (SITE_APP_URL, default :3000; use a production build so no dev badge shows)
npm run icons        # Regenerate every icon — app favicon/app icons, /quick PWA icons, and the site's favicons — from the Z mark (scripts/lib/z-mark.mjs; lime tile)
npm run hooks:install # Point core.hooksPath at .githooks/ — a fresh clone has NO protection until this runs
npm run mirror       # git push --mirror to a bare repo on another machine (ZERO_MIRROR_URL; the only real undo)
npm run codex:sync   # Regenerate the Codex mirror (.agents/skills/) from .claude/skills/ — never edit the mirror by hand
npm run test         # Run Vitest unit tests
npm run test:run     # Run Vitest once (no watch)
npm run test:e2e     # Run Playwright e2e tests against an already-running server — and whatever DB it has mounted
CI=1 npm run test:e2e # Self-contained: seeds a temp DB from the seed:dev fixture and boots its own server on :3000
```

### Running from a git worktree

`git worktree add` copies tracked files only, so a fresh worktree has **no
`.env.local` and no `data/`** — both are gitignored. Nothing errors; the app
just boots in a different configuration than the one you develop against:

| Missing | Symptom |
|---|---|
| `NEXT_PUBLIC_ZERO_DEV_MODE` | no "Dev mode" banner — usually the first clue |
| `NEXT_PUBLIC_ZERO_HISTORICAL_DATA` | historical data silently gated off |
| `ALLOWED_DEV_ORIGINS` | LAN/phone access refused |
| `data/zero.db` | Next resolves `data/zero.db` relative to the worktree and finds nothing |

Symlink the env file rather than copying it, so there's one source of truth,
and pass an **absolute** `ZERO_DB_PATH` — the default is relative to `cwd`:

```bash
ln -s <main-checkout>/.env.local <worktree>/.env.local
ln -s <main-checkout>/CLAUDE.local.md <worktree>/CLAUDE.local.md   # if you keep one
cd <worktree> && ZERO_DB_PATH=<main-checkout>/data/zero.db npx next dev --turbopack -p 3000
```

Confirm it took: the boot log prints `- Environments: .env.local`. If that line
is absent, every var above is unset. `.gitignore` covers `.env*`, so the
symlink can't be committed.

`bin/backup.sh` used to have the same class of bug — being bash, it never read
`.env.local`, so a hand-run `npm run backup` over SSH died with "database not
found at data/zero.db" while cron worked (its entry sets `ZERO_DB_PATH`). As of
`a59b1ae` the script loads `ZERO_DB_PATH`/`ZERO_BACKUP_DIR` from `.env.local`
itself, resolved relative to the script rather than `cwd`. A real environment
variable still wins over the file, so the cron and pm2 overrides are unchanged.

## Architecture

Zero is a personal finance app (envelope budgeting) built with **Next.js 15 App Router**, **React 19**, **SQLite** (via better-sqlite3), and **Tailwind CSS v4**.

### Data flow

1. **Pages** (`app/(app)/*/page.tsx`) are server components that fetch from SQLite and pass data as props
2. **Client components** hold optimistic local state, synced from server props via `useEffect`
3. **Server actions** (`app/(app)/*/actions.ts`, `"use server"`) mutate the database and call `revalidatePath()`
4. **Undo/redo** — `useUndoRedo` hook tracks `MutationEntry` objects with `forward()`/`backward()` functions; server actions that support undo have `*WithSnapshot` variants

### Database

- **SQLite** via `better-sqlite3` — single portable `data/zero.db` file (WAL mode, foreign keys enabled)
- Singleton connection via `getDb()` from `lib/db.ts` (cached on `globalThis` for dev hot-reload)
- Schema managed by migration runner (`lib/migrations/runner.ts`), runs automatically on boot
- All queries scoped by `user_id` using `DEFAULT_USER_ID` constant (single-user app, no auth)
- Month keys stored as ISO date strings for the 1st of the month (`"2026-04-01"`)
- Queries are synchronous (`db.prepare(sql).run/get/all(params)`)
- Boolean fields stored as INTEGER (0/1) — use `mapRow()`/`mapRows()` from `lib/db-utils.ts` to convert
- UUIDs generated via `newId()` from `lib/db-utils.ts`
- Upserts use `INSERT ... ON CONFLICT(...) DO UPDATE SET ...`
- Multi-step mutations wrapped in `db.transaction()` for atomicity
- No auth — single-user app with no login page or middleware checks

### Budget engine

`lib/budget-engine.ts` computes the full budget state:
- Assigned + activity = available (cumulative across months)
- Overspent categories from prior months deduct from Ready to Assign
- Ready to Assign = total income − total assigned − overspent deduction

### Key libraries

- **better-sqlite3** — synchronous SQLite driver
- **shadcn/ui** — component primitives in `components/ui/`
- **SortableJS** — drag-and-drop (raw, not react-sortablejs wrapper), uses DOM revert pattern
- **Recharts** — financial charts on the Insights page
- **date-fns** — date formatting/parsing
- **cmdk** — command palette

## Conventions

### UI text
- **Sentence case** for all user-facing text (headings, buttons, labels, tabs, menu items)
- Only capitalize the first word and proper nouns (e.g. "Add expense", not "Add Expense")
- No ALL CAPS — use sentence case with `uppercase tracking-wider` via CSS

### Layout standards
- Page headers: `h-[88px]` with `bg-accent/40`
- Toolbars and control-only filter bars: `h-toolbar` (44px, defined as `--spacing-toolbar` in `globals.css`)
- Chip filter bars (budget, Insights tables): `h-[55px]` with `gap-2`/`px-2` — 38px chips get 8px on every side, matching the gap between them
- Column headers: `h-12` with `bg-background`
- Data rows: `h-12` (48px) consistently
- Sidebar: collapsible, 260px expanded / 60px collapsed. Auto-collapses below 1024px (`useAutoCollapse`); widening restores the user's last wide-screen choice

### Typography
- Page title (the big text inside the `h-[88px]` page header): use the `page-title` utility class — 32px / weight 800 / `-0.02em` tracking. Defined in `app/globals.css`. Applies to the `<h1>` on every page and to the `<div>` month/year labels in `MonthSelector` / `YearSelector` (which intentionally aren't h1s — see the rotor comment in those files). Don't re-roll the inline trio.
- **Dialog / modal / popover titles**: always the **18px / weight 800** variant — `font-heading text-lg leading-none font-extrabold`. This is the default in `DialogTitle` and `PopoverTitle` (`components/ui/{dialog,popover}.tsx`); use those primitives and don't hand-roll a smaller or lighter heading. Any new overlay surface (Dialog, Popover, custom modal) follows this exact title treatment.

### Design tokens
- `--color-positive`: green — positive balances
- `--color-negative`: red — negative / overspent
- `--color-warning`: yellow — underfunded
- `--color-info`: blue — informational
- Light/dark/system theme support (oklch color space)
- Interactive selection accents (checkboxes, multi-select indicators) use `accent-primary` — the brand green (hue 155), not `accent-positive` (hue 130, reserved for financial positives). Matches the Save button and other brand interactions. See `components/budget/select-checkbox.tsx` for the canonical pattern.

### Surface system — one token per role, no exceptions
`bg-accent/40` (and any other alpha-blended token) reads differently depending on what's behind it. To keep surfaces consistent across pages, every callsite must follow these rules:

| Role | Token | Notes |
|---|---|---|
| Page background | `bg-background` | The off-white the whole app sits on |
| Content panel / card / row | `bg-card` | Solid white (light) — what the user perceives as "the content surface". Used on holdings sections, budget data rows, tx rows, insights panels, etc. Do not use `bg-card/50` or other alphas — half-tone cards alpha-blend with the page and become invisible. |
| Section header inside a panel | `bg-accent/40` | The cream-tinted band at the top of a card-shaped section (holdings group header, transfer-plan section header, budget group row, `h-[88px]` page header). Requires the parent to be `bg-card` so the 40% alpha lands at ~oklch 0.98 — if it sits on the page bg directly, the same token renders ~0.957 and disappears. Wrap any new section-header consumer in `bg-card` first. |
| Row hover | `hover:bg-accent/30` | One token for every interactive row across the app (budget, tx, holdings, schedules, audit, reports). Don't pick `/20` or `/40` — they drift. Exception: combobox options inside a popover use `bg-foreground/[0.06]` for both hover and keyboard-active — the popover surface needs a neutral wash. |
| Row open / checked | `OPEN_ROW_CLASS` / `CHECKED_ROW_CLASS` (`lib/row-classes.ts`) | Open = the row whose detail is in a panel/sheet/dialog; checked = ticked for a bulk action. Tint plus an inset left bar — tint alone reads as hover. Use the `*_TABLE_ROW_CLASS` variants on `<tr>` (the bar goes on the first cell). |

### Shared components — use these, don't re-roll

Canonical pickers live in `components/shared/`. **Use them. Do not use native `<select>`, native `<input type="date">`, or custom-built dialogs/banners when a shared component already exists.** This is the single most-violated convention; check this list before building any picker/input/dialog UI:

| You need…                                  | Use                                                | Notes                                                                              |
|--------------------------------------------|----------------------------------------------------|------------------------------------------------------------------------------------|
| Category picker (single, grouped)          | `CategoryCombobox`                                 | Type-ahead, Arrow/Enter/Escape nav, grouped + optional income section + optional Split |
| Account picker                             | `AccountCombobox`                                  | Same UX shape as CategoryCombobox                                                  |
| Payee picker (with default category)       | `PayeeCombobox`                                    | Returns `(name, defaultCategoryId)` on change                                      |
| Date input                                 | `DateInput` (`components/shared/date-input.tsx`)   | Native pickers vary across OS and don't match our token system                     |
| Month / year selector                      | `MonthSelector` / `YearSelector`                   | Consistent header chrome across budget, insights, transfer plan                   |
| Confirm a destructive action               | `ConfirmDialog`                                    | Wraps the shadcn Dialog with our destructive-button conventions                    |
| Empty-state placeholder                    | `EmptyState`                                       | Used in every table/list when the dataset is empty. `variant="compact"` (text only) for a no-match inside a dialog, card, or search |
| Currency display                           | `<Currency>` (component) or `useMaskedCurrency()` / `useMaskedCurrencyWhole()` (hook, for strings/chart tick+tooltip formatters) | **These mask to `$••••••` in privacy/demo mode — raw `formatCurrency`/`formatCurrencyWhole`/`formatCurrencyParts` do NOT.** An ESLint rule (`no-restricted-imports`) blocks importing the raw formatters outside `components/shared/{currency,use-masked-currency}`. Only import them for non-display uses — undo/aria labels captured at mutation time, or a custom format that already gates on `hidden` — with an `eslint-disable-next-line` + reason. Add the `zero-amount` class to any server-rendered money span for the anti-flash blur. Still handles negatives, zero, locale. |
| Pick-one view toggle (Grid / Simple)       | `SegmentedControl` (`components/shared/segmented-control.tsx`) | Sliding thumb; `size` md/sm, `iconOnly` (labels → tooltip). Filters stay as chips (`h-[55px]` chip bars) |
| Header figures (right side of a page header) | `StatStrip` / `StatLedger` / `StatCell` (`components/shared/stat-strip.tsx`) | Hero + ledger: one large headline figure (`statHeroClass()` + `STAT_VALUE_CLASS`, usually a button opening a breakdown popover built from `components/shared/breakdown-list.tsx`), then a `StatLedger` of `StatCell` label/value rows, each with a `hint` tooltip. No card or dividers. Budget and transfer plan |
| Icon-only action (control row or header)   | `ToolbarIconButton` (`components/shared/toolbar-icon-button.tsx`) | Control rows: filters left, these right. Page headers: the primary keeps its label, every secondary is a `variant="outline"` ToolbarIconButton. Always tooltipped; pass `keys` for a shortcut |
| Page toolbar (header + actions row)        | `PageToolbar`                                      | h-toolbar height, sentence-case buttons                                            |
| Dev-mode banner / uncategorized banner     | `DevModeBanner` / `UncategorizedBanner`            | Pre-built; emit CSS vars used elsewhere — re-rolling breaks layout                 |
| Sidebar / theme primitives                 | `Sidebar` / `ThemeProvider` / `ThemeToggle`        | Don't fork; theme tokens are wired through these                                   |
| Single-line text that may truncate         | `TruncatedText`                                    | Tooltip only when actually cut off; keeps measuring as the column resizes |
| Money that should acknowledge a change     | `<Currency flash={month}>` / `useFlashOnChange` / `FlashOnChange` | Brief brand-green halo after a mutation. Pass the month as the scope on budget surfaces so month navigation doesn't flash; add `data-flash-ring` on surfaces with their own fill |
| Keyboard shortcut hint                     | `ShortcutTooltip` (or `Kbd` from `components/ui/kbd.tsx` inside a tooltip) | Every shortcut should be discoverable on hover |
| Floating toolbar that should animate out   | `useExitPresence`                                  | Keeps it mounted for the exit and remembers the last value to show |
| Top-labeled form field (label above input) | `FieldGroup` (`components/ui/field-group.tsx`)     | `text-sm font-medium text-muted-foreground mb-1.5 block` — supports `optional` flag for "(optional)" suffix. Use in every dialog/form; don't hand-roll the label classes. |

If you genuinely need behavior the shared component doesn't have, **extend the shared component first** (small additive prop) rather than re-rolling in a feature folder. If the right component doesn't exist yet, add it to `components/shared/` so the next caller picks it up.

Lower-level primitives (Button, Dialog, Popover, Tooltip, Input, Select) live in `components/ui/` (shadcn) — use those when there's no shared wrapper.

- **No route-level `loading.tsx` under `app/(app)/`.** Its Suspense boundary delayed page hydration until an interaction, which broke `?category=` deep links. Navigation feedback comes from `useLinkStatus` on the sidebar links instead; in-page filter navigation uses a `useTransition` pending state (see `transactions-client.tsx`).

### Data patterns
- Server actions in `app/(app)/*/actions.ts` with `"use server"`
- Optimistic local state synced from server props via `useEffect`
- Undo/redo via `useUndoRedo` hook with forward/backward mutation entries
- `revalidatePath` after every mutation. When a mutation moves money, call
  `revalidateMoneyPages()` from `lib/revalidate.ts` rather than naming paths by hand —
  it invalidates transactions, budget, transfer-plan, insights, and `/accounts/[id]`.
  A bare `revalidatePath("/")` names no payload at all (`app/page.tsx` is a redirect);
  it only appears to work because any `revalidatePath` from a server action nukes the
  whole client Router Cache. Don't rely on that side effect.
- Drag-and-drop: raw SortableJS with `fallbackOnBody`, `swapThreshold: 0.65`, `invertSwap`

### Balance writes go through `lib/balance.ts`

`accounts.current_balance` is never updated with a raw `UPDATE … current_balance + ?`.
Every write routes through `applyToBalance`, which is gated on two conditions and
silently no-ops when either fails: the transaction must be **approved**, and its date
must be on or after `app_settings.budget_start_month` (inclusive at the boundary).
Historical rows and pending rows do not move the live balance.

The one exception is `applyPostingToBalance`, for moving a held amount *across* the
approval boundary — posting applies it, un-posting reverses it, still cutoff-gated. It
exists because the row's own `approved` column is by definition stale during that
transition, and letting callers pass a value they know is wrong would rot
`applyToBalance`'s gate.

Balance adjustments (the synthetic "Balance adjustment" transaction against Ready to
assign) have a matched pair: `writeBalanceAdjustment` / `revertBalanceAdjustment`. The
revert throws when the transaction is already gone — that's the signal the snapshot has
been undone once already, not an error to swallow.

### Convention tests

`__tests__/unit/conventions/` fails CI on structural violations, not on behavior:

| Suite | Catches |
|---|---|
| `system-visibility.test.ts` | A `*WithSnapshot` call site missing its undo push or toast; an un-snapshotted delete with no `ConfirmDialog`; unguarded transitions |
| `render-time-mutations.test.ts` | `revalidatePath` or a write called during a render pass |
| `dead-exports.test.ts` | A server action nothing imports |

Allowlists are empty. A failure is a violation introduced today — fix the call site, don't
re-add an entry.

### System visibility — every mutation must acknowledge itself

Feedback is chosen by **what the mutation does**, never by what kind of
component fires it. Historically dialogs got error handling (they have an error
slot) while menus, tables, and toolbars got nothing — risk never entered into
it. Pick the row that matches the effect:

| Effect of the action | Required feedback |
|---|---|
| Reversible, effect visible on screen right now (assign input, inline rename) | Nothing — the UI *is* the feedback |
| Reversible, effect is off-screen (transfer plan, mobile quick-add, another month) | **Toast** |
| Destructive, and a `*WithSnapshot` variant exists | **Toast with an Undo action**, no confirm |
| Moves money without an on-screen number changing (hide category, post a schedule) | **Toast**; add a confirm if the amount is large or unstated |
| Irreversible — no snapshot variant exists | **`ConfirmDialog`**, mandatory |

The mechanical test, which is what makes this reviewable:

- **A server action with a `*WithSnapshot` variant ⇒ its call site must both
  push an undo entry and fire a toast.**
- **A delete with no snapshot variant ⇒ it must sit behind `ConfirmDialog`.**

Both halves are enforced by `__tests__/unit/conventions/system-visibility.test.ts`.
The 34 violations grandfathered there on 2026-07-19 are **all fixed** — the
allowlists are empty as of 2026-07-27, so every rule is enforced outright and
any failure is a violation introduced today. Don't put an entry back to make a
build pass; fix the call site instead.

There is a deliberate exemption worth knowing about, because it looks like a
hole: an un-snapshotted delete whose *every* call in a file is the `backward:`
half of a MutationEntry doesn't need a `ConfirmDialog`. Undoing an add isn't
irreversible — the entry moves to the redo stack — and a confirm in front of
Cmd+Z is a worse app, not a safer one. It's all-or-nothing per file, so one
direct call turns the exemption off.

Supporting rules:

- **Never claim "This action cannot be undone" unless it's true.** If a snapshot
  action exists, the copy says the opposite — tell the user they can undo.
- **Toast-Undo undoes *that* action**, not the top of the stack. `push()`
  returns a `MutationId`; hand it to `undoRedo.undoEntry(id)`. The two obvious
  shortcuts are both wrong: `undo()` pops whatever is on top, which is the wrong
  action as soon as the user does anything else inside the toast's six seconds,
  and calling `backward()` directly leaves the entry on the undo stack, so redo
  never arms and a following Cmd+Z re-runs the same undo.
- **Don't promise Cmd+Z on a page that doesn't mount the handler.** Undo
  affordances are per-page even though the stack is a module singleton.
- **Catch errors outside dialogs too.** A bare `await` inside `startTransition`
  with no `catch` makes failures invisible — the optimistic UI keeps showing a
  value that was never persisted.
- **Don't mutate during a render pass in response to a user action.** A server
  component must never turn a page view into an edit. The one sanctioned
  exception is idempotent catch-up work that is due on wall-clock time rather
  than on anything the user did — `catchUpDueSchedules()` in the `(app)` layout
  is the only instance today. Such a caller must be guarded against repeat
  execution (a `NOT EXISTS` check, not a flag), wrapped in React `cache()` so
  layout + page share one pass, and must pass `revalidate: false`:
  `revalidatePath` throws when called during render, and it's redundant anyway
  because the `(app)` segment is `force-dynamic`. Anything else that writes
  belongs in a server action fired from an event handler.

`app/quick/*` is the reference implementation — every mutation toasts on success
and failure, catches errors, and rolls back optimistic writes. Copy it rather
than inventing a new pattern.

### Styling
- Tailwind CSS v4 (no config file — tokens defined via `@theme inline` in `globals.css`)
- `cn()` from `lib/utils.ts` for class merging (clsx + tailwind-merge)
- Figtree font with feature settings `"cv02", "cv03", "cv04", "cv11"`

## Deployment

- **Production process**: managed by pm2 — `npm run deploy` builds and restarts; app runs at `http://localhost:4040`. Deploys whatever code is in the working directory (branch doesn't matter)
- **Auto-start**: pm2 is configured with launchd to survive reboots (`pm2 startup` + `pm2 save`)
- **Database path**: `ZERO_DB_PATH` env var overrides the default `data/zero.db` location
- **Migrations**: live in `lib/migrations/files/` as numbered `.sql` files (e.g. `001_initial.sql`), run automatically on boot via `runMigrations()` in `lib/migrations/runner.ts`
- **Adding schema changes**: create a new numbered file (e.g. `002_add_column.sql`) — never edit existing migration files
- **Auto-backup**: the migration runner snapshots the database before applying new migrations (saved as `*.pre-migration-vN.backup`)
- **Manual backup**: `npm run backup` creates a timestamped copy in a `backups/` folder next to the database (WAL-safe via `VACUUM INTO`; respects `ZERO_BACKUP_DIR`)
- **Scheduled backup**: cron on the production host runs `npm run backup` every 6 hours; snapshots land in `data/backups/` next to the DB
- **Database info**: `npm run db:info` prints the resolved path, file size, schema version, and row counts
- **Docker**: `docker compose up -d --build` runs the app with `./data` mounted as a volume

### Versioning

Zero uses [semantic versioning](https://semver.org/). There is one source of truth:

- **`package.json` `version`** — `next.config.ts` inlines it at build time, and the sidebar footer shows it (`lib/version.ts`). Bump it there, nowhere else.
- **An annotated git tag `vX.Y.Z`** on the commit that sets it, whose message is a one-line summary of the release (`git tag -n1` lists them).

Before 1.0.0 every release was a minor bump (`v0.1.0`–`v0.9.0`, one per feature wave). From 1.0.0 on: **patch** for fixes, **minor** for new features, **major** for anything that breaks a self-hoster's upgrade — a migration that can't run unattended, a removed env var, or a changed data location.

Old planning notes use milestone labels like "v1.1 May Dogfooding" or "v1.2 OSS readiness". Those were planning names, not versions.

### Repo protection

Protection is local — git hooks plus an off-machine mirror (personal specifics,
if any, live in `CLAUDE.local.md`):

- **Hooks live in `.githooks/`** (tracked), wired up via `core.hooksPath`. A
  fresh clone has **no protection until** `npm run hooks:install` runs — that's
  the one manual step, and it's easy to forget.
- **`pre-push`** rejects deletion and non-fast-forward pushes to `main` only;
  feature branches force-push freely.
- **`pre-commit`** rejects staged `*.db`, `.env*` (bar `.env.example`), backups,
  `YNAB*`, `scripts/historical/`, and any blob over 5 MiB.
- Both are **speed bumps, not locks** — `--no-verify` bypasses either, by design.
- **Open PRs with `/pr`** (`.claude/skills/pr/`). It runs `scripts/scan.sh` — a hard
  scan of the branch's added lines for private IPs, emails, tailnet hosts, home
  paths, DB/env files, and every entry in a gitignored `.privacy-denylist` (your
  real values; the public repo must never contain them) — plus typecheck, lint
  and tests, then reads the whole diff for real money figures, merchants, people
  and real screenshots before opening the PR. Any finding stops it.
  They stop accidents and over-eager agents, not a determined push.
- **`npm run mirror`** (`bin/mirror-push.sh`, run it from cron) pushes
  `--mirror` to the bare repo at `ZERO_MIRROR_URL`. **This is the only real
  undo** — it survives a landed force-push, a bad `reset --hard`, and repo
  deletion. Note `--mirror` propagates deletions too, so recovery after a bad
  push comes from the *mirror's own reflog* (`git --git-dir=<mirror> reflog show
  main`), which is why that repo needs `core.logAllRefUpdates=true` and
  `gc.reflogExpire=never` set explicitly — bare repos disable reflogs by default.
  Setup steps are in the script header.
- Local `gc.reflogExpire`/`gc.reflogExpireUnreachable` are `never`, so a bad
  reset stays recoverable indefinitely instead of expiring at 30/90 days.

### Self-hosting on a remote server

Production can run on another machine — a Raspberry Pi, home server, or VPS —
under pm2, with its own `.env.local` setting `ZERO_DB_PATH` and a cron entry
running `npm run backup`. The dev machine drives it over SSH:

| Tool | Does |
|---|---|
| `/deploy-remote` | Deploys `origin/main`: pull, install, build, `pm2 restart` — refuses if local work is uncommitted or unpushed |
| `/db-switch` | Swaps local `data/zero.db` between the dev fixture and the server's latest backup |
| `/import-txns` | Reconciles a bank statement against the server's DB and inserts the gaps (without a server configured, it uses the local DB — `ZERO_DB_PATH` or `data/zero.db`) |
| `npm run mirror` | `git push --mirror` to a bare repo on the server |

All four read `ZERO_REMOTE_*` / `ZERO_MIRROR_URL` through `bin/remote-env.sh`
(real env first, then `.env.local`; see the self-hosting block in `.env.example`).
There are no built-in defaults — unconfigured, they stop with a setup hint rather
than SSH anywhere. `bin/remote-env.sh` is bash-only, so skills call it from a
script, never inline in the agent's shell.

To run a second, refreshable copy of prod on the same server, add a pm2 process
whose env sets `ZERO_DB_PATH` to a sibling DB (pm2 env beats `.env.local`) and
refresh it with `bin/refresh-test-db.sh`. Never port-forward the app — see
`docs/REMOTE-ACCESS.md`.

Machine-specific hosts, IPs, and paths go in `CLAUDE.local.md` (gitignored), not here.

## Standing constraints

- **No new dependencies** — use what's already in `package.json`
- **Existing patterns** — `*WithSnapshot` server actions, `useUndoRedo`, `mapRow`/`mapRows`, `revalidatePath` after mutations
- **TypeScript strict** — no `any`, no escape-hatch casts
- **Feature flags** — don't touch `FEATURES.RECONCILIATION` or `FEATURES.BANK_SYNC`; `lib/features.ts` explains what they gate and why
- **Schema** — new numbered migration file only, never edit existing

## Non-obvious decisions

Things you can't infer from reading the code:

- **Money is REAL, not integer cents.** A schema-wide rewrite isn't worth it for a single-user app. Pattern: sum raw floats, round only the final display value via `roundCents` in `lib/db-utils.ts`. Never round intermediate sums (50 categories × $0.005 drift = $0.25).
- **Transfer plan is derived state, not stored.** Compute on every page load from current balances + budget engine. Zero never moves money at a bank — a row's record action opens the standard `TransferDialog`, prefilled, to log a transfer the user already made.
- **`actual_balance` is persisted per month, not ephemeral.** This reversed: the original rule said never store it, because a single column would go stale the moment a transaction landed. Migration `007_transfer_plan_actuals` solved that by scoping the value to `(user, month, account)` instead — a typed balance is a statement about *that month's* reconciliation, so it can't go stale the way a global column would. `saveTransferPlanActual` upserts it, `getTransferPlanActuals` seeds the page, and a missing row falls back to `account.current_balance`. Audited again in migrations 014 and 016. Don't "fix" this back to component state.
- **Transfer-plan colors:** `--color-info` (blue) for transfer amounts; `--color-negative` (red) for "not enough"; `--color-positive` (green) for surplus; neutral for buffers.
