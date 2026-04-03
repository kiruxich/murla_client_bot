import type { MarketplaceId } from "../config/marketplaces.js";
import type { OrderStatusId } from "../config/order-statuses.js";
import type { DeliveryPoint, FulfillmentOrder, PickupPoint } from "../domain/order.js";
import { getDb, getDbBackend, persistDb } from "../lib/db.js";
import { parsePickupPointsFromJson } from "../lib/pickup-points.js";
import { getNeonSql } from "../lib/neon-sql.js";

export type CreateOrderInput = {
  clientTelegramId: number;
  clientUsername?: string;
  /** Заполняется при оформлении заявки менеджером/управляющим за клиента. */
  createdByTelegramId?: number;
  product: string;
  quantityText: string;
  tz: string;
  needsPickup: boolean;
  pickupPoints: PickupPoint[];
  delivery: DeliveryPoint;
  desiredDeliveryDate?: string;
  comment?: string;
};

type OrderRow = {
  id: string;
  client_telegram_id: number;
  client_username: string | null;
  status: string;
  product: string;
  quantity_text: string;
  tz: string;
  needs_pickup: number;
  pickup_points_json: string;
  delivery_marketplace: string;
  delivery_warehouse_id: string;
  desired_delivery_date: string | null;
  approved_delivery_date: string | null;
  comment: string | null;
  created_at: number;
  updated_at: number;
  driver_unload_pending: number;
  created_by_telegram_id: number | null;
};

const rowToOrder = (row: OrderRow): FulfillmentOrder => {
  const pickupPoints = parsePickupPointsFromJson(row.pickup_points_json);
  return {
    id: row.id,
    clientTelegramId: row.client_telegram_id,
    clientUsername: row.client_username ?? undefined,
    createdByTelegramId:
      row.created_by_telegram_id === null || row.created_by_telegram_id === undefined
        ? undefined
        : Number(row.created_by_telegram_id),
    status: row.status as OrderStatusId,
    product: row.product,
    quantityText: row.quantity_text,
    tz: row.tz,
    needsPickup: row.needs_pickup === 1,
    pickupPoints,
    delivery: {
      marketplace: row.delivery_marketplace as MarketplaceId,
      warehouseId: row.delivery_warehouse_id,
    },
    desiredDeliveryDate: row.desired_delivery_date?.trim()
      ? row.desired_delivery_date.trim()
      : undefined,
    approvedDeliveryDate: row.approved_delivery_date?.trim()
      ? row.approved_delivery_date.trim()
      : undefined,
    comment: row.comment?.trim() ? row.comment : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    driverUnloadPending: row.driver_unload_pending === 1,
  };
};

const pgRowToOrderRow = (row: Record<string, unknown>): OrderRow => ({
  id: String(row.id),
  client_telegram_id: Number(row.client_telegram_id),
  client_username:
    row.client_username === null || row.client_username === undefined
      ? null
      : String(row.client_username),
  status: String(row.status),
  product: String(row.product),
  quantity_text: String(row.quantity_text),
  tz: String(row.tz),
  needs_pickup: Number(row.needs_pickup),
  pickup_points_json: String(row.pickup_points_json),
  delivery_marketplace: String(row.delivery_marketplace),
  delivery_warehouse_id: String(row.delivery_warehouse_id),
  desired_delivery_date:
    row.desired_delivery_date === null || row.desired_delivery_date === undefined
      ? null
      : String(row.desired_delivery_date),
  approved_delivery_date:
    row.approved_delivery_date === null || row.approved_delivery_date === undefined
      ? null
      : String(row.approved_delivery_date),
  comment: row.comment === null || row.comment === undefined ? null : String(row.comment),
  created_at: Number(row.created_at),
  updated_at: Number(row.updated_at),
  driver_unload_pending: Number(row.driver_unload_pending),
  created_by_telegram_id:
    row.created_by_telegram_id === null || row.created_by_telegram_id === undefined
      ? null
      : Number(row.created_by_telegram_id),
});

