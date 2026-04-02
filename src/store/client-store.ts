import { getDb, getDbBackend, persistDb } from "../lib/db.js";
import { getNeonSql } from "../lib/neon-sql.js";

const asRowRecords = (rows: unknown): Record<string, unknown>[] =>
  Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];

export type ClientRecord = {
  telegramId: number;
  username: string | null;
  phone: string | null;
  businessName: string | null;
  consentAcceptedAt: number;
  registeredAt: number;
};

const MAX_PICKER_BUTTONS = 10;

const hasPhone = (phone: string | null | undefined): boolean =>
  phone !== null && phone !== undefined && String(phone).trim() !== "";

const hasBusinessName = (name: string | null | undefined): boolean =>
  name !== null && name !== undefined && String(name).trim() !== "";

/**
 * Шаг 1: согласие с условиями (телефон ещё не подтверждён).
 * Не затирает уже сохранённый телефон при повторном нажатии.
 */
export const saveClientConsent = async (
  telegramId: number,
  username: string | undefined,
): Promise<void> => {
  const now = Date.now();
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    await sql`
      INSERT INTO clients (telegram_id, username, consent_accepted_at, registered_at, phone, business_name)
      VALUES (${telegramId}, ${username ?? null}, ${now}, ${now}, NULL, NULL)
      ON CONFLICT (telegram_id) DO UPDATE SET
        username = COALESCE(EXCLUDED.username, clients.username),
        consent_accepted_at = EXCLUDED.consent_accepted_at
    `;
    return;
  }
  const database = getDb();
  database.run(
    `INSERT INTO clients (telegram_id, username, consent_accepted_at, registered_at, phone, business_name)
     VALUES (?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(telegram_id) DO UPDATE SET
       username = COALESCE(excluded.username, clients.username),
       consent_accepted_at = excluded.consent_accepted_at`,
    [telegramId, username ?? null, now, now],
  );
  persistDb();
};

/** Шаг 2: номер из Telegram (контакт). */
export const setClientPhone = async (telegramId: number, phone: string): Promise<void> => {
  const now = Date.now();
  const normalized = phone.trim();
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    await sql`
      UPDATE clients
      SET phone = ${normalized}, registered_at = ${now}
      WHERE telegram_id = ${telegramId}
    `;
    return;
  }
  const database = getDb();
  database.run("UPDATE clients SET phone = ?, registered_at = ? WHERE telegram_id = ?", [
    normalized,
    now,
    telegramId,
  ]);
  persistDb();
};

/** Шаг 3: ИП или название магазина — после этого регистрация завершена. */
export const setClientBusinessName = async (telegramId: number, businessName: string): Promise<void> => {
  const now = Date.now();
  const normalized = businessName.trim();
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    await sql`
      UPDATE clients
      SET business_name = ${normalized}, registered_at = ${now}
      WHERE telegram_id = ${telegramId}
    `;
    return;
  }
  const database = getDb();
  database.run("UPDATE clients SET business_name = ?, registered_at = ? WHERE telegram_id = ?", [
    normalized,
    now,
    telegramId,
  ]);
  persistDb();
};

/** Полная регистрация: телефон + название ИП/магазина. */
export const isClientRegistered = async (telegramId: number): Promise<boolean> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    const rows = asRowRecords(
      await sql`
        SELECT 1 FROM clients
        WHERE telegram_id = ${telegramId}
          AND phone IS NOT NULL
          AND TRIM(phone) <> ''
          AND business_name IS NOT NULL
          AND TRIM(business_name) <> ''
        LIMIT 1
      `,
    );
    return rows.length > 0;
  }
  const database = getDb();
  const stmt = database.prepare(
    "SELECT phone, business_name FROM clients WHERE telegram_id = ? LIMIT 1",
  );
  stmt.bind([telegramId]);
  if (!stmt.step()) {
    stmt.free();
    return false;
  }
  const obj = stmt.getAsObject() as { phone: string | null; business_name: string | null };
  stmt.free();
  return hasPhone(obj.phone) && hasBusinessName(obj.business_name);
};

