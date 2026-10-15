# Security

## Zero has no login — read this before exposing it

Zero is a single-household, self-hosted app with **no authentication**. Anyone who can reach it over the network can read and change every number in it. That's a deliberate design choice: the network is the security boundary.

- Run it on your own machine, your home network, or a private network like Tailscale.
- **Never port-forward it to the public internet.** If you need access from outside your network, put an authentication layer in front of it — Tailscale, Cloudflare Access, or a reverse proxy with authentication.

[docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md) walks through the safe ways to reach Zero from your phone.

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue:

1. Go to this repository's **Security** tab.
2. Choose **Report a vulnerability**.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get an acknowledgement within two weeks, and a fix or an explanation as soon as the problem is understood. If you'd like credit when the fix ships, say so in the report.

## What counts

**In scope** — please report these:

- Anything that lets someone **without network access** to a Zero instance read or change its data
- Cross-site scripting, for example through an imported CSV, payee name, or memo
- SQL injection or path traversal
- Amounts that show up while privacy mode is on
- A dependency vulnerability that's actually reachable in Zero

**Out of scope** — these are expected behaviour, not vulnerabilities:

- Anyone who can reach an instance can use it. There's no login, by design; see above.
- Problems that need someone to already have access to the machine running Zero or its database file
- Misconfiguration, like an instance exposed to the internet without an authentication layer in front of it

## Supported versions

Security fixes go into the latest release and `main`. Older versions don't get backports — update to the latest release.
