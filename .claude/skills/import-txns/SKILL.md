---
name: import-txns
description: Reconcile a bank/credit-card statement (screenshot, CSV, or pasted text) against Zero's DB — on your self-hosted server if one is configured, otherwise the local one — for a given account, find the gaps, and insert the missing transactions safely. Use when the user shares a statement and asks to "check these against the db", "fill the gaps", "import these transactions", "reconcile <account>", or runs `/import-txns`. Account-agnostic — works for any account by name.
version: 1.5.0
---

# Import / reconcile bank transactions into Zero's DB

Given a statement for **any one account**, compare it to what's already in Zero's DB,
identify only the genuinely missing rows, and insert them — mirroring the app's
`createTransaction` so balances stay correct.

**Which DB** (`scripts/db.sh` decides; every script prints a `db:` line — check it):
- **Server configured** (`ZERO_REMOTE_HOST`): the server's DB (`ZERO_REMOTE_DB_PATH`) is
  the source of truth. A local `data/zero.db` is then usually a stale snapshot, so never
  reconcile against it.
- **No server**: the local DB Zero runs on — `ZERO_DB_PATH`, else `data/zero.db`. This is
  the normal case for someone running Zero on their own computer.

This task is mostly judgment (the matching), with a small mechanical core (backup +
insert). The scripts handle the mechanical part; you do the matching.

## Workflow

### 1. Identify the account
Get the account **name** from the user (or infer from the statement). Everything is keyed
by name — never hardcode one account. If unsure which accounts exist, run `recon.sh` with a
guessed name; a wrong name prints an empty account line.

**If the screenshot / uploaded file doesn't name an account** (no bank header, just a list
of transactions and a balance — common with cropped screenshots and raw CSV exports),
**don't guess silently.** Confirm against the DB first:

```bash
bash .claude/skills/import-txns/scripts/accounts.sh        # add --all to include archived
```
This lists every account's `name | type | institution | balance`. Use the statement's own
clues to narrow it, in order of strength:

- **Latest posted balance** — the strongest signal. The account whose `current_balance` lands
  closest to (or one-or-two recent txns away from) the statement's latest posted balance is
  almost certainly the one. An exact match is a near-certain hit.
- **Institution / bank brand** — a Chase logo or "Capital One" footer ↔ the account's
  `institution` column.
- **Account flavour** — purchases-and-payments with a running negative ↔ `credit_card`;
  deposits-and-debits ↔ `checking`/`savings`; the cash envelope ↔ `cash`.

Then **state your inference and confirm with the user before doing anything else** — e.g.
"No account name on this screenshot; the $1,243.18 ending balance and the card-payment lines
match **Chase** (credit_card). Reconcile against Chase?" Never run `insert.sh` against an
account you only inferred — a wrong account silently corrupts the wrong balance. If nothing
matches cleanly, list the top candidates and ask the user to pick.

### 2. Pull current DB state
```bash
bash .claude/skills/import-txns/scripts/recon.sh "<Account Name>" [sinceISODate] [limit]
```
Prints the account's id, **current_balance**, the **cutoff** (`budget_start_month`), and recent
rows (date | amount | cleared | **pend** | category | payee | memo | **id**). The `pend` column
shows `PENDING` for any row still held as not-yet-posted (approved=0); the `id` is what you feed
`promote.sh` once such a row posts. Read the statement's running **balance column** too — it's
the strongest reconciliation signal.

### 3. Reconcile — match each statement line to a DB row
Mark each statement line as **present** or **missing**. Watch for these real-world gaps
between a bank feed and a hand-kept envelope ledger (all seen in practice):

- **Posting date vs entry date** — the user often dates a txn 1 day *before* the bank posts
  it (e.g. bank "Jun 4" ↔ DB "2026-06-03"). Match on amount + proximity, not exact date.
- **Payee aliases** — bank "PAYPAL *MARKETPLACE" ↔ DB "Etsy"; bank "CHASE CREDIT CRD"
  ↔ DB "Transfer to Chase". Match on amount; the user's payee name wins.
- **Combined entries** — multiple bank lines folded into one DB row (e.g. bank "$200 deposit"
  + "$7 coin redemption" ↔ one DB "Cash $207"). Sum to reconcile; don't re-add the parts.
