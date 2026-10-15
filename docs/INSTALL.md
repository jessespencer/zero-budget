# Installing Zero

Zero runs anywhere Docker or Node 20+ does: your laptop, a Raspberry Pi, a home
server, a NAS or a VPS.

> **Zero has no login.** Anyone who can reach it over the network can see and change your budget. Run it on your own machine or home network, and never port-forward it to the internet without an authentication layer in front — see [SECURITY.md](../SECURITY.md) and [REMOTE-ACCESS.md](REMOTE-ACCESS.md).

- [Get the code](#get-the-code)
- [Docker](#docker)
- [Native (Node 20+)](#native-node-20)
- [Always-on with pm2](#always-on-with-pm2)
- [On a home server](#on-a-home-server-raspberry-pi-nas-vps)
- [Access from a phone](#access-from-a-phone)
- [Your data](#your-data)
- [Backing up](#backing-up)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)

## Get the code

```bash
git clone https://github.com/jessespencer/zero-budget.git
cd zero-budget
```

## Docker

1. Build and start the app (the first build takes a few minutes):
   ```bash
   docker compose up -d --build
   ```
2. Open `http://localhost:4040` in your browser. A setup checklist on the Budget page walks you through adding accounts, creating categories, and assigning your first dollars.

Your database is stored in `./data/zero.db` on the host. Port 4040 already taken? Start it with `ZERO_PORT=8080 docker compose up -d --build` instead.

## Native (Node 20+)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Optionally copy the example env file, to set a database location or other options later:
   ```bash
   cp .env.example .env.local
   ```
3. Build and start:
   ```bash
   npm run build
   npm start
   ```
4. Open `http://localhost:4040` in your browser.

For development, use `npm run dev` instead of build + start — see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Always-on with pm2

To run Zero as a persistent background process that survives terminal closes and reboots:

```bash
npm install -g pm2
npm run deploy        # build + start via pm2
pm2 startup           # auto-start on reboot (follow the sudo prompt)
pm2 save              # save process list
```

After making changes, run `npm run deploy` again to rebuild and restart. It deploys whatever code is in the working directory — no need to be on a specific branch.

## On a home server (Raspberry Pi, NAS, VPS)

Zero runs comfortably on a Raspberry Pi. On the server, follow the native install above, point `ZERO_DB_PATH` somewhere permanent (e.g. `~/.local/share/zero/zero.db`), start it with `npm run deploy` + `pm2 startup` + `pm2 save`, and schedule backups:

```bash
crontab -e
# every 6 hours; cron needs the absolute path to npm and the checkout
0 */6 * * * cd /home/me/zero && /usr/bin/npm run backup >> /home/me/zero-backup.log 2>&1
```

Then, from your dev machine, add the server to `.env.local` (see the self-hosting block in [.env.example](../.env.example)):

```bash
ZERO_REMOTE_HOST=me@192.168.1.50
ZERO_REMOTE_DB_PATH=/home/me/.local/share/zero/zero.db
```

That unlocks the optional tooling: if you use Claude Code or Codex, the `deploy-remote` skill ships `origin/main` to the server, `db-switch` pulls a copy of its latest backup for local testing, and `import-txns` reconciles bank statements against its database instead of a local one. `npm run mirror` keeps a second copy of the git repo on the server (set `ZERO_MIRROR_URL`). Nothing reaches the network until these are set.

## Access from a phone

Zero ships a mobile-friendly quick-add screen at `/quick` that installs like an app. To reach it from a phone — over Tailscale, Cloudflare Tunnel, or your home Wi-Fi — see [REMOTE-ACCESS.md](REMOTE-ACCESS.md).

## Your data

Zero stores everything in a single SQLite file. By default it lives at `data/zero.db` relative to the project root. To move it somewhere more permanent, set `ZERO_DB_PATH` in your `.env.local`:

| OS | Recommended path |
|----|-----------------|
| macOS | `~/Library/Application Support/Zero/zero.db` |
| Linux | `~/.local/share/zero/zero.db` |
| Windows | `%LOCALAPPDATA%\Zero\zero.db` |

The directory is created automatically if it doesn't exist.

## Backing up

Create a point-in-time backup:

```bash
npm run backup
```

Backups are saved to a `backups/` folder next to your database file, with timestamps in the filename (e.g. `zero-20260420-143000.db`). Override the backup location with `ZERO_BACKUP_DIR`.

To restore a backup: stop the app, copy the backup file over your `zero.db`, and restart.

## Updating

1. Back up your data: `npm run backup`
2. Pull the latest code: `git pull` (or `git checkout <tag>`)
3. Rebuild and restart: `npm install && npm run deploy` (Docker: `docker compose up -d --build`)

The app automatically snapshots your database before applying any schema migrations. If something goes wrong, the snapshot is saved as `zero.db.pre-migration-vN.backup` next to your database file.

## Troubleshooting

- **"Where is my data?"** — Run `npm run db:info` to see the database path, file size, schema version, and row counts.
- **"I want to start fresh"** — Stop the app, delete the database file, and restart. A new empty database will be created.
- **"Migration failed"** — Restore the `.pre-migration-vN.backup` file next to your database, then [open an issue](https://github.com/jessespencer/zero-budget/issues).