const sqliteGetRow = (id: string): OrderRow | undefined => {
  const database = getDb();
  const stmt = database.prepare("SELECT * FROM orders WHERE id = ?");
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    return undefined;
  }
  const obj = stmt.getAsObject() as Record<string, string | number | null | Uint8Array>;
  stmt.free();
  return {
    id: String(obj.id),
    client_telegram_id: Number(obj.client_telegram_id),
    client_username: obj.client_username === null || obj.client_username === undefined ? null : String(obj.client_username),
    status: String(obj.status),
    product: String(obj.product),
    quantity_text: String(obj.quantity_text),
    tz: String(obj.tz),
    needs_pickup: Number(obj.needs_pickup),
    pickup_points_json: String(obj.pickup_points_json),
    delivery_marketplace: String(obj.delivery_marketplace),
    delivery_warehouse_id: String(obj.delivery_warehouse_id),
    desired_delivery_date:
      obj.desired_delivery_date === null || obj.desired_delivery_date === undefined
        ? null
        : String(obj.desired_delivery_date),
    approved_delivery_date:
      obj.approved_delivery_date === null || obj.approved_delivery_date === undefined
        ? null
        : String(obj.approved_delivery_date),
    comment: obj.comment === null || obj.comment === undefined ? null : String(obj.comment),
    created_at: Number(obj.created_at),
    updated_at: Number(obj.updated_at),
    driver_unload_pending: Number(obj.driver_unload_pending),
    created_by_telegram_id:
      obj.created_by_telegram_id === null || obj.created_by_telegram_id === undefined
        ? null
        : Number(obj.created_by_telegram_id),
  };
};

const sqliteNextId = (): string => {
  const database = getDb();
  const res = database.exec(
    "SELECT MAX(CAST(id AS INTEGER)) AS m FROM orders WHERE id GLOB '[0-9]*'",
  );
  let max = 0;
  if (res.length > 0 && res[0].values.length > 0) {
    const v = res[0].values[0][0];
    if (typeof v === "number" && !Number.isNaN(v)) {
      max = v;
    }
  }
  return String(max + 1);
};

