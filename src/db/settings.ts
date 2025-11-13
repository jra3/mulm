import { query, writeConn } from "./conn";

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

/**
 * Get a setting value by key
 */
export async function getSetting(key: string): Promise<string | null> {
  const result = await query<Setting>("SELECT value FROM settings WHERE key = ?", [key]);
  return result.length > 0 ? result[0].value : null;
}

/**
 * Get the live CTA message for /live display page
 */
export async function getLiveCTAMessage(): Promise<string | null> {
  return getSetting("live_cta_message");
}

/**
 * Update a setting value
 */
export async function updateSetting(key: string, value: string): Promise<void> {
  const stmt = await writeConn.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`
  );
  await stmt.run(key, value);
  await stmt.finalize();
}

/**
 * Update the live CTA message
 */
export async function updateLiveCTAMessage(markdown: string): Promise<void> {
  return updateSetting("live_cta_message", markdown);
}
