import { demoIdleHours, isDemoBannerShown, isDemoMode } from "@/lib/demo-config";
import { REPO_URL } from "@/lib/version";

/**
 * Top banner on the public demo (`npm run demo`). Says the data is fake and
 * private to this visitor, and links the source — the AGPL asks a hosted copy
 * to offer it. Sticky like DevModeBanner and sets the same --zero-banner-h.
 * `ZERO_DEMO_BANNER=0` hides it for screen recordings.
 */
export function DemoBanner() {
  if (!isDemoMode() || !isDemoBannerShown()) return null;
  const hours = demoIdleHours();

  return (
    <>
      <style>{`:root { --zero-banner-h: 1.75rem; }`}</style>
      <div
        role="status"
        aria-label="Demo"
        className="sticky top-0 z-50 flex h-7 items-center justify-center gap-2 bg-info px-3 text-xs text-white dark:text-background"
      >
        <span className="font-semibold uppercase tracking-wider">Demo</span>
        <span className="truncate opacity-90">
          Sample data. Your changes are private to you and reset after {hours}{" "}
          {hours === 1 ? "hour" : "hours"} away.
        </span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-semibold underline underline-offset-2"
        >
          Get Zero
        </a>
      </div>
    </>
  );
}
