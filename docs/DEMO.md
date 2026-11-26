# Running a public demo

`npm run demo` serves Zero as a try-before-you-install demo. Every visitor gets
their own private copy of the `seed:dev` household (4 accounts, 13 months of
transactions ending today), so they can assign, edit and delete freely without
anyone else seeing it.

```bash
npm ci
npm run build
npm run demo            # http://localhost:4041
```

Just want to show Zero to someone or record it from your own install? You
don't need this: turn on **Settings → Demo mode** instead, which swaps your
running app to the same sample household until you end it (see
[FEATURES.md](../FEATURES.md#demo-mode)). This page is for serving a demo to
the public.

This is the **only** supported way to put Zero on the open internet. A normal
install has no login and must stay on a private network ([SECURITY.md](../SECURITY.md)).
The demo is safe to expose because it never opens a real database: it holds
nothing but generated sample data.

## How it works

`scripts/demo-server.mjs` wraps the production build:

1. At boot it builds `data/demo/template.db` (every migration, then the seed),
   and rebuilds it when the date changes so "ending today" stays true.
2. Each visitor gets a `zero_demo` cookie with a random id.
3. Requests run inside a context holding that id, and `getDb()` returns that
   visitor's database (`lib/demo.ts`). The copy is made on the visitor's first
   page that reads data, so static files and bots cost nothing.

A sandbox untouched for `ZERO_DEMO_IDLE_HOURS` is deleted; past
`ZERO_DEMO_MAX_SESSIONS` the least recently used one goes. A restart deletes
them all. Each sandbox is about the size of the template (a few MB).

## Settings

| Variable | Default | Does |
|---|---|---|
| `PORT` | `4041` | Port to listen on |
| `ZERO_DEMO_IDLE_HOURS` | `4` | Idle time before a sandbox is deleted (also shown in the banner) |
| `ZERO_DEMO_MAX_SESSIONS` | `200` | Most sandboxes kept at once |
| `ZERO_DEMO_DIR` | `data/demo` | Template and sandboxes. Must be inside the checkout |
| `ZERO_DEMO_BANNER` | on | `0` hides the Demo banner, for screen recordings. Keep it on anywhere the public can reach |

`ZERO_DB_PATH` is ignored: the public demo never opens it.

## Recording videos

The demo doubles as a recording setup: sample data only, and a restart gives
you a clean slate for the next take. Hide the banner so it isn't in the shot
(the in-app Demo mode always shows its banner, since on a real install it's
what stops you logging real spending into the sample):

```bash
ZERO_DEMO_BANNER=0 npm run demo
```

A private window is a second clean copy, for before-and-after shots.

## Hosting

Run it on a machine that holds **nothing else of yours**, never on the box
that serves your real budget. A small VPS is enough. Keep it running with pm2
(`pm2 start npm --name zero-demo -- run demo`) or a systemd unit, and put a
TLS-terminating proxy in front. With Caddy:

```
demo.example.com {
  reverse_proxy localhost:4041
}
```

Behind HTTPS the cookie is marked `Secure` (the server reads
`X-Forwarded-Proto`). Rate limiting belongs in the proxy, too.

The banner links the source repository, which covers the AGPL's requirement
to offer the source of a hosted copy, as long as you're running unmodified
code. If you change it, link your fork.
