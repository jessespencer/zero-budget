#!/usr/bin/env bash
set -euo pipefail

# db-switch — swap the active Zero DB between local dev and a production snapshot
# pulled from your self-hosted server
#
# Usage:
#   swap.sh status      Show which DB is currently active
#   swap.sh remote      Pull the server's latest cron snapshot and make it active (alias: pi)
#   swap.sh local       Restore the stashed local dev DB
#   swap.sh refresh     Re-pull a fresh snapshot (only if already on a remote snapshot)
#
# Files managed:
#   data/zero.db                  Active DB (whatever the app reads)
#   data/zero.db.dev              Stashed local dev fixture (your iteratively-edited DB)
#   data/zero.db.source           Marker — "local" or "remote-YYYYMMDD-HHMMSS:<snapshot>"
#                                 (older markers say "pi-…"; both count as remote)
#
# Server access comes from bin/remote-env.sh (ZERO_REMOTE_HOST plus
# ZERO_REMOTE_BACKUP_DIR, or ZERO_REMOTE_DB_PATH to derive it). Snapshots are the
# zero-YYYYMMDD-HHMMSS.db files `npm run backup` writes there (cron, VACUUM INTO).

. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/bin/remote-env.sh"
ACTIVE="data/zero.db"
DEV_STASH="data/zero.db.dev"
SOURCE_MARKER="data/zero.db.source"

cmd="${1:-status}"
[ "$cmd" = "pi" ] && cmd="remote"

if [ ! -d "data" ]; then
  echo "ERROR: data/ directory not found — run from the project root." >&2
  exit 1
fi

current_source() {
  if [ -f "$SOURCE_MARKER" ]; then
    cat "$SOURCE_MARKER"
  else
    echo "unknown"
  fi
}

