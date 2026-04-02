import { type Bot, type Context, webhookCallback } from "grammy";
import { initDb } from "../src/lib/db.js";
import { getBot } from "../src/telegram-bot.js";

let initialized = false;

try {
  await initDb();
  initialized = true;
} catch (err) {
  console.error("❌ Критическая ошибка при инициализации БД:", err);
}

/**
 * Vercel: задайте webhook на `https://<project>.vercel.app/api/telegram`
 * После деплоя: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=..."`
 *
 * Подключите Vercel Postgres (Neon): в переменных окружения будет `POSTGRES_URL` — тогда данные пишутся в Postgres.
 * Без `POSTGRES_URL` используется SQLite в `data/bot.db` (на serverless не подходит для продакшена).
 */

const handler = webhookCallback(getBot() as unknown as Bot<Context>, "https");

export default async (req: any, res: any) => {
  // Логирование входящего запроса
  console.log(`📨 Webhook request: ${req.method} ${req.url}`);

  if (!initialized) {
    console.error("❌ БД не инициализирована, запрос отклонён");
    return res.status(503).json({ error: "Service Unavailable: Database not initialized" });
  }

  try {
    // Логирование update'а если это POST
    if (req.method === "POST" && req.body) {
      const updateId = req.body?.update_id;
      const hasMessage = !!req.body?.message;
      const hasCallback = !!req.body?.callback_query;
      console.log(`📦 Update #${updateId}: message=${hasMessage}, callback=${hasCallback}`);
    }

    await handler(req, res);
    console.log("✅ Webhook обработан успешно");
  } catch (err) {
    console.error("❌ Ошибка обработки webhook:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
};
