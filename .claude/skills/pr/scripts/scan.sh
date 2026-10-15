#!/usr/bin/env bash
# Privacy scan: fail if a change adds anything private. The hard-check half of
# the /pr skill; the same script can back a pre-commit hook or a CI step.
#
# Usage:
#   scan.sh [base]     lines added on this branch since it left <base>
#                      (default origin/main): base...HEAD
#   scan.sh --staged   lines added in the staged changes (for a pre-commit hook)
#
# Generic checks (committed, safe to publish):
#   - home-network / private IPs, except the documented placeholders
#   - tailnet hostnames (*.ts.net), except the documented placeholder
#   - email addresses, except no-reply / example / git@ remotes
#   - paths inside a home directory (/Users/<name>/, /home/<name>/), except "me"
#   - database, env and backup files being added
# Personal checks (NOT committed): every non-empty, non-# line of a gitignored
# `.privacy-denylist` at the repo root (or the main checkout's root, so git
# worktrees share it) must never appear, case-insensitively — plain words as
# whole words, anything with punctuation as a substring —
# the server's IP, tailnet name, personal email, real account or family names.
# A public script must never contain the values it protects, so they live there.
#
# Exit 0 clean, 1 findings, 2 usage error.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MAIN_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" = "--staged" ]; then
  DIFF_ARGS=(--cached)
  WHAT="staged changes"
else
  BASE="${1:-origin/main}"
  git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null \
    || { echo "scan: unknown base '$BASE'" >&2; exit 2; }
  DIFF_ARGS=("$BASE...HEAD")
  WHAT="$BASE...HEAD"
fi

# .planning/ is private notes and bin/export-oss.sh holds real values in its
# own leak check — neither is ever published (the export drops both). The
# denylist itself is where the private values are supposed to be.
PATHSPEC=(-- . ':(exclude).planning' ':(exclude)bin/export-oss.sh' ':(exclude).privacy-denylist')

findings=""
add() { findings+="  $1"$'\n'; }

# Added lines as "file:line:text", from a zero-context diff.
ADDED="$(git diff --no-color --unified=0 "${DIFF_ARGS[@]}" "${PATHSPEC[@]}" | awk '
  /^\+\+\+ b\// { file = substr($0, 7); next }
  /^\+\+\+ /    { file = ""; next }
  /^@@/         { split($3, a, ","); line = substr(a[1], 2) + 0; next }
  /^\+/         { if (file != "") print file ":" line ":" substr($0, 2); line++ }
')"

check() { # label, extended regex, allow-regex (matches removed before testing)
  local label="$1" re="$2" allow="${3:-}"
  local hits
  # One pass per check: blank out the allowed placeholders, then match.
  hits="$(printf '%s\n' "$ADDED" \
    | { if [ -n "$allow" ]; then sed -E "s#$allow##g"; else cat; fi; } \
    | grep -E -- "$re" | cut -d: -f1,2 || true)"
  [ -n "$hits" ] && while IFS= read -r h; do add "$h  $label"; done <<<"$hits"
  return 0
}

check "private IP address" \
  '(^|[^0-9.])(192\.168\.[0-9]{1,3}\.[0-9]{1,3}|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$)' \
  '192\.168\.1\.(42|50)'
check "tailnet hostname" '[a-z0-9-]+\.ts\.net' 'tail-abcd\.ts\.net'
check "email address" '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
  '[A-Za-z0-9._%+-]+@(users\.noreply\.github\.com|anthropic\.com|example\.(com|org|net))|git@[A-Za-z0-9.-]+'
check "path in a home directory" '(/Users|/home)/[A-Za-z0-9._-]+/' '(/Users|/home)/me/'

# Files that must never be committed.
while IFS= read -r f; do
  case "$f" in
    *.db|*.db-wal|*.db-shm|*.sqlite|*.backup|.env|.env.*|*/.env|*/.env.*)
      case "$f" in *.env.example) ;; *) add "$f  private file type" ;; esac ;;
    .privacy-denylist) add "$f  the denylist itself" ;;
  esac
done < <(git diff --name-only --diff-filter=AR "${DIFF_ARGS[@]}" -- .)

# Personal denylist.
DENY=""
for f in "$ROOT/.privacy-denylist" "$MAIN_ROOT/.privacy-denylist"; do
  [ -f "$f" ] && { DENY="$f"; break; }
done
if [ -n "$DENY" ]; then
  while IFS= read -r term || [ -n "$term" ]; do
    term="$(printf '%s' "$term" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
    case "$term" in ''|'#'*) continue ;; esac
    # Plain words (names, places) match whole words only, so "ann" doesn't
    # fire on "annual"; anything with punctuation (an IP prefix, a path)
    # matches as a substring.
    case "$term" in *[!A-Za-z0-9\ ]*) mode=-iF ;; *) mode=-iwF ;; esac
    while IFS= read -r l; do
      [ -z "$l" ] && continue
      # Never echo the matched value — only where it is.
      add "${l%%:*}:$(printf '%s' "$l" | cut -d: -f2)  matches a .privacy-denylist entry"
    done < <(printf '%s\n' "$ADDED" | grep "$mode" -- "$term" || true)
  done < "$DENY"
fi

if [ -n "$findings" ]; then
  echo "Privacy scan FAILED ($WHAT):"
  printf '%s' "$findings" | sort -u
  exit 1
fi
echo "Privacy scan clean ($WHAT; $(printf '%s\n' "$ADDED" | grep -c . || true) added lines; denylist: $([ -n "$DENY" ] && echo found || echo "none — create .privacy-denylist"))"
