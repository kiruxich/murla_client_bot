import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { orderStore } from "../src/store/order-store.js";
import { getLockedRole } from "../src/store/user-role-store.js";
import { getLastSelectedBotRole } from "../src/store/last-bot-role-store.js";
import { canUseRole } from "../src/lib/access.js";
import { ORDER_STATUS_LABEL } from "../src/config/order-statuses.js";
import type { FulfillmentOrder } from "../src/domain/order.js";
import { formatOrderHtml } from "../src/bot/format.js";

let dbReady = false;

export default async (req: any, res: any): Promise<void> => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!dbReady) {
    try {
      await initDb();
      dbReady = true;
    } catch (err) {
      console.error("miniapp-orders-list initDb", err);
      res.status(503).json({ ok: false, error: "db_unavailable" });
      return;
    }
  }

  let token: string;
  try {
    token = getBotToken();
  } catch {
    res.status(500).json({ ok: false, error: "no_bot_token" });
    return;
  }

  const query = req.query || {};
  const initData = typeof query.initData === "string" ? query.initData : "";
  if (!initData) {
    res.status(400).json({ ok: false, error: "initData_required" });
    return;
  }

  const uid = parseUserIdFromWebAppInitData(initData, token);
  if (uid === null) {
    res.status(401).json({ ok: false, error: "invalid_init_data" });
    return;
  }

  // Определяем роль пользователя
  let effectiveRole = await getLockedRole(uid);
  if (!effectiveRole) {
    const last = await getLastSelectedBotRole(uid);
    if (last && canUseRole(uid, last)) {
      effectiveRole = last;
    }
  }
  if (!effectiveRole) effectiveRole = "client";

  try {
    // Загружаем все заявки из хранилища
    const allOrders = await orderStore.list();

    // Фильтруем в зависимости от роли
    let filteredOrders: FulfillmentOrder[] = [];

    if (effectiveRole === "client") {
      // Клиент видит только свои заявки
      filteredOrders = allOrders.filter((o) => o.clientTelegramId === uid);
    } else if (effectiveRole === "packer") {
      // Пакер видит заявки в статусах: accepted, receiving, receiving_done
      filteredOrders = allOrders.filter((o) =>
        ["accepted", "receiving", "receiving_done"].includes(o.status)
      );
    } else if (effectiveRole === "driver") {
      // Водитель видит заявки в статусах: ready_for_delivery, delivering, delivered
      filteredOrders = allOrders.filter((o) =>
        ["ready_for_delivery", "delivering", "delivered"].includes(o.status)
      );
    } else if (effectiveRole === "manager" || effectiveRole === "supervisor") {
      // Менеджер/управляющий видят ВСЕ заявки
      filteredOrders = allOrders;
    }

    // Группируем по статусам
    const grouped: Record<string, FulfillmentOrder[]> = {};
    for (const order of filteredOrders) {
      const status = order.status;
      if (!grouped[status]) {
        grouped[status] = [];
      }
      grouped[status].push(order);
    }

    // Форматируем ответ
    const result: Record<string, any[]> = {};
    for (const [status, orders] of Object.entries(grouped)) {
      result[status] = orders.map((o) => ({
        id: o.id,
        status: o.status,
        statusLabel: ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL] || status,
        clientTelegramId: o.clientTelegramId,
        clientUsername: o.clientUsername || "Неизвестный клиент",
        product: o.product,
        quantityText: o.quantityText,
        marketplace: o.delivery.marketplace,
        createdAt: o.createdAt,
        approvedDeliveryDate: o.approvedDeliveryDate || null,
      }));
    }

    res.status(200).json({ ok: true, orders: result });
  } catch (err) {
    console.error("miniapp-orders-list error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
};
