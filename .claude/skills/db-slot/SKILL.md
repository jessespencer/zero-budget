---
name: db-slot
description: Switch Zero's local dev DB between three states — onboarding (empty), seeded (demo fixture), and full (your real working data). Use when the user asks to "test onboarding", "switch to the empty DB", "use the seeded data", "go back to my real data", "switch DB state/slot", or runs `/db-slot`. Local-only; does not touch your remote server.
version: 1.0.0
---

# Switch the local dev DB between onboarding / seeded / full

The app reads from `data/zero.db`. This skill swaps that file between three
named slots stored in `data/slots/`:

| Slot | Contents | Use for |
|---|---|---|
| `onboarding` | Empty, migrated (system categories only) | Testing the first-run flow — the budget page shows "Create your first category group" when there are zero user groups |
| `seeded` | The deterministic `seed:dev` fixture | A populated demo (accounts, categories, ~13 months of txns) |
| `full` | Your real working DB, captured from `data/zero.db` | Everyday development against real data |

**`full` is real data and persists** — its edits are saved back to its slot
before any switch away. **`onboarding` and `seeded` are disposable** — switching
to them always loads a pristine copy; edits made while on them are discarded on
the next switch. Use `reset` to regenerate a pristine fixture in place.

The active slot is tracked in `data/slots/.active`. All slot files are
gitignored (they live under `data/`).

## Parsing the user's intent

- "test onboarding", "empty DB", "first-run", "no categories" → **onboarding**
- "seeded", "demo data", "fixture", "fake data" → **seeded**
- "my real data", "full DB", "back to real", "everyday DB" → **full**
- "which DB", "what's loaded", "status" → **status**
- "reset onboarding" / "reset seeded" / "rebuild the fixture" → **reset <slot>**
- empty / ambiguous → run `status` first, then offer choices via `AskUserQuestion`

## Execution

```bash
npm run db:slot <status | onboarding | seeded | full>
npm run db:slot reset <onboarding | seeded>
```

(Equivalently `node scripts/db-slot.mjs <mode>`.) The script is idempotent and
safe: it captures the current live DB into the `full` slot before the first
swap, so a switch can never lose real working data. It also runs a WAL
checkpoint before copying, and clears `-wal`/`-shm` sidecars on load so no stale
journal replays.

## After switching — restart the dev server

The running dev server holds an open handle to the old DB file and will keep
serving stale data until it reconnects. Restart it:

```bash
PORT=3000 npm run dev
```

Run via `Bash` with `run_in_background: true`, then wait for the `Ready` log line
(a short `until grep -qE "Ready|Error"` loop on the output file). If a server is
already running on 3000, stop it first (`lsof -ti:3000 | xargs kill`).

## Report to the user

- Which slot is now live and its one-line summary (the script prints
  `groups / categories / accounts / transactions`)
- That the dev server is back up at http://localhost:3000
- For `onboarding`: remind them the budget page is where the first-run empty
  state renders

## Notes & edge cases

- **First run**: there's no marker yet and no slot files. The first switch
  captures the current `data/zero.db` into the `full` slot automatically, then
  builds the requested slot. Nothing is lost.
- **Building slots is lazy**: a slot file is built the first time you switch to
  it — `onboarding` via migrations, `seeded` via `seed:dev`. Subsequent switches
  just copy the existing file (fast).
- **`reset`** only applies to the disposable slots (`onboarding`, `seeded`).
  There's no reset for `full` — that's real data; refresh it from your server via the
  separate `db-switch` skill if you want newer prod data in it.
- **Relationship to `db-switch`**: `db-switch` swaps `data/zero.db` between a
  local fixture and a remote prod snapshot (a different axis). This skill is a
  local-only three-state toggle. They both write `data/zero.db`; don't run them
  concurrently. If you pull fresh server data via `db-switch`, capture it into the
  `full` slot with `npm run db:slot full` afterward.

## Don't do

- Do not commit anything under `data/` — slot files and the marker are
  gitignored dev state.
- Do not touch the remote server. This skill is entirely local.
