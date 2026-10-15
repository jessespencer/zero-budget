import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// package.json is the single source of truth for the version we show in the
// sidebar footer. Read it here rather than importing it from a component —
// an import would pull the whole manifest (deps, scripts) into the client
// bundle. Next inlines `env` values at build time, so bumping the version
// requires a rebuild, which is exactly when it should change.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

// Parse comma-separated host:port entries from ALLOWED_DEV_ORIGINS.
// Used by contributors to reach the dev server from a phone or other LAN
// device (or via Tailscale/Cloudflare Tunnel). See docs/REMOTE-ACCESS.md.
const extraOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
  serverExternalPackages: ["better-sqlite3"],
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  // The Docker image runs the self-contained standalone server; the native
  // path (npm run build / npm start, pm2) keeps the regular build.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  allowedDevOrigins: extraOrigins,
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", ...extraOrigins],
    },
  },
  // The dashboard feature was renamed to Insights (route /dashboard → /insights).
  // Keep old bookmarks and deep links working.
  async redirects() {
    return [{ source: "/dashboard", destination: "/insights", permanent: true }];
  },
};

export default nextConfig;
