#!/usr/bin/env bash
set -euo pipefail

# Refresh a sibling zero-test.db from the live $ZERO_DB_PATH using sqlite3 .backup
# (WAL-safe — handles in-flight writes from the running pm2 process correctly).
#
# Usage:
#   bin/refresh-test-db.sh                  # writes to <dir>/zero-test.db
#   bin/refresh-test-db.sh /path/to/out.db  # writes to the given path
#
# Restart the dev pm2 process after refresh: pm2 restart zero-test

SRC="${ZERO_DB_PATH:-data/zero.db}"
DEST="${1:-$(dirname "$SRC")/zero-test.db}"

if [ ! -f "$SRC" ]; then
  echo "Error: source database not found at $SRC" >&2
  echo "Set ZERO_DB_PATH if your database is elsewhere." >&2
  exit 1
fi

if ! command -v sqlite3 &>/dev/null; then
  echo "Error: sqlite3 is not installed." >&2
  echo "Install it with: brew install sqlite (macOS) or sudo apt install sqlite3 (Linux)" >&2
  exit 1
fi

if [ "$(realpath "$SRC")" = "$(realpath "$DEST" 2>/dev/null || echo "")" ]; then
  echo "Error: source and destination are the same file." >&2
  exit 1
fi

TMP="${DEST}.tmp.$$"
trap 'rm -f "$TMP"' EXIT

sqlite3 "$SRC" ".backup '$TMP'"

# Atomic swap; also wipes any stale WAL/SHM for the destination so the next
# process to open it starts clean.
mv -f "$TMP" "$DEST"
rm -f "${DEST}-wal" "${DEST}-shm"

echo "Refreshed: $DEST (from $SRC)"
