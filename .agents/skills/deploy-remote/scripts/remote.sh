#!/usr/bin/env bash
# Server-side steps for the deploy-remote skill. A script rather than inline
# commands because bin/remote-env.sh is bash, and the agent's shell may not be.
#
# Usage: remote.sh <sha|deploy|status|logs|backup|info>
#   info     print the resolved host / dir / pm2 process / URL
#   sha      short SHA the server's checkout is on
#   deploy   git pull --ff-only, npm install, build, pm2 restart (stops at the first failure)
#   status   "<status> restarts: N" for the pm2 process
#   logs     last 30 pm2 log lines
#   backup   run `npm run backup` on the server
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/bin/remote-env.sh"
require_remote ZERO_REMOTE_HOST

HOST="$ZERO_REMOTE_HOST"
DIR="$ZERO_REMOTE_DIR"
NAME="$ZERO_REMOTE_PM2_NAME"

case "${1:-}" in
  info)
    echo "host: $HOST"
    echo "dir:  $DIR"
    echo "pm2:  $NAME"
    echo "url:  ${ZERO_REMOTE_URL:-(not set)}"
    ;;
  sha)
    ssh -o ConnectTimeout=10 "$HOST" "cd '$DIR' && git rev-parse --short HEAD"
    ;;
  deploy)
    ssh -o ConnectTimeout=10 "$HOST" "cd '$DIR' && git pull --ff-only && npm install && npm run build && pm2 restart '$NAME'"
    ;;
  status)
    ssh -o ConnectTimeout=10 "$HOST" "pm2 jlist" | NAME="$NAME" python3 -c "
import json, os, sys
procs = [p for p in json.load(sys.stdin) if p['name'] == os.environ['NAME']]
if not procs:
    sys.exit('no pm2 process named ' + os.environ['NAME'])
env = procs[0]['pm2_env']
print(env['status'], 'restarts:', env['restart_time'])
"
    ;;
  logs)
    ssh -o ConnectTimeout=10 "$HOST" "pm2 logs '$NAME' --lines 30 --nostream"
    ;;
  backup)
    ssh -o ConnectTimeout=10 "$HOST" "cd '$DIR' && npm run backup"
    ;;
  *)
    echo "Usage: remote.sh {info|sha|deploy|status|logs|backup}" >&2
    exit 2
    ;;
esac
