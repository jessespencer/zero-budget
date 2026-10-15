# Shared config for the remote self-hosting tooling — sourced, never run.
#
# Used by the deploy-remote / db-switch / import-txns skill scripts and
# bin/mirror-push.sh. Nothing here has a personal default: a fresh clone that
# hasn't configured a server gets a clear error instead of SSHing to someone
# else's address.
#
# Values come from the real environment first, then .env.local — same rule as
# bin/backup.sh, so cron and one-off overrides still win. .env.local is
# resolved relative to this file, not cwd.
#
#   ZERO_REMOTE_HOST          ssh target, e.g. me@192.168.1.50 or an ~/.ssh/config alias
#   ZERO_REMOTE_DIR           checkout on the server (default: zero, i.e. ~/zero)
#   ZERO_REMOTE_DB_PATH       absolute path to the production DB on the server
#   ZERO_REMOTE_BACKUP_DIR    absolute path to its backups (default: backups/ next to the DB)
#   ZERO_REMOTE_PM2_NAME      pm2 process to restart on deploy (default: zero)
#   ZERO_REMOTE_URL           app URL, only used in deploy reports (optional)
#   ZERO_MIRROR_URL           git URL of the bare mirror repo (bin/mirror-push.sh only)

ZERO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_zero_env_file="$ZERO_ROOT/.env.local"
if [ -f "$_zero_env_file" ]; then
  while IFS= read -r _zero_line || [ -n "$_zero_line" ]; do
    case "$_zero_line" in ''|'#'*) continue ;; esac
    _zero_key="${_zero_line%%=*}"
    case "$_zero_key" in ZERO_REMOTE_*|ZERO_MIRROR_*) ;; *) continue ;; esac
    # Only fill in what the environment hasn't already set.
    [ -n "${!_zero_key:-}" ] && continue
    _zero_value="${_zero_line#*=}"
    _zero_value="${_zero_value%\"}"; _zero_value="${_zero_value#\"}"
    _zero_value="${_zero_value%\'}"; _zero_value="${_zero_value#\'}"
    export "$_zero_key=$_zero_value"
  done < "$_zero_env_file"
fi
unset _zero_env_file _zero_line _zero_key _zero_value

export ZERO_REMOTE_DIR="${ZERO_REMOTE_DIR:-zero}"
export ZERO_REMOTE_PM2_NAME="${ZERO_REMOTE_PM2_NAME:-zero}"
if [ -z "${ZERO_REMOTE_BACKUP_DIR:-}" ] && [ -n "${ZERO_REMOTE_DB_PATH:-}" ]; then
  export ZERO_REMOTE_BACKUP_DIR="$(dirname "$ZERO_REMOTE_DB_PATH")/backups"
fi

# require_remote VAR... — exit with a setup hint if any named variable is empty.
require_remote() {
  # A plain string, not an array: macOS bash 3.2 treats an empty array as
  # unbound under `set -u`.
  local missing="" var
  for var in "$@"; do
    [ -z "${!var:-}" ] && missing="$missing $var"
  done
  [ -z "$missing" ] && return 0
  echo "ERROR: not configured for a remote server — missing$missing." >&2
  echo "  Add them to .env.local (see the self-hosting block in .env.example)." >&2
  exit 1
}
