---
name: pr
description: Open a pull request for the current branch only after a privacy review and the repo's checks pass. Use when the user says "/pr", "open a PR", "make a PR", "ship this", or "send this up for review". Runs a hard privacy scan (private IPs, emails, tailnet hosts, home paths, DB/env files, and a personal .privacy-denylist), typecheck, lint and unit tests, then reads the whole diff for personal details a scan can't catch — real money figures, merchants, account and family names, real screenshots or fixtures. Stops on any finding instead of opening the PR.
---

# Open a PR, privately safe

Zero is open source and the author budgets their real family with it. Every
change gets read for anything that would tell a stranger about that family
before it leaves this machine. A finding **stops** the PR: report it and let
the user decide. Never open the PR over a finding, and never "fix" one by
rewording without showing the user what changed.

## 1. Preflight

```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
git fetch origin main
git log --oneline origin/main..HEAD
```

- **On `main`?** Stop — branch first (`claude/<topic>` or the user's prefix).
- **Uncommitted changes?** Ask whether they belong in this PR. Commit them
  (Conventional Commits, imperative, under 72 chars) or leave them out — the
  review below only covers what's committed.
- **Nothing ahead of `origin/main`?** Nothing to open.

## 2. Hard checks — any failure stops

```bash
bash .agents/skills/pr/scripts/scan.sh origin/main
npm run typecheck
npm run lint
npm run test:run
```

`scan.sh` checks every added line for private IPs (bar the documented
placeholders), tailnet hostnames, email addresses (bar no-reply and example
ones), paths inside a home directory, added `.db`/`.env`/backup files, and
every entry in `.privacy-denylist`. It prints **where**, never the matched
value — don't echo it back either.

If it reports `denylist: none`, say so: the scan then only knows the generic
patterns. The denylist is a gitignored file at the repo root (or the main
checkout's root) with one private value per line — the server's IP, tailnet
name, personal email, real account nicknames, family names, employer.

If the change touches `.agents/skills/`, also run `npm run codex:sync -- --check`
(the Codex mirror must match).

## 3. Privacy read — the part a scan can't do

Read the **whole** diff, including comments, tests, fixtures, docs and commit
messages:

```bash
git diff origin/main...HEAD
git log --format='%h %s%n%b' origin/main..HEAD
git diff --stat origin/main...HEAD   # spot binaries: images, CSVs, DB-shaped files
```

Flag anything that describes **the author's real life or data**:

| Look for | Example of a leak | Fine |
|---|---|---|
| Real money | "a +$27,500 boat sale", "the card opened at −$8,412.17", "$61,930 over 2015–2024", counts of real transactions | Round illustrative numbers; `seed:dev` demo values; format examples like `$1,234.56` |
| Real merchants / payees / institutions tied to the author | "those rows were Acme Hardware, Craft Barn…" (when they're the author's real ones) | Generic examples (`Roasters Coffee`, `Sunrise Grocery`, `KROGER #1234` in a made-up CSV) |
| People | names, "my wife", kids' names or ages, employer, town, street | The public `jessedestroys.com` credit |
| Infrastructure | real hosts, IPs, ssh targets, tailnet names, paths under a home dir | `me@192.168.1.50`, `tail-abcd.ts.net`, `<main-checkout>` placeholders |
| Data-bearing files | screenshots of a real budget, CSV/JSON fixtures exported from real accounts, any database | Screenshots from `npm run site:assets` against the `seed:dev` household (Everyday Checking, High Yield Savings, Visa Card, Wallet) |
| Private planning | `.planning/` content, notes-repo links, private issue links | — |

For changed images, open them and confirm they show the demo household.
Comments explaining a bug are the classic leak: "seen in prod: <real figure>".
Keep the engineering point, drop the specific — "a card opened with a large
debt and RTA was off by exactly that amount".

## 4. Repo conventions

- PR title: Conventional Commit (`feat:`, `fix:`, `chore:`, `refactor:`,
  `test:`, `docs:`), imperative, under 72 chars.
- Docs current in the same PR: AGENTS.md for a changed command, directory,
  entry point or convention; README for install, usage, features or env vars.
- Money, balances or the budget engine touched? Say so in the summary and
  call out how it was verified (AGENTS.md: "Balance writes go through
  `lib/balance.ts`", money is REAL — round only at display).

## 5. Report, then open

If anything in steps 2–4 turned up, **stop**: list each finding (file:line and
what kind, without repeating a private value) and ask how to proceed.

When clean:

```bash
git push -u origin HEAD
gh pr create --title "<title>" --body "<body>"
```

The body: what changed and why, how it was tested, and a final line:

```
Privacy review: clean — scan (IPs, emails, tailnet, home paths, DB/env files, denylist: found|none), full diff read for money, merchants, people, infrastructure, screenshots/fixtures.
```

End with the attribution line the session asks for, then report the PR link.
