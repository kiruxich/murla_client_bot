/**
 * На Vercel после подключения Postgres в проект обычно появляется `POSTGRES_URL`
 * (иногда дублируется как `DATABASE_URL`). Если задано — бот использует Neon/Postgres вместо локального SQLite.
 */
export const getPostgresUrl = (): string | undefined =>
  process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();

export const getBotToken = (): string => {
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("Задайте переменную окружения BOT_TOKEN (токен от @BotFather).");
  }
  return token;
};
