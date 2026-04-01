import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";
import { getNeonSql } from "./neon-sql.js";

const resolveDbPath = (): string => {
  const fromEnv = process.env.SQLITE_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "bot.db");
};

export type DbBackend = "postgres" | "sqlite";

let db: Database | null = null;
let backend: DbBackend | null = null;

export const usePostgres = (): boolean =>
  Boolean(process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim());

export const getDbBackend = (): DbBackend => {
  if (!backend) {
    throw new Error("База не инициализирована: вызовите initDb().");
  }
  return backend;
};

export const persistDb = (): void => {
  if (!db || backend !== "sqlite") {
    return;
  }
  const filePath = resolveDbPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const data = db.export();
  fs.writeFileSync(filePath, Buffer.from(data));
};

const initSqlite = async (): Promise<void> => {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
  });
  const filePath = resolveDbPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS user_role_lock (
      telegram_user_id INTEGER PRIMARY KEY,
      role TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client_telegram_id INTEGER NOT NULL,
      client_username TEXT,
      status TEXT NOT NULL,
      product TEXT NOT NULL,
      quantity_text TEXT NOT NULL,
      tz TEXT NOT NULL,
      needs_pickup INTEGER NOT NULL,
      pickup_points_json TEXT NOT NULL,
      delivery_marketplace TEXT NOT NULL,
      delivery_warehouse_id TEXT NOT NULL,
      comment TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      driver_unload_pending INTEGER NOT NULL
    );
  `);
  persistDb();
};

const initPostgres = async (): Promise<void> => {
  const sql = getNeonSql();
  await sql`
    CREATE TABLE IF NOT EXISTS user_role_lock (
      telegram_user_id BIGINT PRIMARY KEY,
      role TEXT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client_telegram_id BIGINT NOT NULL,
      client_username TEXT,
      status TEXT NOT NULL,
      product TEXT NOT NULL,
      quantity_text TEXT NOT NULL,
      tz TEXT NOT NULL,
      needs_pickup INTEGER NOT NULL,
      pickup_points_json TEXT NOT NULL,
      delivery_marketplace TEXT NOT NULL,
      delivery_warehouse_id TEXT NOT NULL,
      comment TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      driver_unload_pending INTEGER NOT NULL
    )
  `;
};

export const initDb = async (): Promise<void> => {
  if (backend) {
    return;
  }
  if (usePostgres()) {
    backend = "postgres";
    await initPostgres();
    return;
  }
  backend = "sqlite";
  await initSqlite();
};

export const getDb = (): Database => {
  if (!db || backend !== "sqlite") {
    throw new Error("SQLite не инициализирована: вызовите initDb() или используйте только orderStore/user-role-store.");
  }
  return db;
};
