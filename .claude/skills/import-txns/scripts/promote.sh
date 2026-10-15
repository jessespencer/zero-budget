#!/usr/bin/env bash
# Promote pending (approved=0) transactions to posted after the bank posts them.
# Flips approved 0->1 and applies each row's held amount to current_balance — the
# amount was deliberately NOT applied at insert time (see build-sql.mjs), so this
# is where a promoted line finally moves the reconciled balance. Cutoff-gated
# (pre-cutoff rows never move the balance, per lib/balance.ts) and idempotent
# (the approved=0 guard makes a re-run a no-op). WAL-safe backup first.
#
# Usage: promote.sh "<Account Name>" <txnId> [<txnId> ...]
#   Grab the ids from recon.sh's output — pending rows show a "PENDING" marker and
#   their id in the last column. Only pass ids that the current statement shows as
#   now-POSTED (i.e. the pending line reconciled against a posted bank line).
set -euo pipefail

# A quote held in a variable: bash 3.2 (macOS /bin/bash) keeps the backslashes in
# ${x//\'/\'\'}, so a name like "Sam's Club card" became Sam\'\'s and broke the SQL.
Q="'"

. "$(dirname "${BASH_SOURCE[0]}")/db.sh"

ACCOUNT="${1:-}"; shift || true
if [[ -z "$ACCOUNT" || "$#" -eq 0 ]]; then
  echo "usage: promote.sh \"<Account Name>\" <txnId> [<txnId> ...]" >&2; exit 2
fi
ACCT_SQL="${ACCOUNT//$Q/$Q$Q}"

# Resolve account id + cutoff; fail loudly on a wrong account name.
# '|', not a space: read collapses whitespace, so a missing account (empty id)
# used to shift the cutoff into ACCT_ID and slip past the check below.
IFS='|' read -r ACCT_ID CUTOFF < <(zdb_sql -separator '|' <<SQL
SELECT (SELECT id FROM accounts WHERE name='$ACCT_SQL'),
       (SELECT value FROM app_settings WHERE key='budget_start_month');
SQL
)
if [[ -z "${ACCT_ID:-}" || "$ACCT_ID" == "" ]]; then
  echo "ERROR: no account named '$ACCOUNT' ($ZDB_LABEL). Run accounts.sh to list them." >&2; exit 1
fi
echo "db: $ZDB_LABEL"
echo "account='$ACCOUNT' id=$ACCT_ID  cutoff=$CUTOFF"

# Build, from the id args (UUIDs — escape quotes defensively): a comma-separated IN
# list for the UPDATEs, and a UNION ALL rowset for validation.
IN=""; WANT=""
for id in "$@"; do
  esc="${id//$Q/$Q$Q}"
  IN+="${IN:+,}'$esc'"
  WANT+="${WANT:+ UNION ALL }SELECT '$esc' AS id"
done

# Validate: every id must currently be a PENDING row on THIS account. Anything else
# (already posted, wrong account, unknown id) aborts before we touch the balance.
BAD=$(zdb_sql <<SQL
SELECT w.id FROM ($WANT) w
WHERE w.id NOT IN (SELECT id FROM transactions WHERE account_id='$ACCT_ID' AND approved=0);
SQL
)
if [[ -n "$BAD" ]]; then
  echo "ERROR: these ids are not pending rows on '$ACCOUNT' (already posted, wrong account, or unknown):" >&2
  printf '  - %s\n' $BAD >&2
  exit 1
fi

# WAL-safe backup before any write.
BK=$(zdb_backup zero-pre-promote)
echo "backup: $BK"

TS="$(date -u +'%Y-%m-%d %H:%M:%S')"
# Apply the held amount (cutoff-gated, rounded to cents once — never intermediate),
# then flip approved. The approved=0 guard in both statements makes this idempotent.
zdb_sql <<SQL
BEGIN;
UPDATE accounts SET current_balance = current_balance + round((
  SELECT COALESCE(SUM(CASE WHEN date >= '$CUTOFF' THEN amount ELSE 0 END), 0)
  FROM transactions
  WHERE approved=0 AND account_id='$ACCT_ID' AND id IN ($IN)
), 2)
WHERE id='$ACCT_ID';
UPDATE transactions SET approved=1, updated_at='$TS'
  WHERE approved=0 AND account_id='$ACCT_ID' AND id IN ($IN);
COMMIT;
SELECT 'promoted', changes();
SELECT 'new_balance', printf('%.2f', current_balance) FROM accounts WHERE id='$ACCT_ID';
SQL
echo "done. Refresh the app. If a balance looks off, restore: $BK"
