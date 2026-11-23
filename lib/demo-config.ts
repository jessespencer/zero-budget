// Side-effect-free demo-mode settings, safe to import from any server
// component (the banner) without pulling in better-sqlite3. The sandbox
// itself lives in lib/demo.ts; the server that turns it on is
// scripts/demo-server.mjs (`npm run demo`).

/** Cookie holding the visitor's sandbox id. Set by scripts/demo-server.mjs. */
export const DEMO_COOKIE = "zero_demo";

/** True only under `npm run demo`, which sets ZERO_DEMO=1 before Next loads. */
export function isDemoMode(): boolean {
  return process.env.ZERO_DEMO === "1";
}

/** ZERO_DEMO_BANNER=0 hides the banner, for recording videos on the demo.
 *  Keep it on anywhere the public can reach. */
export function isDemoBannerShown(): boolean {
  return process.env.ZERO_DEMO_BANNER !== "0";
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** A sandbox untouched for this long is closed and deleted. */
export function demoIdleHours(): number {
  return positiveNumber(process.env.ZERO_DEMO_IDLE_HOURS, 4);
}

/** Most sandboxes kept at once; past it, the least recently used goes. */
export function demoMaxSessions(): number {
  return Math.floor(positiveNumber(process.env.ZERO_DEMO_MAX_SESSIONS, 200));
}
