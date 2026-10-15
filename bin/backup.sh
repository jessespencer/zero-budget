#!/usr/bin/env bash
set -euo pipefail

# Load .env.local the way Next.js does, so `npm run backup` finds the same
# database the app is using. Without this the script falls back to the relative
# default below, which only resolves when cwd happens to be the repo root with a
# local data/ dir — so a hand-run backup on a host that sets ZERO_DB_PATH in
# .env.local (the Pi, any self-hoster) fails with "database not found".
#
# Real environment wins over the file: cron and pm2 both set ZERO_DB_PATH
# explicitly to target a non-default DB, and that must not be clobbered here.
# Resolved relative to this script, not cwd — the bug is about relative paths.
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env.local"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    case "$key" in ZERO_DB_PATH|ZERO_BACKUP_DIR) ;; *) continue ;; esac
    # Only fill in what the environment hasn't already set.
    [ -n "${!key:-}" ] && continue
    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    export "$key=$value"
  done < "$ENV_FILE"
fi

DB_PATH="${ZERO_DB_PATH:-data/zero.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "Error: database not found at $DB_PATH" >&2
  echo "Set ZERO_DB_PATH if your database is elsewhere." >&2
  exit 1
fi

if ! command -v sqlite3 &>/dev/null; then
  echo "Error: sqlite3 is not installed." >&2
  echo "Install it with: brew install sqlite (macOS) or apt install sqlite3 (Linux)" >&2
  exit 1
fi

BACKUP_DIR="${ZERO_BACKUP_DIR:-$(dirname "$DB_PATH")/backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_PATH="$BACKUP_DIR/zero-$TIMESTAMP.db"

sqlite3 "$DB_PATH" "VACUUM INTO '$BACKUP_PATH'"

echo "Backup created: $BACKUP_PATH"
