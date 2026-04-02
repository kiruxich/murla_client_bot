import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { orderStore } from "../src/store/order-store.js";
import { getLockedRole } from "../src/store/user-role-store.js";
import { getLastSelectedBotRole } from "../src/store/last-bot-role-store.js";
import { canUseRole } from "../src/lib/access.js";
import { findWarehouseById } from "../src/config/warehouses.js";
import { MARKETPLACES, type MarketplaceId } from "../src/config/marketplaces.js";

let dbReady = false;

const isMarketplaceId = (v: unknown): v is MarketplaceId =>
  typeof v === "string" && (MARKETPLACES as readonly string[]).includes(v);

export default async (req: any, res: any): Promise<void> => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!dbReady) {
    try {
      await initDb();
      dbReady = true;
    } catch (err) {
      console.error("miniapp-order-edit initDb", err);
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

  const body = req.body || {};
  const initData = typeof body?.initData === "string" ? body.initData : "";
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";

  if (!initData || !orderId) {
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

    // Проверяем доступ (только клиент своей заявки или менеджер/управляющий)
    if (effectiveRole === "client" && order.clientTelegramId !== uid) {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }
    if (!["client", "manager", "supervisor"].includes(effectiveRole)) {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }

    // Можно редактировать только черновики и отправленные (не в работе)
    if (!["draft"].includes(order.status)) {
      res.status(400).json({ ok: false, error: "cannot_edit_order" });
      return;
    }

    // Получаем новые данные
    const product = typeof body?.product === "string" ? body.product.trim() : order.product;
    const quantityText = typeof body?.quantityText === "string" ? body.quantityText.trim() : order.quantityText;
    const tz = typeof body?.tz === "string" ? body.tz.trim() : order.tz;
    const needsPickup = typeof body?.needsPickup === "boolean" ? body.needsPickup : order.needsPickup;
    const marketplace = body?.marketplace || order.delivery.marketplace;
    const warehouseId = typeof body?.warehouseId === "string" ? body.warehouseId.trim() : order.delivery.warehouseId;
    const desiredDeliveryDate = typeof body?.desiredDeliveryDate === "string" ? body.desiredDeliveryDate.trim() : (order.desiredDeliveryDate || "");
    const comment = typeof body?.comment === "string" ? body.comment.trim() : (order.comment || "");

    // Валидация
    if (!product || !quantityText || !tz) {
      res.status(400).json({ ok: false, error: "missing_fields" });
      return;
    }
    if (!isMarketplaceId(marketplace)) {
      res.status(400).json({ ok: false, error: "invalid_marketplace" });
      return;
    }
    const wh = findWarehouseById(warehouseId);
    if (!wh || wh.marketplace !== marketplace) {
      res.status(400).json({ ok: false, error: "invalid_warehouse" });
      return;
    }

    // Обновляем заявку
    const updated = await orderStore.update(orderId, {
      product,
      quantityText,
      tz,
      needsPickup,
      delivery: {
        marketplace: marketplace as MarketplaceId,
        warehouseId,
      },
      desiredDeliveryDate: desiredDeliveryDate || undefined,
      comment: comment || undefined,
    });

    if (!updated) {
      res.status(500).json({ ok: false, error: "update_failed" });
      return;
    }

    res.status(200).json({
      ok: true,
      message: "Заявка обновлена",
      order: {
        id: updated.id,
        product: updated.product,
        quantityText: updated.quantityText,
      },
    });
  } catch (err) {
    console.error("miniapp-order-edit error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
};
