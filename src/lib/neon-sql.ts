import { neon } from "@neondatabase/serverless";

let sql: ReturnType<typeof neon> | null = null;

/** Строка подключения: Vercel Postgres / Neon задаёт `POSTGRES_URL` (или `DATABASE_URL`). */
export const getNeonSql = (): ReturnType<typeof neon> => {
  if (sql) {
    return sql;
  }
  const url = process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("Задайте POSTGRES_URL или DATABASE_URL для PostgreSQL.");
  }
  sql = neon(url);
  return sql;
};
