# Which database the import-txns scripts read and write — sourced, never run.
#
# Remote mode: ZERO_REMOTE_HOST is set (environment or .env.local) — every query
#   runs over ssh against ZERO_REMOTE_DB_PATH on that server, the setup for a
#   Pi/home server/VPS. Backups land in ZERO_REMOTE_BACKUP_DIR.
# Local mode: no server configured — the DB on this machine: ZERO_DB_PATH
#   (environment or .env.local, relative paths resolved from the repo root),
#   else data/zero.db. Backups land in ZERO_BACKUP_DIR, else backups/ next to it.
#   ZERO_IMPORT_LOCAL=1 forces local mode even when a server is configured.
#
# Exposes:
#   zdb_sql [sqlite3 flags...]   run SQL from stdin against the DB
#   zdb_backup <name-prefix>     WAL-safe VACUUM INTO backup; prints its path
#   ZDB_LABEL                    where the DB is, for messages

. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/bin/remote-env.sh"

if [ -n "${ZERO_REMOTE_HOST:-}" ] && [ "${ZERO_IMPORT_LOCAL:-0}" != "1" ]; then
  require_remote ZERO_REMOTE_HOST ZERO_REMOTE_DB_PATH
  ZDB_MODE=remote
  ZDB_PATH="$ZERO_REMOTE_DB_PATH"
  ZDB_BACKUP_DIR="$ZERO_REMOTE_BACKUP_DIR"
  ZDB_LABEL="$ZERO_REMOTE_HOST:$ZDB_PATH"
else
  # Same .env.local rule as bin/backup.sh: the real environment wins.
  if [ -f "$ZERO_ROOT/.env.local" ]; then
    while IFS= read -r _zdb_line || [ -n "$_zdb_line" ]; do
      case "$_zdb_line" in ''|'#'*) continue ;; esac
      _zdb_key="${_zdb_line%%=*}"
      case "$_zdb_key" in ZERO_DB_PATH|ZERO_BACKUP_DIR) ;; *) continue ;; esac
      [ -n "${!_zdb_key:-}" ] && continue
      _zdb_value="${_zdb_line#*=}"
      _zdb_value="${_zdb_value%\"}"; _zdb_value="${_zdb_value#\"}"
      _zdb_value="${_zdb_value%\'}"; _zdb_value="${_zdb_value#\'}"
      export "$_zdb_key=$_zdb_value"
    done < "$ZERO_ROOT/.env.local"
    unset _zdb_line _zdb_key _zdb_value
  fi
  ZDB_MODE=local
  ZDB_PATH="${ZERO_DB_PATH:-data/zero.db}"
  case "$ZDB_PATH" in /*) ;; *) ZDB_PATH="$ZERO_ROOT/$ZDB_PATH" ;; esac
  ZDB_BACKUP_DIR="${ZERO_BACKUP_DIR:-$(dirname "$ZDB_PATH")/backups}"
  ZDB_LABEL="local $ZDB_PATH"
  if [ ! -f "$ZDB_PATH" ]; then
    echo "ERROR: no database at $ZDB_PATH." >&2
    echo "  Set ZERO_DB_PATH to the database Zero uses, or ZERO_REMOTE_HOST/ZERO_REMOTE_DB_PATH" >&2
    echo "  if it runs on another machine (see the self-hosting block in .env.example)." >&2
    exit 1
  fi
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "ERROR: sqlite3 is not installed — brew install sqlite (macOS) or apt install sqlite3 (Linux)." >&2
    exit 1
  fi
fi

# The app may hold the DB open (WAL); wait out a brief write lock instead of failing.
zdb_sql() {
  if [ "$ZDB_MODE" = remote ]; then
    local cmd="sqlite3 -cmd '.timeout 5000'" arg
    for arg in "$@"; do cmd+=" $(printf '%q' "$arg")"; done
    ssh -o ConnectTimeout=10 "$ZERO_REMOTE_HOST" "$cmd $(printf '%q' "$ZDB_PATH")"
  else
    sqlite3 -cmd '.timeout 5000' "$@" "$ZDB_PATH"
  fi
}

zdb_backup() {
  local bk="$ZDB_BACKUP_DIR/$1-$(date +%Y%m%d-%H%M%S).db"
  if [ "$ZDB_MODE" = remote ]; then
    ssh -o ConnectTimeout=10 "$ZERO_REMOTE_HOST" "mkdir -p $(printf '%q' "$ZDB_BACKUP_DIR")" >&2
  else
    mkdir -p "$ZDB_BACKUP_DIR"
  fi
  echo "VACUUM INTO '$bk';" | zdb_sql
  echo "$bk"
}
