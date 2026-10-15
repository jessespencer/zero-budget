// App version + author credit, rendered in the sidebar footer.
//
// The value is inlined at build time by `env` in next.config.ts, which reads it
// from package.json — bump the version there, not here. The fallback only shows
// up when a build bypasses next.config entirely (Vitest, tsx scripts), where a
// literal "dev" is more honest than a stale hardcoded number.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export const AUTHOR_NAME = "jessedestroys.com";
export const AUTHOR_URL = "https://jessedestroys.com";

// About dialog. A fork points these at its own repo and keeps the rest.
export const REPO_URL = "https://github.com/jessespencer/zero-budget";
export const LICENSE_NAME = "GNU AGPL v3";
export const COPYRIGHT = "© 2026 Jesse Spencer";

/** The release page for the running build, or the releases list for a dev build. */
export function releaseUrl(version: string = APP_VERSION): string {
  return version === "dev" ? `${REPO_URL}/releases` : `${REPO_URL}/releases/tag/v${version}`;
}