/** Согласие есть, телефона ещё нет. */
export const needsPhoneVerification = async (telegramId: number): Promise<boolean> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    const rows = asRowRecords(
      await sql`
        SELECT phone FROM clients WHERE telegram_id = ${telegramId} LIMIT 1
      `,
    );
    const row = rows[0] as { phone: string | null } | undefined;
    if (!row) {
      return false;
    }
    return !hasPhone(row.phone);
  }
  const database = getDb();
  const stmt = database.prepare("SELECT phone FROM clients WHERE telegram_id = ? LIMIT 1");
  stmt.bind([telegramId]);
  if (!stmt.step()) {
    stmt.free();
    return false;
  }
  const obj = stmt.getAsObject() as { phone: string | null };
  stmt.free();
  return !hasPhone(obj.phone);
};

/** Телефон есть, название ИП/магазина ещё нет. */
export const needsBusinessName = async (telegramId: number): Promise<boolean> => {
  if (!((await hasClientRow(telegramId)) && (await hasPhoneForClient(telegramId)))) {
    return false;
  }
  const name = await getClientBusinessName(telegramId);
  return !hasBusinessName(name);
};

const hasClientRow = async (telegramId: number): Promise<boolean> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    const rows = asRowRecords(
      await sql`SELECT 1 FROM clients WHERE telegram_id = ${telegramId} LIMIT 1`,
    );
    return rows.length > 0;
  }
  const database = getDb();
  const stmt = database.prepare("SELECT 1 FROM clients WHERE telegram_id = ? LIMIT 1");
  stmt.bind([telegramId]);
  const ok = stmt.step();
  stmt.free();
  return ok;
};

const hasPhoneForClient = async (telegramId: number): Promise<boolean> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    const rows = asRowRecords(
      await sql`SELECT phone FROM clients WHERE telegram_id = ${telegramId} LIMIT 1`,
    );
    const row = rows[0] as { phone: string | null } | undefined;
    return hasPhone(row?.phone);
  }
  const database = getDb();
  const stmt = database.prepare("SELECT phone FROM clients WHERE telegram_id = ? LIMIT 1");
  stmt.bind([telegramId]);
  if (!stmt.step()) {
    stmt.free();
    return false;
  }
  const obj = stmt.getAsObject() as { phone: string | null };
  stmt.free();
  return hasPhone(obj.phone);
};

export const getClientBusinessName = async (telegramId: number): Promise<string | undefined> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    const rows = asRowRecords(
      await sql`SELECT business_name FROM clients WHERE telegram_id = ${telegramId} LIMIT 1`,
    );
    const v = (rows[0] as { business_name: string | null } | undefined)?.business_name;
    return v?.trim() ? v.trim() : undefined;
  }
  const database = getDb();
  const stmt = database.prepare("SELECT business_name FROM clients WHERE telegram_id = ? LIMIT 1");
  stmt.bind([telegramId]);
  if (!stmt.step()) {
    stmt.free();
    return undefined;
  }
  const obj = stmt.getAsObject() as { business_name: string | null };
  stmt.free();
  const v = obj.business_name;
  return v !== null && v !== undefined && String(v).trim() !== "" ? String(v).trim() : undefined;
};

/**
 * Подпись в списках заявок: сначала название ИП/магазина, иначе @username из профиля, иначе запасной вариант.
 */
export const getClientDisplayNameForOrderList = async (telegramId: number): Promise<string> => {
  const bn = await getClientBusinessName(telegramId);
  if (bn) {
    return bn;
  }
  const un = await getClientUsername(telegramId);
  if (un) {
    return `@${un}`;
  }
  return `Клиент ${telegramId}`;
};

/** Подписи для списков заявок: id клиента → название для кнопки. */
export const getBusinessNamesForTelegramIds = async (
  telegramIds: number[],
): Promise<Map<number, string>> => {
  const map = new Map<number, string>();
  const uniq = [...new Set(telegramIds)];
  for (const id of uniq) {
    map.set(id, await getClientDisplayNameForOrderList(id));
  }
  return map;
};

