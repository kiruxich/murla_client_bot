import { type Bot, type Context, webhookCallback } from "grammy";
import { initDb } from "../src/lib/db.js";
import { getBot } from "../src/telegram-bot.js";

await initDb();

/**
 * Vercel: задайте webhook на `https://<project>.vercel.app/api/telegram`
 * После деплоя: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=..."`
 *
 * Подключите Vercel Postgres (Neon): в переменных окружения будет `POSTGRES_URL` — тогда данные пишутся в Postgres.
 * Без `POSTGRES_URL` используется SQLite в `data/bot.db` (на serverless не подходит для продакшена).
 */
export default webhookCallback(getBot() as unknown as Bot<Context>, "https");
