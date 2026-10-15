---
name: deploy-remote
description: Deploy the current origin/main to Zero's self-hosted production server (a Raspberry Pi, home server, or VPS running the app under pm2). Use this skill when the user asks to "deploy", "deploy to the server", "deploy to pi", "ship to pi", "push to prod", or runs `/deploy-remote`. Refuses to deploy if the working tree is dirty or local commits are unpushed. Needs ZERO_REMOTE_HOST configured in .env.local (see .env.example).
---

# Deploy to the remote server

Deploys the current `origin/main` to the production pm2 process on your self-hosted server. Only deploys code that is **already committed and pushed**.

Any other pm2 process on the server (e.g. a `zero-test` instance with its own database) is intentionally untouched.

## Configuration

Server-side steps go through `scripts/remote.sh`, which loads these via `bin/remote-env.sh` from the environment or `.env.local` (run it with `bash` — the loader is bash-only):

| Variable | Meaning | Default |
|---|---|---|
| `ZERO_REMOTE_HOST` | ssh target (`user@host` or an `~/.ssh/config` alias) | **required** |
| `ZERO_REMOTE_DIR` | the server's checkout, relative to its home dir or absolute (no `~`) | `zero` |
| `ZERO_REMOTE_PM2_NAME` | pm2 process to restart | `zero` |
| `ZERO_REMOTE_URL` | app URL, shown in the final report | — |

Run `bash .claude/skills/deploy-remote/scripts/remote.sh info` first to show where the deploy is headed. If it exits with "not configured", stop and tell the user which variables to add to `.env.local`. Do not guess a host.

## Steps

### 1. Preflight — verify local state is clean and pushed

Run these three checks in parallel:

```bash
git status --porcelain
git fetch origin main
git log --oneline origin/main..HEAD
```

Abort with a clear message if either:

- `git status --porcelain` is non-empty → "Working tree has uncommitted changes. Commit or stash before deploying." Show the files. Do not offer to stash automatically.
- `git log --oneline origin/main..HEAD` is non-empty → "Local branch is ahead of origin/main by N commits. Push before deploying." Show the unpushed commits.

Do not auto-commit or auto-push. Deploy means "things I have committed and pushed to my remote" — make the user do those steps explicitly.

### 2. Show what will be deployed

Get the local origin SHA and the currently-deployed server SHA in parallel:

```bash
git rev-parse --short origin/main
git log -1 --format='%s' origin/main
bash .claude/skills/deploy-remote/scripts/remote.sh sha
```

Show the user a one-line summary:

```
Deploying <local-short-sha> "<subject>" → <host from info> (currently on <server-short-sha>)
```

If `local == server`, tell the user "The server is already on origin/main — nothing to deploy." and stop.

If there are commits between them, list them with `git log --oneline <server-sha>..origin/main` so the user can see what's changing.

Ask for confirmation before running the deploy command. Use AskUserQuestion with a "Deploy" / "Cancel" choice.

### 3. Deploy

After confirmation, run the deploy — one SSH command chaining `git pull --ff-only && npm install && npm run build && pm2 restart <pm2-name>`:

```bash
bash .claude/skills/deploy-remote/scripts/remote.sh deploy
```

Stream the output so the user sees install/build progress in real time. The `&&` chain ensures pm2 is only restarted on a successful build.

If any step fails (non-zero exit), surface the failing step clearly. Do not try to "fix" server state — report and stop.

### 4. Verify the process is healthy

After the restart, confirm the process came back online:

```bash
bash .claude/skills/deploy-remote/scripts/remote.sh status
```

Expect `online`. If `errored` or `stopped`, fetch the last 30 log lines:

```bash
bash .claude/skills/deploy-remote/scripts/remote.sh logs
```

### 5. Report

On success, one-line summary (include `ZERO_REMOTE_URL` if set):

```
Deployed <short-sha> to <host>. <pm2-name> is online (N restarts). <ZERO_REMOTE_URL>
```

## Notes

- **Migrations** run automatically on boot via `runMigrations()` in `lib/migrations/runner.ts`. The migration runner snapshots the database before applying new migrations. No manual step needed.
- **Database backups** come from the server's own cron running `npm run backup`. A deploy does not trigger a backup. To force one before a risky deploy: `bash .claude/skills/deploy-remote/scripts/remote.sh backup`.
- **A test instance**, if the server runs one, is left alone. To refresh its DB from prod, run `bin/refresh-test-db.sh` on the server and restart that pm2 process.
- **Unreachable host**: if the server has a second address (e.g. a Tailscale name for when you're off the LAN), override for one run with `ZERO_REMOTE_HOST=<other>` in front of the command — a real env var wins over `.env.local`.
- **Branch**: this skill deploys `origin/main` because the server's checkout tracks `main`. It does not support deploying feature branches — for that, push to `main` first.
