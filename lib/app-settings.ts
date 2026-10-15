import { getDb } from "./db";

export const DEFAULT_BUDGET_START_MONTH = "2026-05-01";

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare<[string], { value: string }>("SELECT value FROM app_settings WHERE key = ?")
    .get(key);
  return row?.value ?? null;
}

export function getBudgetStartMonth(): string {
  return getSetting("budget_start_month") ?? DEFAULT_BUDGET_START_MONTH;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value);
}