export const getClientUsername = async (telegramId: number): Promise<string | undefined> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    const rows = asRowRecords(
      await sql`SELECT username FROM clients WHERE telegram_id = ${telegramId} LIMIT 1`,
    );
    const u = (rows[0] as { username: string | null } | undefined)?.username;
    return u ?? undefined;
  }
  const database = getDb();
  const stmt = database.prepare("SELECT username FROM clients WHERE telegram_id = ? LIMIT 1");
  stmt.bind([telegramId]);
  if (!stmt.step()) {
    stmt.free();
    return undefined;
  }
  const obj = stmt.getAsObject() as { username: string | null };
  stmt.free();
  return obj.username ?? undefined;
};

export type PickerClient = { telegramId: number; label: string };

/** Подпись кнопки: название ИП/магазина из clients, иначе @username из clients, иначе ник из заявки, иначе id. */
const resolvePickerLabel = async (
  telegramId: number,
  orderUsernameFallback: string | undefined,
): Promise<string> => {
  const bn = await getClientBusinessName(telegramId);
  if (bn) {
    return bn;
  }
  const un = await getClientUsername(telegramId);
  if (un) {
    return `@${un}`;
  }
  const o = orderUsernameFallback?.trim();
  if (o) {
    return `@${o}`;
  }
  return `id ${telegramId}`;
};

/**
 * Кандидаты для кнопок: зарегистрированные + все, кто уже фигурировал в заявках.
 * Для каждого id подпись всегда резолвится через таблицу clients (название ИП), даже если id попал только из orders.
 */
export const listClientsForPicker = async (): Promise<PickerClient[]> => {
  const orderedIds: number[] = [];
  const idSeen = new Set<number>();
  const pushId = (id: number): void => {
    if (idSeen.has(id) || orderedIds.length >= MAX_PICKER_BUTTONS) {
      return;
    }
    idSeen.add(id);
    orderedIds.push(id);
  };

  let oRows: Record<string, unknown>[] = [];

  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    const cRows = asRowRecords(
      await sql`
        SELECT telegram_id FROM clients
        ORDER BY registered_at DESC
        LIMIT 50
      `,
    );
    for (const row of cRows) {
      pushId(Number((row as { telegram_id: number }).telegram_id));
    }
    oRows = asRowRecords(
      await sql`
        SELECT client_telegram_id, client_username FROM orders
        ORDER BY updated_at DESC
        LIMIT 100
      `,
    );
  } else {
    const database = getDb();
    let stmt = database.prepare(
      "SELECT telegram_id FROM clients ORDER BY registered_at DESC LIMIT 50",
    );
    while (stmt.step()) {
      const obj = stmt.getAsObject() as { telegram_id: number };
      pushId(obj.telegram_id);
    }
    stmt.free();
    stmt = database.prepare(
      "SELECT client_telegram_id, client_username FROM orders ORDER BY updated_at DESC LIMIT 100",
    );
    while (stmt.step()) {
      const obj = stmt.getAsObject() as {
        client_telegram_id: number;
        client_username: string | null;
      };
      oRows.push({
        client_telegram_id: obj.client_telegram_id,
        client_username: obj.client_username,
      });
    }
    stmt.free();
  }

  const orderUsernameById = new Map<number, string>();
  for (const row of oRows) {
    const id = Number((row as { client_telegram_id: number }).client_telegram_id);
    const un = (row as { client_username: string | null }).client_username;
    if (!orderUsernameById.has(id) && un?.trim()) {
      orderUsernameById.set(id, un.trim());
    }
    pushId(id);
  }

  const list: PickerClient[] = [];
  for (const id of orderedIds) {
    const label = await resolvePickerLabel(id, orderUsernameById.get(id));
    list.push({ telegramId: id, label });
  }
  return list;
};
