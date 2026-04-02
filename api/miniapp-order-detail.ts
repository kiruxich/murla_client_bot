import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { orderStore } from "../src/store/order-store.js";
import { getLockedRole } from "../src/store/user-role-store.js";
import { getLastSelectedBotRole } from "../src/store/last-bot-role-store.js";
import { canUseRole } from "../src/lib/access.js";
import { ORDER_STATUS_LABEL } from "../src/config/order-statuses.js";
import { MARKETPLACE_LABEL } from "../src/config/marketplaces.js";
import { findWarehouseById } from "../src/config/warehouses.js";

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
      console.error("miniapp-order-detail initDb", err);
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
  const orderId = typeof query.id === "string" ? query.id : "";
  const initData = typeof query.initData === "string" ? query.initData : "";

  if (!orderId || !initData) {
    res.status(400).json({ ok: false, error: "missing_params" });
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
    const order = await orderStore.get(orderId);
    if (!order) {
      res.status(404).json({ ok: false, error: "order_not_found" });
      return;
    }

    // Проверяем доступ
    if (effectiveRole === "client" && order.clientTelegramId !== uid) {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }

    const warehouse = findWarehouseById(order.delivery.warehouseId);

    const result = {
      ok: true,
      order: {
        id: order.id,
        status: order.status,
        statusLabel: ORDER_STATUS_LABEL[order.status] || order.status,
        clientTelegramId: order.clientTelegramId,
        clientUsername: order.clientUsername || "Неизвестный клиент",
        product: order.product,
        quantityText: order.quantityText,
        tz: order.tz,
        needsPickup: order.needsPickup,
        pickupPoints: order.pickupPoints,
        marketplace: order.delivery.marketplace,
        marketplaceLabel: MARKETPLACE_LABEL[order.delivery.marketplace],
        warehouseId: order.delivery.warehouseId,
        warehouseName: warehouse?.label || "Неизвестный склад",
        desiredDeliveryDate: order.desiredDeliveryDate || null,
        approvedDeliveryDate: order.approvedDeliveryDate || null,
        comment: order.comment || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        driverUnloadPending: order.driverUnloadPending,
        // Определяем доступные действия
        availableActions: getAvailableActions(effectiveRole, order.status),
      },
    };

    res.status(200).json(result);
  } catch (err) {
    console.error("miniapp-order-detail error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
};

function getAvailableActions(role: string, status: string): string[] {
  const actions: string[] = [];

  if (role === "packer") {
    if (status === "accepted") actions.push("start_receiving");
    if (status === "receiving") actions.push("finish_receiving");
    if (status === "receiving_done") actions.push("send_to_sort");
  } else if (role === "driver") {
    if (status === "ready_for_unload") actions.push("start_delivery");
    if (status === "in_transit") actions.push("complete_delivery");
  } else if (role === "manager" || role === "supervisor") {
    // Менеджеры могут выполнять разные действия в зависимости от статуса
    if (status === "accepted") actions.push("start_receiving");
    if (status === "receiving") actions.push("finish_receiving");
    if (status === "receiving_done") actions.push("send_to_sort");
    if (status === "ready_for_unload") actions.push("start_delivery");
    if (status === "in_transit") actions.push("complete_delivery");
    if (status === "draft") actions.push("finalize_order");
  }

  return actions;
}
