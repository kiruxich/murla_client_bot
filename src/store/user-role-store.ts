import type { BotRole } from "../lib/roles.js";
import { isBotRole } from "../lib/roles.js";
import { getDb, getDbBackend, persistDb } from "../lib/db.js";
import { getNeonSql } from "../lib/neon-sql.js";

const asRowRecords = (rows: unknown): Record<string, unknown>[] =>
  Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];

export const getLockedRole = async (telegramUserId: number): Promise<BotRole | undefined> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    const rows = asRowRecords(
      await sql`
      SELECT role FROM user_role_lock WHERE telegram_user_id = ${telegramUserId}
    `,
    );
    const r = (rows[0] as { role: string } | undefined)?.role;
    return r && isBotRole(r) ? r : undefined;
  }
  const database = getDb();
  const stmt = database.prepare("SELECT role FROM user_role_lock WHERE telegram_user_id = ?");
  stmt.bind([telegramUserId]);
  if (!stmt.step()) {
    stmt.free();
    return undefined;
  }
  const obj = stmt.getAsObject() as { role: string };
  stmt.free();
  return isBotRole(obj.role) ? obj.role : undefined;
};

export const setLockedRole = async (telegramUserId: number, role: BotRole): Promise<void> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    await sql`
      INSERT INTO user_role_lock (telegram_user_id, role)
      VALUES (${telegramUserId}, ${role})
      ON CONFLICT (telegram_user_id) DO UPDATE SET role = EXCLUDED.role
    `;
    return;
  }
  const database = getDb();
  database.run("INSERT OR REPLACE INTO user_role_lock (telegram_user_id, role) VALUES (?, ?)", [
    telegramUserId,
    role,
  ]);
  persistDb();
};