stop_dev() {
  # Best-effort kill of anything on port 3000. Quiet failure if nothing there.
  local pids
  pids=$(lsof -ti:3000 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
    # Force-kill leftovers
    pids=$(lsof -ti:3000 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -9 2>/dev/null || true
      sleep 1
    fi
    echo "✓ stopped dev server on :3000"
  fi
}

pull_remote() {
  local refreshing="${1:-false}"
  require_remote ZERO_REMOTE_HOST ZERO_REMOTE_BACKUP_DIR
  local host="$ZERO_REMOTE_HOST" backup_dir="$ZERO_REMOTE_BACKUP_DIR"

  echo "→ fetching latest cron snapshot filename from $host"
  local remote_file
  remote_file=$(ssh -o ConnectTimeout=5 "$host" "ls -t $backup_dir/zero-*.db 2>/dev/null | head -1") || {
    echo "ERROR: SSH to $host failed (network? VPN? key?)" >&2
    exit 1
  }
  if [ -z "$remote_file" ]; then
    echo "ERROR: no cron backups found in $backup_dir on $host" >&2
    exit 1
  fi
  local snapshot_name
  snapshot_name=$(basename "$remote_file")
  echo "  snapshot: $snapshot_name"

  echo "→ computing remote checksum"
  local remote_sha
  remote_sha=$(ssh "$host" "sha256sum $remote_file" | awk '{print $1}')

  # Stash the current active DB as the dev fixture ONLY if we're currently on local.
  # If we're already on a remote snapshot (refresh case), don't touch the dev stash.
  if [ "$refreshing" = "false" ] && [ -f "$ACTIVE" ]; then
    local src
    src=$(current_source)
    if [[ "$src" == "local" || "$src" == "unknown" ]]; then
      echo "→ stashing current active DB as $DEV_STASH"
      cp "$ACTIVE" "$DEV_STASH"
    fi
  fi

  echo "→ scp $snapshot_name → data/zero.db.remote-pull"
  scp -q "$host:$remote_file" data/zero.db.remote-pull

  echo "→ verifying checksum"
  local local_sha
  local_sha=$(shasum -a 256 data/zero.db.remote-pull | awk '{print $1}')
  if [ "$remote_sha" != "$local_sha" ]; then
    echo "ERROR: checksum mismatch — aborting (file at data/zero.db.remote-pull)" >&2
    exit 1
  fi
  echo "  ✓ $remote_sha"

  echo "→ swapping in"
  mv data/zero.db.remote-pull "$ACTIVE"
  rm -f "$ACTIVE-wal" "$ACTIVE-shm"
  echo "remote-$(date +%Y%m%d-%H%M%S):$snapshot_name" > "$SOURCE_MARKER"

  echo ""
  echo "✓ Active DB is now remote snapshot: $snapshot_name"
  sqlite3 "$ACTIVE" "SELECT 'accounts:' || COUNT(*) FROM accounts UNION ALL SELECT 'transactions:' || COUNT(*) FROM transactions UNION ALL SELECT 'schema:' || version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1;" 2>/dev/null | sed 's/^/  /'
}

restore_local() {
  if [ ! -f "$DEV_STASH" ]; then
    echo "ERROR: no stashed dev DB at $DEV_STASH" >&2
    echo "  (this is normal if you've never run 'db-switch remote' — your local IS your dev DB)" >&2
    exit 1
  fi

  echo "→ restoring local dev DB from $DEV_STASH"
  cp "$DEV_STASH" "$ACTIVE"
  rm -f "$ACTIVE-wal" "$ACTIVE-shm"
  echo "local" > "$SOURCE_MARKER"

  echo ""
  echo "✓ Active DB is now your local dev fixture"
  sqlite3 "$ACTIVE" "SELECT 'accounts:' || COUNT(*) FROM accounts UNION ALL SELECT 'transactions:' || COUNT(*) FROM transactions;" 2>/dev/null | sed 's/^/  /'
}

show_status() {
  echo "Active DB:    $ACTIVE"
  if [ -f "$ACTIVE" ]; then
    echo "  size:       $(du -h $ACTIVE | cut -f1)"
    echo "  modified:   $(stat -f '%Sm' $ACTIVE 2>/dev/null || stat -c '%y' $ACTIVE 2>/dev/null)"
    sqlite3 "$ACTIVE" "SELECT '  accounts:    ' || COUNT(*) FROM accounts UNION ALL SELECT '  transactions: ' || COUNT(*) FROM transactions;" 2>/dev/null
  else
    echo "  (file not present)"
  fi
  echo ""
  echo "Source marker: $(current_source)"
  echo ""
  if [ -f "$DEV_STASH" ]; then
    echo "Stashed local dev DB: $DEV_STASH"
    echo "  size:               $(du -h $DEV_STASH | cut -f1)"
    echo "  modified:           $(stat -f '%Sm' $DEV_STASH 2>/dev/null || stat -c '%y' $DEV_STASH 2>/dev/null)"
  else
    echo "Stashed local dev DB: (none — first 'db-switch remote' will create it)"
  fi
}

case "$cmd" in
  status)
    show_status
    ;;
  remote)
    stop_dev
    pull_remote false
    echo ""
    echo "→ ready. Restart dev server (PORT=3000 npm run dev) to load the new DB."
    ;;
  refresh)
    src=$(current_source)
    if [[ "$src" != remote-* && "$src" != pi-* ]]; then
      echo "ERROR: not currently on a remote snapshot (source: $src) — use 'db-switch remote' instead" >&2
      exit 1
    fi
    stop_dev
    pull_remote true
    echo ""
    echo "→ ready. Restart dev server (PORT=3000 npm run dev) to load the new DB."
    ;;
  local)
    stop_dev
    restore_local
    echo ""
    echo "→ ready. Restart dev server (PORT=3000 npm run dev) to load the new DB."
    ;;
  *)
    echo "Usage: swap.sh {status|remote|local|refresh}" >&2
    exit 1
    ;;
esac
