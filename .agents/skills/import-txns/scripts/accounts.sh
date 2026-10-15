#!/usr/bin/env bash
# List every account in Zero's DB so an account can be identified when a
# statement (screenshot / file) doesn't name one. Prints name, type, institution,
# and current_balance — the three signals you match a headerless statement against:
# the bank logo/name -> institution, the latest posted balance -> current_balance,
# and the account flavour (checking vs credit_card) -> type.
#
# Usage: accounts.sh [--all]
#   (default) hides archived accounts; pass --all to include them.
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/db.sh"

WHERE="WHERE archived = 0"
if [[ "${1:-}" == "--all" ]]; then WHERE=""; fi

echo "db: $ZDB_LABEL" >&2
zdb_sql -column -header <<SQL
SELECT name,
       type,
       coalesce(institution,'') AS institution,
       printf('%.2f', current_balance) AS balance,
       CASE archived WHEN 1 THEN 'yes' ELSE '' END AS archived
FROM accounts
$WHERE
ORDER BY archived, type, name;
SQL
