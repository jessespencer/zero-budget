---
name: db-switch
description: Swap Zero's active SQLite DB between the local dev fixture and a fresh snapshot of the production DB on your self-hosted server. Use when the user asks to "use my real data", "use the prod DB", "use the Pi DB", "switch to local DB", "swap the DB", "pull from the server", "refresh the snapshot", or runs `/db-switch`. Needs ZERO_REMOTE_HOST and a backup dir configured in .env.local (see .env.example).
version: 1.0.0
---

# Switch Zero's active DB between local dev and a production snapshot

The Zero app reads from `data/zero.db`. This skill swaps that file between two sources:
- **Local dev fixture** — the iteratively-edited DB you build features against. Stashed at `data/zero.db.dev` after the first remote pull.
- **Remote snapshot** — pulled via `scp` from the latest cron backup in `ZERO_REMOTE_BACKUP_DIR` on `ZERO_REMOTE_HOST` (defaults to `backups/` next to `ZERO_REMOTE_DB_PATH`). Checksum-verified end-to-end.

A marker file `data/zero.db.source` tracks which source is currently active.

## Parsing the user's intent

Parse the args (the text passed via `ARGUMENTS`) to pick a mode:

- `remote`, `pi`, `prod`, `real`, "use my real data" → **REMOTE mode**
- `local`, `dev`, "switch back", "back to dev" → **LOCAL mode**
- `refresh`, `pull again`, "newer snapshot" → **REFRESH mode** (only valid if already on a remote snapshot)
- `status`, `which`, "what's loaded" → **STATUS mode**
- empty / ambiguous → run STATUS first, then offer choices via `AskUserQuestion`

If args are empty AND the user invoked the skill without context, first run `bash .agents/skills/db-switch/scripts/swap.sh status`, surface the result, then present a 2-choice `AskUserQuestion` (`remote` vs `local`, plus `refresh` if already on a remote snapshot).

## Execution

Run the helper script with the chosen mode:

```bash
bash .agents/skills/db-switch/scripts/swap.sh <remote|local|refresh|status>
```

The script handles:
- Stopping any dev server on port 3000 (best-effort)
- Stashing the current active DB as `data/zero.db.dev` on the first `remote` pull (preserves the user's local dev fixture)
- Loading server settings via `bin/remote-env.sh` and SSHing to `ZERO_REMOTE_HOST` to find the latest cron snapshot
- `scp`'ing it down to `data/zero.db.remote-pull`
- Verifying sha256 vs the remote
- Atomically swapping into `data/zero.db` (also clears `-wal` / `-shm` sidecars so the WAL doesn't replay stale state)
- Writing the marker file
- Printing a one-line schema/row summary

If the script exits non-zero, surface the error to the user — do not retry blindly. SSH failure usually means a VPN/network/key issue; a "not configured" error means the `ZERO_REMOTE_*` settings are missing from `.env.local`.

## After the script succeeds

Restart the dev server so the new DB is picked up. Default port is 3000:

```bash
PORT=3000 npm run dev
```

Run it via `Bash` with `run_in_background: true`, then wait for the `Ready` log line (use a short `until grep -qE "Ready|Error"` loop on the output file).

Report to the user:
- Which DB is now active (`local` vs `remote-<snapshot>`)
- A one-line summary (accounts / transactions / schema version) — the script already prints this
- That the dev server is back up at http://localhost:3000

## Edge cases

- **Already on a remote snapshot, user asks for `remote`** → silently treat as `refresh` (pull a fresher snapshot).
- **No stashed dev DB, user asks for `local`** → script will error. Explain: "no stashed dev DB exists yet — the first `db-switch remote` creates it. If you have a local backup file (e.g. `data/zero.db.local-backup-*`), rename it to `data/zero.db.dev` to seed the stash."
- **SSH unreachable** → suggest checking the LAN or VPN (e.g. Tailscale). If the server has a second address, rerun with `ZERO_REMOTE_HOST=<other> bash .agents/skills/db-switch/scripts/swap.sh remote` — a real env var wins over `.env.local`.
- **Dev server doesn't release port 3000** → the script force-kills with `kill -9` as fallback; if it still fails, surface the leftover PIDs.

## Don't do

- Do not modify the server's DB. This skill is one-way (server → local). Pushing local edits back to the server is a separate (riskier) flow not covered here.
- Do not delete `data/zero.db.dev` unless the user explicitly asks — it's their canonical dev fixture.
- Do not drop existing `data/zero.db.local-backup-*` files — those are historical safety nets.
