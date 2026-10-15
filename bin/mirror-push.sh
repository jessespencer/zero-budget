#!/usr/bin/env bash
#
# Mirror the whole repo to a bare repo on another machine (e.g. your home server). This is the only real undo in the setup:
# the .githooks guards are bypassable speed bumps, but a second copy of every
# ref on another machine survives a force-push that already landed, a bad
# `reset --hard`, or the GitHub repo being deleted outright.
#
# Caveat, stated plainly: `--mirror` makes the target match the source exactly,
# deletions included. If a bad force-push lands and then this runs, the mirror
# follows it. What saves you at that point is the mirror's own reflog
# (`git --git-dir=... reflog show main` on the server), which --mirror updates
# rather than truncates. So: a mirror is a backup of state, not a time machine.
#
# Cron-safe: the repo path comes from this script's own location, and
# ZERO_MIRROR_* settings from bin/remote-env.sh (real env vars beat .env.local).
#
# One-time setup — create a bare repo on the server with reflogs kept forever
# (bare repos disable them by default), then point ZERO_MIRROR_URL at it:
#   ssh me@server 'git init --bare ~/zero-mirror.git &&
#     git -C ~/zero-mirror.git config core.logAllRefUpdates true &&
#     git -C ~/zero-mirror.git config gc.reflogExpire never'
#   echo 'ZERO_MIRROR_URL=me@server:zero-mirror.git' >> .env.local
#
# Usage: npm run mirror   (or: bash bin/mirror-push.sh)

set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/remote-env.sh"

REPO="${ZERO_REPO_DIR:-$ZERO_ROOT}"
REMOTE="${ZERO_MIRROR_REMOTE:-mirror}"
# Don't lean on $HOME — cron sets it, but a stripped env doesn't, and `set -u`
# turns that into a hard failure right where you'd never see it.
HOME_DIR="${HOME:-$(eval echo "~$(id -un)")}"
LOG="${ZERO_MIRROR_LOG:-$HOME_DIR/.local/state/zero/mirror.log}"

mkdir -p "$(dirname "$LOG")"

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >>"$LOG"; }

cd "$REPO"

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
	if [ -n "${ZERO_MIRROR_URL:-}" ]; then
		git remote add "$REMOTE" "$ZERO_MIRROR_URL"
		log "added '$REMOTE' remote -> $ZERO_MIRROR_URL"
	else
		log "FAIL no '$REMOTE' remote configured in $REPO"
		echo "no '$REMOTE' remote. Set ZERO_MIRROR_URL in .env.local, or add one:" >&2
		echo "  git remote add $REMOTE <user>@<server>:zero-mirror.git" >&2
		exit 1
	fi
fi

# --no-verify: the pre-push guard protects origin/main from *you*. The mirror is
# a machine-driven exact copy and must be allowed to fast-forward or not freely.
if out=$(git push --mirror --no-verify "$REMOTE" 2>&1); then
	log "OK $(git rev-parse --short HEAD) -> $REMOTE"
	exit 0
else
	log "FAIL $out"
	echo "$out" >&2
	exit 1
fi
