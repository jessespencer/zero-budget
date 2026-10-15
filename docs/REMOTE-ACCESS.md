# Remote access

Zero is a single-family app with no authentication — the assumption is "the network is the auth boundary." Anyone who can reach the app over the network can read and modify your finances. There is no login page and no middleware checking who you are.

This document lists five ways to reach the app from a phone, ordered roughly from least to most exposed. Pick the one that matches your trust model and stop there — you do not need to layer them.

> ⚠️ **Never port-forward Zero directly to the public internet without an auth layer.**
> Zero has no login. If you expose port 3000 (or 4040) to a public IP without a reverse proxy that enforces authentication (Cloudflare Access, Tailscale ACLs, basic auth on nginx, etc.), anyone who finds the URL can read and write your finances. The recipes below show the safe ways to make the app reachable from outside the LAN.

## Recipe 1 — Same-LAN (simplest)

What it does: makes the Mac reachable to phones on the same Wi-Fi. Zero traffic leaves your home network.

```bash
# Find your Mac's LAN IP
ipconfig getifaddr en0       # or en1 if you use Ethernet

# Already configured: dev and start scripts bind to 0.0.0.0
npm run dev                  # dev on port 3000
# or
npm start                    # production on port 4040
```

Bookmark on the phone: `http://<lan-ip>:4040/quick` (or `:3000/quick` for dev). Add `<lan-ip>:4040` to `ALLOWED_DEV_ORIGINS` in `.env.local` (see [Configuring allowed origins](#configuring-allowed-origins) below).

Only works while both devices are on the same Wi-Fi. Your phone will lose access the moment it switches to LTE.

See: [Next.js docs — Server Actions allowed origins](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions)

## Recipe 2 — Tailscale (recommended for households)

What it does: puts the Mac and your phones on a private encrypted overlay network ("tailnet"). No port forwarding, no public exposure, works on LTE.

```bash
brew install tailscale
sudo tailscale up            # logs in via your browser
tailscale status             # shows your Mac's tailnet hostname
```

Install the Tailscale app on each phone, log in with the same identity, and the devices appear on the tailnet automatically.

Bookmark on the phone: `http://<macbook-tailnet-name>.tail-XXXX.ts.net:4040/quick`. Add that same host:port to `ALLOWED_DEV_ORIGINS` in `.env.local`.

This is the right answer for most households. Encrypted, peer-to-peer, no DNS to manage, and the free tier covers up to 100 devices.

See: [Tailscale quickstart](https://tailscale.com/kb/1017/install)

## Recipe 3 — Headscale (self-hosted Tailscale)

What it does: replaces Tailscale's hosted coordinator with one you run yourself. Same client app on the phone, same network model — you just own the control plane.

```bash
# On the server that will run the coordinator
brew install headscale       # or follow upstream install for Linux
headscale users create me
headscale preauthkeys create --user me --reusable
```

On the Mac and each phone, point the Tailscale client at your coordinator:

```bash
sudo tailscale up --login-server=https://headscale.example.com --authkey <preauthkey>
```

Bookmark and `ALLOWED_DEV_ORIGINS` setup are identical to recipe 2 — the host:port string comes from `tailscale status`.

See: [Headscale docs](https://headscale.net/)

## Recipe 4 — Cloudflare Tunnel + Access

What it does: exposes the app on a public hostname (`zero.example.com`) but gates it behind Cloudflare Access, which checks identity (email link, Google SSO, etc.) before letting traffic through.

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create zero
cloudflared tunnel route dns zero zero.example.com
cloudflared tunnel run --url http://localhost:4040 zero
```

In the Cloudflare dashboard: Zero Trust → Access → Applications → add `zero.example.com` and create a policy that only allows your household's email addresses. Without that policy, you have re-exposed the app to the internet — read the security warning again.

Bookmark on the phone: `https://zero.example.com/quick`. Add `zero.example.com` (no port) to `ALLOWED_DEV_ORIGINS`.

See: [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) · [Cloudflare Access docs](https://developers.cloudflare.com/cloudflare-one/policies/access/)

## Recipe 5 — Port-forward + reverse proxy + auth

What it does: opens a port on your router and puts an authenticating TLS reverse proxy in front of Zero. Most flexible, most risky. **Re-read the security warning at the top before doing this.**

```bash
brew install caddy           # or nginx — Caddy auto-renews TLS

# Caddyfile
zero.example.com {
  basicauth {
    you JDJhJDEw...           # generate with `caddy hash-password`
  }
  reverse_proxy localhost:4040
}
```

Forward router port 443 → Mac port 443. Make sure your DNS points `zero.example.com` at your home IP (or use a dynamic-DNS service).

Bookmark on the phone: `https://zero.example.com/quick`. Add `zero.example.com` to `ALLOWED_DEV_ORIGINS`.

If you skip the basicauth block (or any equivalent auth layer) you have published your finances to the world. Don't.

See: [Caddy basicauth docs](https://caddyserver.com/docs/caddyfile/directives/basic_auth)

## Configuring allowed origins

Next.js rejects server-action calls that come from origins it does not recognise, and warns about cross-origin dev-asset requests. Both are configured through a single env var. Add the host:port you bookmarked on the phone to `.env.local`:

```bash
# .env.local — comma-separated, no spaces required
ALLOWED_DEV_ORIGINS=192.168.1.42:4040
# or multiple:
ALLOWED_DEV_ORIGINS=192.168.1.42:4040,macbook.tail-abcd.ts.net:4040,zero.example.com
```

Use the exact host:port string you bookmarked — port is required when non-standard, omitted when behind 443. Restart the server after editing. The same list feeds both `allowedDevOrigins` (silences the cross-origin warning) and `experimental.serverActions.allowedOrigins` (lets mutations through) in `next.config.ts`.

---

Back to the [README](../README.md).