const sqliteInsertOrder = (o: FulfillmentOrder): void => {
  const database = getDb();
  database.run(
    `INSERT INTO orders (
        id, client_telegram_id, client_username, status,
        product, quantity_text, tz, needs_pickup, pickup_points_json,
        delivery_marketplace, delivery_warehouse_id, desired_delivery_date, approved_delivery_date, comment,
        created_at, updated_at, driver_unload_pending, created_by_telegram_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      o.id,
      o.clientTelegramId,
      o.clientUsername ?? null,
      o.status,
      o.product,
      o.quantityText,
      o.tz,
      o.needsPickup ? 1 : 0,
      JSON.stringify(o.pickupPoints),
      o.delivery.marketplace,
      o.delivery.warehouseId,
      o.desiredDeliveryDate ?? null,
      o.approvedDeliveryDate ?? null,
      o.comment ?? null,
      o.createdAt,
      o.updatedAt,
      o.driverUnloadPending ? 1 : 0,
      o.createdByTelegramId ?? null,
    ],
  );
  persistDb();
};

const sqliteReplaceOrder = (o: FulfillmentOrder): void => {
  const database = getDb();
  database.run(
    `UPDATE orders SET
        client_telegram_id = ?,
        client_username = ?,
        status = ?,
        product = ?,
        quantity_text = ?,
        tz = ?,
        needs_pickup = ?,
        pickup_points_json = ?,
        delivery_marketplace = ?,
        delivery_warehouse_id = ?,
        desired_delivery_date = ?,
        approved_delivery_date = ?,
        comment = ?,
        created_at = ?,
        updated_at = ?,
        driver_unload_pending = ?,
        created_by_telegram_id = ?
      WHERE id = ?`,
    [
      o.clientTelegramId,
      o.clientUsername ?? null,
      o.status,
      o.product,
      o.quantityText,
      o.tz,
      o.needsPickup ? 1 : 0,
      JSON.stringify(o.pickupPoints),
      o.delivery.marketplace,
      o.delivery.warehouseId,
      o.desiredDeliveryDate ?? null,
      o.approvedDeliveryDate ?? null,
      o.comment ?? null,
      o.createdAt,
      o.updatedAt,
      o.driverUnloadPending ? 1 : 0,
      o.createdByTelegramId ?? null,
      o.id,
    ],
  );
  persistDb();
};

const asRowRecords = (rows: unknown): Record<string, unknown>[] =>
  Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];

const pgNextId = async (): Promise<string> => {
  const sql = getNeonSql();
  const rows = asRowRecords(
    await sql`
    SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) AS m
    FROM orders
    WHERE id ~ '^[0-9]+$'
  `,
  );
  const m = Number((rows[0] as { m: number } | undefined)?.m ?? 0);
  return String(m + 1);
};

const pgInsertOrder = async (o: FulfillmentOrder): Promise<void> => {
  const sql = getNeonSql();
  await sql`
    INSERT INTO orders (
      id, client_telegram_id, client_username, status,
      product, quantity_text, tz, needs_pickup, pickup_points_json,
      delivery_marketplace, delivery_warehouse_id, desired_delivery_date, approved_delivery_date, comment,
      created_at, updated_at, driver_unload_pending, created_by_telegram_id
    ) VALUES (
      ${o.id},
      ${o.clientTelegramId},
      ${o.clientUsername ?? null},
      ${o.status},
      ${o.product},
      ${o.quantityText},
      ${o.tz},
      ${o.needsPickup ? 1 : 0},
      ${JSON.stringify(o.pickupPoints)},
      ${o.delivery.marketplace},
      ${o.delivery.warehouseId},
      ${o.desiredDeliveryDate ?? null},
      ${o.approvedDeliveryDate ?? null},
      ${o.comment ?? null},
      ${o.createdAt},
      ${o.updatedAt},
      ${o.driverUnloadPending ? 1 : 0},
      ${o.createdByTelegramId ?? null}
    )
  `;
};

const pgReplaceOrder = async (o: FulfillmentOrder): Promise<void> => {
  const sql = getNeonSql();
  await sql`
    UPDATE orders SET
      client_telegram_id = ${o.clientTelegramId},
      client_username = ${o.clientUsername ?? null},
      status = ${o.status},
      product = ${o.product},
      quantity_text = ${o.quantityText},
      tz = ${o.tz},
      needs_pickup = ${o.needsPickup ? 1 : 0},
      pickup_points_json = ${JSON.stringify(o.pickupPoints)},
      delivery_marketplace = ${o.delivery.marketplace},
      delivery_warehouse_id = ${o.delivery.warehouseId},
      desired_delivery_date = ${o.desiredDeliveryDate ?? null},
      approved_delivery_date = ${o.approvedDeliveryDate ?? null},
      comment = ${o.comment ?? null},
      created_at = ${o.createdAt},
      updated_at = ${o.updatedAt},
      driver_unload_pending = ${o.driverUnloadPending ? 1 : 0},
      created_by_telegram_id = ${o.createdByTelegramId ?? null}
    WHERE id = ${o.id}
  `;
};

export const orderStore = {
  async create(input: CreateOrderInput): Promise<FulfillmentOrder> {
    const now = Date.now();
    // Если создается менеджером "за клиента", статус = accepted, иначе draft
    const status: OrderStatusId = input.createdByTelegramId ? "accepted" : "draft";
    
    if (getDbBackend() === "postgres") {
      const id = await pgNextId();
      const o: FulfillmentOrder = {
        id,
        clientTelegramId: input.clientTelegramId,
        clientUsername: input.clientUsername,
        createdByTelegramId: input.createdByTelegramId,
        status,
        product: input.product,
        quantityText: input.quantityText,
        tz: input.tz,
        needsPickup: input.needsPickup,
        pickupPoints: [...input.pickupPoints],
        delivery: { ...input.delivery },
        desiredDeliveryDate: input.desiredDeliveryDate?.trim() || undefined,
        comment: input.comment?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
        driverUnloadPending: false,
      };
      await pgInsertOrder(o);
      return o;
    }
    const o: FulfillmentOrder = {
      id: sqliteNextId(),
      clientTelegramId: input.clientTelegramId,
      clientUsername: input.clientUsername,
      createdByTelegramId: input.createdByTelegramId,
      status,
      product: input.product,
      quantityText: input.quantityText,
      tz: input.tz,
      needsPickup: input.needsPickup,
      pickupPoints: [...input.pickupPoints],
      delivery: { ...input.delivery },
      desiredDeliveryDate: input.desiredDeliveryDate?.trim() || undefined,
      comment: input.comment?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      driverUnloadPending: false,
    };
    sqliteInsertOrder(o);
    return o;
  },

  async get(id: string): Promise<FulfillmentOrder | undefined> {
    if (getDbBackend() === "postgres") {
      const sql = getNeonSql();
      const rows = asRowRecords(await sql`SELECT * FROM orders WHERE id = ${id}`);
      const row = rows[0];
      if (!row) {
        return undefined;
      }
      return rowToOrder(pgRowToOrderRow(row));
    }
    const r = sqliteGetRow(id);
    if (!r) {
      return undefined;
    }
    return rowToOrder(r);
  },

  async list(): Promise<FulfillmentOrder[]> {
    if (getDbBackend() === "postgres") {
      const sql = getNeonSql();
      const rows = asRowRecords(await sql`SELECT * FROM orders ORDER BY updated_at DESC`);
      return rows.map((row) => rowToOrder(pgRowToOrderRow(row)));
    }
    const database = getDb();
    const stmt = database.prepare("SELECT * FROM orders ORDER BY updated_at DESC");
    const rows: OrderRow[] = [];
    while (stmt.step()) {
      const obj = stmt.getAsObject() as Record<string, string | number | null | Uint8Array>;
      rows.push({
        id: String(obj.id),
        client_telegram_id: Number(obj.client_telegram_id),
        client_username:
          obj.client_username === null || obj.client_username === undefined
            ? null
            : String(obj.client_username),
        status: String(obj.status),
        product: String(obj.product),
        quantity_text: String(obj.quantity_text),
        tz: String(obj.tz),
        needs_pickup: Number(obj.needs_pickup),
        pickup_points_json: String(obj.pickup_points_json),
        delivery_marketplace: String(obj.delivery_marketplace),
        delivery_warehouse_id: String(obj.delivery_warehouse_id),
        desired_delivery_date:
          obj.desired_delivery_date === null || obj.desired_delivery_date === undefined
            ? null
            : String(obj.desired_delivery_date),
        approved_delivery_date:
          obj.approved_delivery_date === null || obj.approved_delivery_date === undefined
            ? null
            : String(obj.approved_delivery_date),
        comment: obj.comment === null || obj.comment === undefined ? null : String(obj.comment),
        created_at: Number(obj.created_at),
        updated_at: Number(obj.updated_at),
        driver_unload_pending: Number(obj.driver_unload_pending),
        created_by_telegram_id:
          obj.created_by_telegram_id === null || obj.created_by_telegram_id === undefined
            ? null
            : Number(obj.created_by_telegram_id),
      });
    }
    stmt.free();
    return rows.map((r) => rowToOrder(r));
  },

  async listByClient(telegramId: number): Promise<FulfillmentOrder[]> {
    if (getDbBackend() === "postgres") {
      const sql = getNeonSql();
      const rows = asRowRecords(
        await sql`
        SELECT * FROM orders
        WHERE client_telegram_id = ${telegramId}
        ORDER BY updated_at DESC
      `,
      );
      return rows.map((row) => rowToOrder(pgRowToOrderRow(row)));
    }
    const all = await this.list();
    return all.filter((o) => o.clientTelegramId === telegramId);
  },

  async update(id: string, patch: Partial<FulfillmentOrder>): Promise<FulfillmentOrder | undefined> {
    const o = await this.get(id);
    if (!o) {
      return undefined;
    }
    const next: FulfillmentOrder = {
      ...o,
      ...patch,
      updatedAt: Date.now(),
      pickupPoints:
        patch.pickupPoints !== undefined ? [...patch.pickupPoints] : [...o.pickupPoints],
      delivery: patch.delivery !== undefined ? { ...patch.delivery } : { ...o.delivery },
    };
    if (getDbBackend() === "postgres") {
      await pgReplaceOrder(next);
    } else {
      sqliteReplaceOrder(next);
    }
    return next;
  },

  async setStatus(id: string, status: OrderStatusId): Promise<FulfillmentOrder | undefined> {
    return this.update(id, { status });
  },

  async setDriverUnloadPending(id: string, pending: boolean): Promise<FulfillmentOrder | undefined> {
    return this.update(id, { driverUnloadPending: pending });
  },

  async setApprovedDeliveryDate(id: string, date: string): Promise<FulfillmentOrder | undefined> {
    return this.update(id, { approvedDeliveryDate: date });
  },

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) {
      return false;
    }
    if (getDbBackend() === "postgres") {
      const sql = getNeonSql();
      await sql`DELETE FROM orders WHERE id = ${id}`;
      return true;
    }
    const database = getDb();
    database.run("DELETE FROM orders WHERE id = ?", [id]);
    persistDb();
    return true;
  },
};

export const resetOrderStoreForTests = async (): Promise<void> => {
  if (getDbBackend() === "postgres") {
    const sql = getNeonSql();
    await sql`DELETE FROM orders`;
    return;
  }
  const database = getDb();
  database.run("DELETE FROM orders");
  persistDb();
};
