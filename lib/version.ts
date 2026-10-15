// App version + author credit, rendered in the sidebar footer.
//
// The value is inlined at build time by `env` in next.config.ts, which reads it
// from package.json — bump the version there, not here. The fallback only shows
// up when a build bypasses next.config entirely (Vitest, tsx scripts), where a
// literal "dev" is more honest than a stale hardcoded number.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export const AUTHOR_NAME = "jessedestroys.com";
export const AUTHOR_URL = "https://jessedestroys.com";
