import type { BotRole } from "../lib/roles.js";
import { isBotRole } from "../lib/roles.js";
import { getDb, getDbBackend, persistDb } from "../lib/db.js";
import { getNeonSql } from "../lib/neon-sql.js";

const asRowRecords = (rows: unknown): Record<string, unknown>[] =>
  Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];

/**
 * Последняя выбранная роль в боте — для восстановления сессии на serverless (Vercel),
 * где память процесса не разделяется между запросами.
 */
export const getLastSelectedBotRole = async (telegramUserId: number): Promise<BotRole | undefined> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    const rows = asRowRecords(
      await sql`
        SELECT role FROM user_last_bot_role WHERE telegram_user_id = ${telegramUserId} LIMIT 1
      `,
    );
    const r = (rows[0] as { role: string } | undefined)?.role;
    return r && isBotRole(r) ? r : undefined;
  }
  const database = getDb();
  const stmt = database.prepare("SELECT role FROM user_last_bot_role WHERE telegram_user_id = ? LIMIT 1");
  stmt.bind([telegramUserId]);
  if (!stmt.step()) {
    stmt.free();
    return undefined;
  }
  const obj = stmt.getAsObject() as { role: string };
  stmt.free();
  return isBotRole(obj.role) ? obj.role : undefined;
};

export const setLastSelectedBotRole = async (telegramUserId: number, role: BotRole): Promise<void> => {
  const now = Date.now();
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    await sql`
      INSERT INTO user_last_bot_role (telegram_user_id, role, updated_at)
      VALUES (${telegramUserId}, ${role}, ${now})
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        role = EXCLUDED.role,
        updated_at = EXCLUDED.updated_at
    `;
    return;
  }
  const database = getDb();
  database.run(
    "INSERT OR REPLACE INTO user_last_bot_role (telegram_user_id, role, updated_at) VALUES (?, ?, ?)",
    [telegramUserId, role, now],
  );
  persistDb();
};
