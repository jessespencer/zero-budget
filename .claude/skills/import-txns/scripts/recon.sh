#!/usr/bin/env bash
# Dump an account's current state from Zero's DB so a bank statement can be
# reconciled against it. Account-agnostic: pass the account name as it appears in
# the app (e.g. "Credit union checking", "Chase", "Capital One").
#
# Usage: recon.sh "<Account Name>" [sinceISODate] [limit]
#   sinceISODate  default: 60 days of rows are not assumed — defaults to showing
#                 the most recent <limit> rows regardless of date.
#   limit         default 40
set -euo pipefail

# A quote held in a variable: bash 3.2 (macOS /bin/bash) keeps the backslashes in
# ${x//\'/\'\'}, so a name like "Sam's Club card" became Sam\'\'s and broke the SQL.
Q="'"

. "$(dirname "${BASH_SOURCE[0]}")/db.sh"

ACCOUNT="${1:-}"
SINCE="${2:-}"
LIMIT="${3:-40}"
if [[ -z "$ACCOUNT" ]]; then
  echo "usage: recon.sh \"<Account Name>\" [sinceISODate] [limit]" >&2
  exit 2
fi

# Escape single quotes for SQL embedding.
ACCT_SQL="${ACCOUNT//$Q/$Q$Q}"
WHERE_DATE=""
if [[ -n "$SINCE" ]]; then WHERE_DATE="AND t.date >= '${SINCE//$Q/$Q$Q}'"; fi

echo "db: $ZDB_LABEL" >&2
zdb_sql <<SQL
SELECT 'account', name, 'id', id, 'balance', printf('%.2f', current_balance) FROM accounts WHERE name='$ACCT_SQL';
SELECT 'cutoff(budget_start_month)', value FROM app_settings WHERE key='budget_start_month';
SELECT '--- recent txns (date | amount | cleared | pend | category | payee | memo | id) ---';
SELECT t.date, printf('%.2f', t.amount), t.cleared,
       CASE WHEN t.approved=0 THEN 'PENDING' ELSE '' END,
       coalesce(c.name,'(uncat)'), coalesce(t.payee,''), coalesce(t.memo,''), t.id
FROM transactions t
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.account_id = (SELECT id FROM accounts WHERE name='$ACCT_SQL') $WHERE_DATE
ORDER BY t.date DESC, t.created_at DESC
LIMIT $LIMIT;
SQL
