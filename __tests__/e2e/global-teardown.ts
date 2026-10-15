import fs from "fs";
import os from "os";
import path from "path";

/**
 * Remove the seeded database that playwright.config.ts created at load time.
 * Only deletes a `zero-e2e-*` dir under the OS temp dir, so a stray
 * ZERO_E2E_DB_PATH pointing anywhere else is never touched.
 */
export default function globalTeardown() {
  const dbPath = process.env.ZERO_E2E_DB_PATH;
  if (!dbPath) return;
  const dir = path.dirname(dbPath);
  if (path.dirname(dir) !== fs.realpathSync(os.tmpdir()) && path.dirname(dir) !== os.tmpdir()) return;
  if (!path.basename(dir).startsWith("zero-e2e-")) return;
  fs.rmSync(dir, { recursive: true, force: true });
}
