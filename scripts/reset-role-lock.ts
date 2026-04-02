/**
 * Сброс закреплённой роли: удаляет строку из user_role_lock.
 * Запуск: pnpm reset-role   (или: npx tsx scripts/reset-role-lock.ts)
 * Можно передать id аргументом: pnpm reset-role -- 123456789
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { initDb, getDbBackend, persistDb } from "../src/lib/db.js";
import { getDb } from "../src/lib/db.js";
import { getNeonSql } from "../src/lib/neon-sql.js";

const parseId = (raw: string): number | undefined => {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return undefined;
  }
  return n;
};

const deleteLock = async (telegramUserId: number): Promise<void> => {
  await initDb();
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    await sql`
      DELETE FROM user_role_lock WHERE telegram_user_id = ${telegramUserId}
    `;
    return;
  }
  const database = getDb();
  database.run("DELETE FROM user_role_lock WHERE telegram_user_id = ?", [telegramUserId]);
  persistDb();
};

const main = async (): Promise<void> => {
  const fromArgv = process.argv[2];
  let idRaw: string;
  if (fromArgv !== undefined) {
    idRaw = fromArgv;
  } else {
    const rl = createInterface({ input, output });
    try {
      idRaw = await rl.question("Telegram user id: ");
    } finally {
      rl.close();
    }
  }

  const telegramUserId = parseId(idRaw);
  if (telegramUserId === undefined) {
    console.error("Нужен положительный целочисленный Telegram user id.");
    process.exitCode = 1;
    return;
  }

  await deleteLock(telegramUserId);
  console.log(`Готово: сброшена закреплённая роль для id ${telegramUserId}.`);
};

await main();
