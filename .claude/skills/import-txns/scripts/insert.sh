#!/usr/bin/env bash
# Insert reconciled bank transactions into Zero's DB, transactionally, after a
# WAL-safe backup. Mirrors createTransaction (source='desktop', gated balance update,
# payee default-category upsert). Account-agnostic.
#
# Usage: insert.sh "<Account Name>" <txns.tsv>
# TSV (tab-separated, no header):  date<TAB>payee<TAB>amount<TAB>category<TAB>memo<TAB>cleared
#   date      ISO YYYY-MM-DD (required) — use the date you'd enter in-app, not the bank post date
#   payee     required; must be an EXISTING payee name (check payees.sh). Validated against
#             the DB — unknown names are rejected unless ALLOW_NEW_PAYEES=1.
#   amount    signed REAL — negative outflow, positive inflow (required)
#   category  exact category name (optional; blank => uncategorized). Validated against the DB.
#   memo      optional
#   cleared   0 or 1 (optional, default 0)
set -euo pipefail

# A quote held in a variable: bash 3.2 (macOS /bin/bash) keeps the backslashes in
# ${x//\'/\'\'}, so a name like "Sam's Club card" became Sam\'\'s and broke the SQL.
Q="'"

. "$(dirname "${BASH_SOURCE[0]}")/db.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ACCOUNT="${1:-}"; TSV="${2:-}"
if [[ -z "$ACCOUNT" || -z "$TSV" ]]; then
  echo "usage: insert.sh \"<Account Name>\" <txns.tsv>" >&2; exit 2
fi
[[ -f "$TSV" ]] || { echo "no such file: $TSV" >&2; exit 2; }
ACCT_SQL="${ACCOUNT//$Q/$Q$Q}"

# 1. Resolve account id + cutoff; fail loudly if the account name is wrong.
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

# 2. Validate every non-blank category name exists (prevents silent uncategorized inserts).
CATS=$(awk -F'\t' 'NF>=4 && $4!="" && $1!~/^#/ {print $4}' "$TSV" | sort -u)
if [[ -n "$CATS" ]]; then
  MISSING=""
  while IFS= read -r c; do
    [[ -z "$c" ]] && continue
    c_sql="${c//$Q/$Q$Q}"
    found=$(echo "SELECT 1 FROM categories WHERE name='$c_sql' LIMIT 1;" | zdb_sql)
    [[ "$found" == "1" ]] || MISSING+="  - $c"$'\n'
  done <<< "$CATS"
  if [[ -n "$MISSING" ]]; then
    echo "ERROR: these category names don't exist in the DB:" >&2
    printf '%s' "$MISSING" >&2
    echo "Fix the TSV (exact names) or leave the category blank to insert uncategorized." >&2
    exit 1
  fi
fi

# 2b. Validate every non-blank payee already exists (no new payees — map onto the
#     canonical list from payees.sh). Override with ALLOW_NEW_PAYEES=1 for a genuine
#     brand-new payee. A name that only appears in transaction history counts as
#     existing (payees.sh lists those too); inserting it creates its payees row.
if [[ "${ALLOW_NEW_PAYEES:-0}" != "1" ]]; then
  PAYEES=$(awk -F'\t' 'NF>=2 && $2!="" && $1!~/^#/ {print $2}' "$TSV" | sort -u)
  if [[ -n "$PAYEES" ]]; then
    MISSING_P=""
    while IFS= read -r p; do
      [[ -z "$p" ]] && continue
      p_sql="${p//$Q/$Q$Q}"
      found=$(echo "SELECT 1 WHERE EXISTS (SELECT 1 FROM payees WHERE name='$p_sql') OR EXISTS (SELECT 1 FROM transactions WHERE payee='$p_sql' AND transfer_account_id IS NULL);" | zdb_sql)
      [[ "$found" == "1" ]] || MISSING_P+="  - $p"$'\n'
    done <<< "$PAYEES"
    if [[ -n "$MISSING_P" ]]; then
      echo "ERROR: these payee names don't exist in the DB (map onto an existing name):" >&2
      printf '%s' "$MISSING_P" >&2
      echo "Run payees.sh [substring] to find the canonical name, or set ALLOW_NEW_PAYEES=1 to add a genuinely new payee." >&2
      exit 1
    fi
  fi
fi

# 3. WAL-safe backup before any write.
BK=$(zdb_backup zero-pre-import)
echo "backup: $BK"

# 4. Build SQL locally (uuids, escaping, gated balance) and apply it.
SQL=$(node "$HERE/build-sql.mjs" "$ACCOUNT" "$CUTOFF" < "$TSV")
echo "$SQL" | zdb_sql
echo "done. Refresh the app to see the new rows. If a balance looks off, restore: $BK"
