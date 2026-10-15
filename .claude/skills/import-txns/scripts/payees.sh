#!/usr/bin/env bash
# List the canonical payee names from Zero's DB so bank descriptions can be
# mapped onto names that already exist — the import must NEVER invent a new payee.
# Prints each payee's name, its default category (if any), and how many transactions
# already use it, most-used first so the common ones surface. Optionally filter by a
# substring to find the canonical name for a specific bank line.
#
# Names come from the payees table AND from transaction history. The table is not a
# complete list: imported history wrote transactions.payee without
# creating payee rows, so ~2,000 names — e.g. "Acme Outdoor", "Northwind" — exist only on
# old transactions. A history-only name is still canonical: reuse its exact spelling.
# For those rows `source` is "history" and the category shown is the one the name was
# filed under most often, since there's no stored default. Transfer legs are excluded
# (their payee is a synthetic "Transfer to …" label, and this skill never inserts them).
#
# Usage: payees.sh [substring]
#   substring   case-insensitive LIKE filter on the payee name (optional)
set -euo pipefail

# A quote held in a variable: bash 3.2 (macOS /bin/bash) keeps the backslashes in
# ${x//\'/\'\'}, so a name like "Sam's Club card" became Sam\'\'s and broke the SQL.
Q="'"

. "$(dirname "${BASH_SOURCE[0]}")/db.sh"

FILTER="${1:-}"
WHERE=""
if [[ -n "$FILTER" ]]; then
  F_SQL="${FILTER//$Q/$Q$Q}"
  WHERE="WHERE n.name LIKE '%${F_SQL}%'"
fi

echo "db: $ZDB_LABEL" >&2
zdb_sql -column -header <<SQL
WITH hist AS (
  SELECT payee AS name, category_id, count(*) AS n
  FROM transactions
  WHERE coalesce(payee,'') <> '' AND transfer_account_id IS NULL
  GROUP BY payee, category_id
),
names AS (
  SELECT name FROM payees
  UNION
  SELECT name FROM hist
)
SELECT n.name AS payee,
       coalesce(c.name, hc.name, '') AS category,
       CASE WHEN p.name IS NULL THEN 'history' ELSE 'payees' END AS source,
       coalesce((SELECT sum(h.n) FROM hist h WHERE h.name = n.name), 0) AS uses
FROM names n
LEFT JOIN payees p ON p.name = n.name
LEFT JOIN categories c ON c.id = p.default_category_id
LEFT JOIN categories hc ON hc.id = (
  SELECT h.category_id FROM hist h
  WHERE h.name = n.name AND h.category_id IS NOT NULL
  ORDER BY h.n DESC LIMIT 1)
$WHERE
ORDER BY uses DESC, n.name;
SQL
