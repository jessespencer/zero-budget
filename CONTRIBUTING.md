# Contributing to Zero

Thanks for wanting to help. Zero is a small, self-hosted envelope-budgeting app, so a few conventions go a long way. This page covers what you need to open a good pull request.

## Before you start

- **Bugs and small fixes:** go ahead and open a PR.
- **Features or anything that changes how money is calculated:** open an issue first. Zero's budget math, balances, and transfer plan are tightly linked, and a quick conversation saves you from building something that can't merge.
- **Security problems:** don't open a public issue — see [SECURITY.md](SECURITY.md).

## Set up

Zero needs Node 20 or later (CI runs 22).

```bash
git clone <your fork>
cd zero-budget
npm install
cp .env.example .env.local
npm run hooks:install   # pre-commit/pre-push guards — a fresh clone has none until you run this
npm run seed:dev        # throwaway demo data: 4 accounts, a year of transactions ending today
npm run dev             # http://localhost:3000
```

**Never develop against your real budget.** If you use Zero for your own money, keep that database at a stable `ZERO_DB_PATH` outside this checkout and let development use the throwaway `data/zero.db`. `seed:dev` wipes the database it points at (after backing it up), and the pre-commit hook refuses to commit `*.db`, `.env*`, and backups.

`npm run db:slot onboarding` switches to an empty database if you're working on the first-run experience; `npm run db:slot seeded` switches back.

Optional surfaces are gated in `.env.local` (see [.env.example](.env.example)): `NEXT_PUBLIC_ZERO_DEV_MODE` shows the "Dev mode" banner, and `NEXT_PUBLIC_ZERO_HISTORICAL_DATA` turns on the Insights Trends and Patterns tabs, which need a populated `historical_snapshot_entries` table. Both require a rebuild.

### Handy commands

| Command | Does |
|---------|------|
| `npm run dev` | Dev server (Turbopack) on :3000 |
| `npm run build` / `npm start` | Production build / server on :4040 |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm run test:run` | Vitest once (`npm run test` to watch) |
| `npm run test:e2e` | Playwright against a running server (`CI=1` boots its own) |
| `npm run seed:dev` | Wipe the dev DB and load the demo household |
| `npm run db:info` · `npm run db:migrate` | Database path and stats · apply pending migrations |
| `npm run backup` | Timestamped database backup |
| `npm run site` | Serve the website (`site/`) on :4321 |

[CLAUDE.md](CLAUDE.md) lists every command and the architecture; [FEATURES.md](FEATURES.md) describes what the app does.

## Make your change

The full set of conventions lives in [CLAUDE.md](CLAUDE.md). It's written for AI coding agents, but it's the most complete description of how this codebase works, and it applies to humans too. The ones that matter most:

- **Money is stored as REAL, not integer cents.** Sum raw values and round only the final displayed figure (`roundCents`). Never round intermediate sums.
- **Account balances change only through `lib/balance.ts`.** No raw `UPDATE … current_balance`.
- **Every mutation acknowledges itself.** Undoable actions push an undo entry and show a toast; irreversible ones sit behind `ConfirmDialog`. The tests in `__tests__/unit/conventions/` enforce this and will fail your build otherwise — fix the call site rather than working around the test.
- **Use the shared components** in `components/shared/` (pickers, `DateInput`, `ConfirmDialog`, `EmptyState`, `<Currency>`) instead of native inputs or one-off versions.
- **Sentence case** for all UI text: "Add expense", not "Add Expense".
- **Schema changes** go in a new numbered file in `lib/migrations/files/`. Never edit an existing migration.
- **No new dependencies** without discussing it in an issue first.

## Check it

CI runs these on every pull request; run them locally first:

```bash
npm run lint
npm run typecheck
npm run test:run
```

Add or update tests for what you change — Vitest unit tests in `__tests__/unit/`, React Testing Library for components. For flows that only exist in a browser, `CI=1 npm run test:e2e` seeds a temporary database and runs the Playwright suite against its own server.

## Open the pull request

- Keep it to one change. Two unrelated fixes are two PRs.
- Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/) in the imperative mood: `fix: keep the memo on both transfer legs`. Keep the subject under 72 characters.
- Include screenshots or a short recording for anything visible.
- Update `README.md`, `FEATURES.md`, or `CLAUDE.md` in the same PR if your change makes them wrong.

## License

Zero is licensed under [AGPL-3.0-only](LICENSE). By submitting a contribution, you agree that it's licensed under the same terms.
