/**
 * На Vercel после подключения Postgres в проект обычно появляется `POSTGRES_URL`
 * (иногда дублируется как `DATABASE_URL`). Если задано — бот использует Neon/Postgres вместо локального SQLite.
 *
 * Для локальной разработки: задайте **`DEV_USE_SQLITE=true`** в `.env`, чтобы всегда использовать файл
 * `data/bot.db`, даже если скопирован продовый `POSTGRES_URL` — удобно смотреть данные в SQLite.
 */
export const isDevSqliteForced = (): boolean =>
  process.env.DEV_USE_SQLITE === "true" || process.env.DEV_USE_SQLITE === "1";

export const getPostgresUrl = (): string | undefined =>
  process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();

/**
 * Токен бота:
 * - **Прод (Vercel):** только `BOT_TOKEN` — продовый токен; не задавайте `USE_DEV_BOT`.
 * - **Локально:** `USE_DEV_BOT=true` + `BOT_TOKEN_DEV` — отдельный dev-бот, чтобы не трогать прод.
 */
export const getBotToken = (): string => {
  const useDev =
    process.env.USE_DEV_BOT === "true" || process.env.USE_DEV_BOT === "1";
  if (useDev) {
    const dev = process.env.BOT_TOKEN_DEV?.trim();
    if (!dev) {
      throw new Error(
        "USE_DEV_BOT включён: задайте BOT_TOKEN_DEV (токен dev-бота от @BotFather).",
      );
    }
    return dev;
  }
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("Задайте переменную окружения BOT_TOKEN (токен от @BotFather).");
  }
  return token;
};