- **Transfers** — bank "ONLINE PMT … CAPITAL ONE" is a DB transfer, already two-sided. Do
  **not** re-insert transfers through this skill (they need the in-app transfer flow).
- **Previously-pending rows that have now posted** — a `PENDING` row in `recon.sh` output that
  now appears as a *posted* line on the statement isn't a gap and isn't a duplicate: it's an
  already-inserted pending row whose money was held out of the balance. **Promote it, don't
  re-insert it** (step 5b). Match it to the posted line by amount + payee; note its `id`.
- **Balance check** — after accounting for matches, the DB `current_balance` plus the sum of
  the truly-missing **posted** lines must equal the statement's latest **posted** balance.
  Pending lines (below) are held out of the balance, so they do **not** enter this check. If it
  doesn't reconcile, stop and re-examine — a mismatch means a bad match, not a new gap.

The genuinely-missing **posted** rows are the gaps → insert normally (step 5). A statement line
still marked **pending** (hasn't posted) is optional — confirm with the user, then insert it
**flagged pending** (step 5, `pending` column = `1`) so it surfaces in the app's pending section
and is held out of the balance until it posts. On the *next* reconcile it'll show as posted →
promote it (step 5b) instead of re-inserting.

> ⚠️ **CSV exports are not authoritative — the web/app view is.** Chase's CSV export has been
> observed to silently drop posted transactions (e.g. a subscription charge, a second
> same-amount restaurant charge, and an online order all missing from one export). When the user also provides a
> screenshot/web view, **diff the web view against the DB as the source of truth** and treat
> the CSV as a convenience only. A reliable check: transcribe the web rows (charge = negative,
> return = positive — the web shows the *opposite* sign from the CSV/DB), then multiset-match by
> amount against the DB window. Remember combined entries (e.g. three returns to one store folded
> into one `+274.00` row) will look "missing" but aren't — sum before flagging.

> ⚠️ **The balance can run ahead of the transaction list.** A statement's balance is
> sometimes updated before its own posted-transaction list renders the rows behind it, so an
> export taken in that gap is short by charges that post minutes later (seen in practice: a
> card export's balance included a gas charge and a fast-food charge that appeared in no
> posted group in the same export). **Direction is the tell.** If the DB comes up short
> against the statement balance by an amount you cannot find anywhere in the row list, the
> delta is *newer* than the export, not older — re-pull the statement before concluding
> anything is missing, and never go spelunking through months of history for it. Contrast the
> drop-rows case above, where the missing row *is* in the account's history and a diff finds
> it. Both are caught the same way, by the balance check in step 3 — which is exactly why that
> check is not optional: a row-by-row diff against an export can never surface a row the
> export itself omits.

### 4. Pick payee + category for each gap
- **Payee must be an EXISTING canonical name — never invent a new one.** Map each bank
  description onto a name that's already in the DB:
  ```bash
  bash .claude/skills/import-txns/scripts/payees.sh              # full canonical list, most-used first
  bash .claude/skills/import-txns/scripts/payees.sh "costco"     # filter to find the right name
  ```
  Bank descriptions are noisy (`SQ *BLUE BOTTLE`, `TST* CORNER TAQUERIA`, `AMZN Mktp US`) — resolve
  them to the user's existing payee (`Blue Bottle`, `Corner Taqueria`, `Amazon`). `insert.sh` **rejects
  any payee not already in the DB**, so an unmapped/misspelled name fails loudly rather than
  creating a duplicate. If a line is genuinely a brand-new payee, surface it to the user and
  confirm before adding it with `ALLOW_NEW_PAYEES=1`.
  Strip processor prefixes before searching (`SP ACME OUTDOOR` → `acme`, `SP NORTHWIND` →
  `north`). The list includes names that exist only in transaction history (`source` =
  `history` — imported history rows never got payee records); those are canonical
  too, so reuse the exact spelling, and the category shown is the one it was filed under most.
- Category must be the **exact** category name. Reuse the obvious envelope when the name makes
  it unambiguous (e.g. a `CITY WATER UTIL` charge → "Utilities"). When unsure, leave it blank
  (uncategorized) — the app's uncategorized banner surfaces it for the user.

### 5. Build the TSV and insert
One row per gap, tab-separated, no header:
```
date<TAB>payee<TAB>amount<TAB>category<TAB>memo<TAB>cleared<TAB>pending
```
- `date` ISO `YYYY-MM-DD` — use the date you'd enter in-app (match the user's day-before habit if present)
- `amount` signed REAL: negative = outflow, positive = inflow
- `category`/`memo`/`cleared` optional (cleared defaults 0)
- `pending` optional 7th col — set to `1` for a not-yet-posted line. A pending row inserts with
  `approved=0` (surfaces in the app's pending section), forces `cleared=0`, and is **held out of
  `current_balance`** until it posts. Leave blank/`0` for normal posted rows. Don't set both
  `cleared=1` and `pending=1` — pending wins and forces cleared 0.

```bash
bash .claude/skills/import-txns/scripts/insert.sh "<Account Name>" /tmp/gaps.tsv
```
`insert.sh` resolves the account + cutoff, **validates every category name exists**, takes a
**WAL-safe backup** (`VACUUM INTO …/backups/zero-pre-import-*.db`), then applies all rows in
one transaction: insert (`source='desktop'`, `approved` per the `pending` flag), gated
`current_balance` update (only **posted** rows dated ≥ cutoff move the balance — see
`lib/balance.ts`), and a COALESCE payee default-category upsert. It prints the new balance.

### 5b. Promote pending rows that have now posted
When this reconcile shows a previously-`PENDING` row (from `recon.sh`) as a posted line, promote
it — flip `approved=1` and apply its held amount to the balance now (cutoff-gated). Pass the row
`id`(s) from recon output:
```bash
bash .claude/skills/import-txns/scripts/promote.sh "<Account Name>" <txnId> [<txnId> ...]
```
`promote.sh` validates each id is currently a pending row on that account, takes a **WAL-safe
backup** (`zero-pre-promote-*.db`), then in one transaction applies the summed held amount
(rounded once) and flips the rows to approved. It's **idempotent** — re-running promotes 0 and
leaves the balance unchanged. It prints the new balance.

### 6. Verify
Confirm the printed `new_balance` equals the statement's latest posted balance (pending rows,
being held out, are excluded from that figure by design). Tell the user to refresh the app. If
anything's wrong, restore the printed backup path.

