import path from "node:path";

export function DevModeBanner() {
  if (process.env.NEXT_PUBLIC_ZERO_DEV_MODE !== "1") return null;

  // Mirror the resolution in lib/db.ts so the banner shows the actual file in use.
  const dbPath =
    process.env.ZERO_DB_PATH ?? path.join(process.cwd(), "data", "zero.db");
  const dbFile = path.basename(dbPath);

  return (
    <>
      {/* Lets full-height containers subtract the banner from 100dvh. */}
      <style>{`:root { --zero-banner-h: 1.5rem; }`}</style>
      <div
        role="status"
        aria-label="Development mode"
        className="sticky top-0 z-50 flex h-6 items-center justify-center gap-3 bg-info px-3 text-[11px] text-white dark:text-background"
      >
        <span className="font-semibold uppercase tracking-wider">Dev mode</span>
        <span className="tabular-nums opacity-80">{dbFile}</span>
      </div>
    </>
  );
}