## Invariants (don't break these)
- **Money is REAL floats** — sum raw amounts, round only the final balance delta to cents
  (`build-sql.mjs` / `promote.sh` do this). Never round intermediate sums.
- **Always back up before writing** — `insert.sh` and `promote.sh` both do; never write without it.
- **Balance gate** — pre-cutoff dates must not move `current_balance`. The scripts handle it;
  don't add raw `UPDATE current_balance` elsewhere.
- **Pending is held out of the balance** — a `pending=1` insert must NOT move `current_balance`;
  only `promote.sh` applies it, once, when the line posts. So a pending line's money hits the
  balance exactly once (at promote), never zero or twice. `current_balance` always equals the
  statement's latest **posted** balance, never posted+pending.
- **Account-agnostic** — account name is always a parameter. No hardcoded account.
- **No new payees** — every payee maps onto an existing canonical name (`payees.sh`). `insert.sh`
  rejects unknown names; only override with `ALLOW_NEW_PAYEES=1` after confirming with the user.

## Config
Read from the environment or `.env.local` (environment wins). Nothing is required: with no
server configured the scripts use the local DB. Needs the `sqlite3` CLI.
- **Local:** `ZERO_DB_PATH` (default `data/zero.db`, relative to the repo root) and
  `ZERO_BACKUP_DIR` (default `backups/` next to the DB) — same as `npm run backup`.
- **Server** (see the self-hosting block in `.env.example`): `ZERO_REMOTE_HOST` — ssh
  target; `ZERO_REMOTE_DB_PATH` — absolute path to the DB on it (required once a host is
  set); `ZERO_REMOTE_BACKUP_DIR` (default `backups/` next to it).
- `ZERO_IMPORT_LOCAL=1` — use the local DB even when a server is configured (testing).
