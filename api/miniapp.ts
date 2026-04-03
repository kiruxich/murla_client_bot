import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { orderStore } from "../src/store/order-store.js";
import { getLockedRole } from "../src/store/user-role-store.js";
import { getLastSelectedBotRole } from "../src/store/last-bot-role-store.js";
import { canUseRole } from "../src/lib/access.js";
import { isBotRole } from "../src/lib/roles.js";
import { ORDER_STATUS_LABEL } from "../src/config/order-statuses.js";
import { MARKETPLACE_LABEL } from "../src/config/marketplaces.js";
import { findWarehouseById } from "../src/config/warehouses.js";
import { canShowSwitchRoleInMiniApp } from "../src/lib/miniapp-role.js";
import { isClientRegistered, needsPhoneVerification, needsBusinessName } from "../src/store/client-store.js";
import type { FulfillmentOrder } from "../src/domain/order.js";

let dbReady = false;

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
  replyMarkup?: object,
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Action = "config" | "orders-list" | "order-detail" | "order-status" | "order-edit" | "drafts" | 
  "edit-business" | "delete-draft" | "create-order" | "register" | "switch-role" | "clients-list";

export default async (req: any, res: any): Promise<void> => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (!dbReady) {
    try {
      await initDb();
      dbReady = true;
    } catch (err) {
      console.error("[miniapp] initDb error", err);
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
  const body = req.body || {};
  const action: Action = (query.action || body.action || "config") as Action;

  try {
    // Операции, не требующие инициализации DB
    if (action === "config") {
      return handleConfig(req, res, token);
    }

    const initData = typeof query.initData === "string" ? query.initData : 
                     typeof body.initData === "string" ? body.initData : "";
    
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

    // Маршрутизация по action
    switch (action) {
      case "orders-list":
        return handleOrdersList(req, res, uid, effectiveRole);
      case "order-detail":
        return handleOrderDetail(req, res, uid, effectiveRole);
      case "order-status":
        return handleOrderStatus(req, res, uid, effectiveRole, token);
      case "order-edit":
        return handleOrderEdit(req, res, uid, effectiveRole);
      case "drafts":
        return handleDrafts(req, res, uid);
      case "edit-business":
        return handleEditBusiness(req, res, uid);
      case "delete-draft":
        return handleDeleteDraft(req, res, uid);
      case "create-order":
        return handleCreateOrder(req, res, uid, token);
      case "register":
        return handleRegister(req, res, uid, token);
      case "switch-role":
        return handleSwitchRole(req, res, uid, token);
      case "clients-list":
        return handleClientsList(req, res, uid, effectiveRole);
      default:
        res.status(400).json({ ok: false, error: "unknown_action" });
    }
  } catch (err) {
    console.error(`[miniapp] action=${action} error:`, err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
};

async function handleConfig(req: any, res: any, token: string) {
  const initData = typeof req.query?.initData === "string" ? req.query.initData : "";
  if (!initData) {
    res.status(400).json({ canSwitchRole: false, error: "initData_required" });
    return;
  }

  const uid = parseUserIdFromWebAppInitData(initData, token);
  if (uid === null) {
    res.status(401).json({ canSwitchRole: false, error: "invalid_init_data" });
    return;
  }

  try {
    const canSwitchRole = await canShowSwitchRoleInMiniApp(uid);
    const lockedRole = await getLockedRole(uid);
    const lastRole = await getLastSelectedBotRole(uid);
    const currentRole = lockedRole || lastRole || "client";

    const registered = await isClientRegistered(uid);
    let registrationStep = "done";
    if (!registered) {
      const needsPhone = await needsPhoneVerification(uid);
      const needsBusiness = await needsBusinessName(uid);
      if (needsBusiness) {
        registrationStep = "business_name";
      } else if (needsPhone) {
        registrationStep = "phone";
      } else {
        registrationStep = "consent";
      }
    }

    res.status(200).json({ ok: true, canSwitchRole, currentRole, registered, registrationStep });
  } catch (err) {
    console.error("[miniapp] config error:", err);
    res.status(500).json({ ok: false, canSwitchRole: false, error: "internal" });
  }
}

async function handleOrdersList(req: any, res: any, uid: number, effectiveRole: string) {
  try {
    const allOrders = await orderStore.list();
    let filteredOrders: FulfillmentOrder[] = [];

    if (effectiveRole === "client") {
      filteredOrders = allOrders.filter((o) => o.clientTelegramId === uid);
    } else if (effectiveRole === "packer") {
      filteredOrders = allOrders.filter((o) =>
        ["accepted", "receiving", "receiving_done", "pack_sort"].includes(o.status)
      );
    } else if (effectiveRole === "driver") {
      filteredOrders = allOrders.filter((o) =>
        ["ready_for_unload", "in_transit"].includes(o.status)
      );
    } else if (effectiveRole === "manager" || effectiveRole === "supervisor") {
      filteredOrders = allOrders;
    }

    const grouped: Record<string, FulfillmentOrder[]> = {};
    for (const order of filteredOrders) {
      const status = order.status;
      if (!grouped[status]) grouped[status] = [];
      grouped[status].push(order);
    }

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
    console.error("[miniapp] orders-list error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleOrderDetail(req: any, res: any, uid: number, effectiveRole: string) {
  try {
    const query = req.query || {};
    const body = req.body || {};
    const orderId = typeof query.id === "string" ? query.id : 
                    typeof body.id === "string" ? body.id : "";

    if (!orderId) {
      res.status(400).json({ ok: false, error: "missing_id" });
      return;
    }

    const order = await orderStore.get(orderId);
    if (!order) {
      res.status(404).json({ ok: false, error: "order_not_found" });
      return;
    }

    if (effectiveRole === "client" && order.clientTelegramId !== uid) {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }

    const warehouse = findWarehouseById(order.delivery.warehouseId);

    res.status(200).json({
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
        availableActions: getAvailableActions(effectiveRole, order.status),
      },
    });
  } catch (err) {
    console.error("[miniapp] order-detail error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleOrderStatus(req: any, res: any, uid: number, effectiveRole: string, token: string) {
  try {
    const body = req.body || {};
    const orderId = body.id || "";
    const action = body.action || "";

    if (!orderId || !action) {
      res.status(400).json({ ok: false, error: "missing_params" });
      return;
    }

    const order = await orderStore.get(orderId);
    if (!order) {
      res.status(404).json({ ok: false, error: "order_not_found" });
      return;
    }

    let newStatus: string | null = null;

    if (effectiveRole === "packer") {
      if (action === "start_receiving" && order.status === "accepted") newStatus = "receiving";
      if (action === "finish_receiving" && order.status === "receiving") newStatus = "receiving_done";
      if (action === "send_to_sort" && order.status === "receiving_done") newStatus = "pack_sort";
      if (action === "ready_for_unload" && order.status === "pack_sort") newStatus = "ready_for_unload";
    } else if (effectiveRole === "driver") {
      if (action === "start_delivery" && order.status === "ready_for_unload") newStatus = "in_transit";
      if (action === "complete_delivery" && order.status === "in_transit") newStatus = "done";
    } else if (effectiveRole === "manager" || effectiveRole === "supervisor") {
      if (action === "start_receiving") newStatus = "receiving";
      if (action === "finish_receiving") newStatus = "receiving_done";
      if (action === "send_to_sort") newStatus = "pack_sort";
      if (action === "ready_for_unload") newStatus = "ready_for_unload";
      if (action === "start_delivery") newStatus = "in_transit";
      if (action === "complete_delivery") newStatus = "done";
    }

    if (!newStatus) {
      res.status(400).json({ ok: false, error: "invalid_action" });
      return;
    }

    const updated = await orderStore.update(orderId, { status: newStatus as any });

    if (!updated) {
      res.status(500).json({ ok: false, error: "update_failed" });
      return;
    }

    try {
      const roleLabel = {
        packer: "Работник склада",
        driver: "Водитель",
        manager: "Менеджер",
        supervisor: "Управляющий",
      }[effectiveRole] || "Пользователь";

      const msg = `✅ <b>Статус заявки №${orderId.substring(0, 8)}</b>\n` +
        `${ORDER_STATUS_LABEL[newStatus as keyof typeof ORDER_STATUS_LABEL] || newStatus}\n` +
        `Изменено: ${roleLabel}`;

      await sendTelegramMessage(token, order.clientTelegramId, msg);
      await sleep(40);
    } catch { /* ignore */ }

    res.status(200).json({
      ok: true,
      order: {
        id: updated.id,
        status: updated.status,
        statusLabel: ORDER_STATUS_LABEL[updated.status] || updated.status,
      },
    });
  } catch (err) {
    console.error("[miniapp] order-status error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleOrderEdit(req: any, res: any, uid: number, effectiveRole: string) {
  try {
    const body = req.body || {};
    const orderId = typeof body?.orderId === "string" ? body.orderId : "";

    if (!orderId) {
      res.status(400).json({ ok: false, error: "missing_id" });
      return;
    }

    const order = await orderStore.get(orderId);
    if (!order) {
      res.status(404).json({ ok: false, error: "order_not_found" });
      return;
    }

    if (effectiveRole === "client" && order.clientTelegramId !== uid) {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }
    if (!["client", "manager", "supervisor"].includes(effectiveRole)) {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }

    if (!["draft"].includes(order.status)) {
      res.status(400).json({ ok: false, error: "cannot_edit_order" });
      return;
    }

    const product = typeof body?.product === "string" ? body.product.trim() : order.product;
    const quantityText = typeof body?.quantityText === "string" ? body.quantityText.trim() : order.quantityText;
    const tz = typeof body?.tz === "string" ? body.tz.trim() : order.tz;
    const needsPickup = typeof body?.needsPickup === "boolean" ? body.needsPickup : order.needsPickup;
    const marketplace = body?.marketplace || order.delivery.marketplace;
    const warehouseId = typeof body?.warehouseId === "string" ? body.warehouseId.trim() : order.delivery.warehouseId;
    const desiredDeliveryDate = typeof body?.desiredDeliveryDate === "string" ? body.desiredDeliveryDate.trim() : (order.desiredDeliveryDate || "");
    const comment = typeof body?.comment === "string" ? body.comment.trim() : (order.comment || "");

    if (!product || !quantityText || !tz) {
      res.status(400).json({ ok: false, error: "missing_fields" });
      return;
    }

    const wh = findWarehouseById(warehouseId);
    if (!wh || wh.marketplace !== marketplace) {
      res.status(400).json({ ok: false, error: "invalid_warehouse" });
      return;
    }

    const updated = await orderStore.update(orderId, {
      product,
      quantityText,
      tz,
      needsPickup,
      delivery: {
        marketplace: marketplace as any,
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
    console.error("[miniapp] order-edit error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleDrafts(req: any, res: any, uid: number) {
  try {
    const allOrders = await orderStore.listByClient(uid);
    const drafts = allOrders.filter((o) => o.status === "draft");

    res.status(200).json({
      ok: true,
      drafts: drafts.map((d) => ({
        id: d.id,
        product: d.product,
        quantityText: d.quantityText,
        tz: d.tz,
        marketplace: d.delivery.marketplace,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  } catch (err) {
    console.error("[miniapp] drafts error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleEditBusiness(req: any, res: any, uid: number) {
  try {
    const body = req.body || {};
    const method = req.method || "GET";

    if (method === "GET") {
      const { getBusinessNamesForTelegramIds } = await import("../src/store/client-store.js");
      const names = await getBusinessNamesForTelegramIds([uid]);
      const currentName = names.get(uid) || "";

      res.status(200).json({
        ok: true,
        businessName: currentName,
      });
    } else if (method === "POST") {
      const { setClientBusinessName } = await import("../src/store/client-store.js");
      const businessName = typeof body?.businessName === "string" ? body.businessName.trim() : "";

      if (!businessName || businessName.length < 2 || businessName.length > 200) {
        res.status(400).json({ 
          ok: false, 
          error: "invalid_business_name",
          message: "Название должно быть от 2 до 200 символов"
        });
        return;
      }

      await setClientBusinessName(uid, businessName);

      res.status(200).json({
        ok: true,
        message: "Название сохранено",
        businessName,
      });
    } else {
      res.status(405).json({ ok: false, error: "Method not allowed" });
    }
  } catch (err) {
    console.error("[miniapp] edit-business error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleDeleteDraft(req: any, res: any, uid: number) {
  try {
    const body = req.body || {};
    const draftId = typeof body?.draftId === "string" ? body.draftId : "";

    if (!draftId) {
      res.status(400).json({ ok: false, error: "missing_draftId" });
      return;
    }

    const draft = await orderStore.get(draftId);
    if (!draft) {
      res.status(404).json({ ok: false, error: "draft_not_found" });
      return;
    }

    if (draft.status !== "draft" || draft.clientTelegramId !== uid) {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }

    const updated = await orderStore.update(draftId, {
      status: "cancelled",
    });

    if (!updated) {
      res.status(500).json({ ok: false, error: "delete_failed" });
      return;
    }

    res.status(200).json({
      ok: true,
      message: "Черновик удалён",
    });
  } catch (err) {
    console.error("[miniapp] delete-draft error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleCreateOrder(req: any, res: any, uid: number, token: string) {
  try {
    const { isClientRegistered } = await import("../src/store/client-store.js");
    const { formatOrderHtml } = await import("../src/bot/format.js");
    const { NOTIFY_ON_STATUS } = await import("../src/config/notifications.js");
    const { ROLE_WHITELIST } = await import("../src/config/role-whitelist.js");

    const body = req.body || {};
    const clientId = body?.clientId ? parseInt(String(body.clientId)) : uid;
    const isProxyOrder = !!body?.clientId;

    // Для прямого создания нужна регистрация
    if (!isProxyOrder) {
      const registered = await isClientRegistered(uid);
      if (!registered) {
        res.status(403).json({ ok: false, error: "not_registered" });
        return;
      }
    }

    const product = typeof body?.product === "string" ? body.product.trim() : "";
    const quantityText = typeof body?.quantity === "string" ? body.quantity.trim() : "";
    const tz = typeof body?.tz === "string" ? body.tz.trim() : "";
    const needsPickup = Boolean(body?.needsPickup);
    const marketplace = body?.marketplace;
    const warehouseId = typeof body?.warehouseId === "string" ? body.warehouseId.trim() : "";
    const desiredDeliveryDate = typeof body?.desiredDeliveryDate === "string" ? body.desiredDeliveryDate.trim() : "";
    const comment = typeof body?.comment === "string" ? body.comment.trim() : "";

    if (!product || !quantityText || !tz) {
      res.status(400).json({ ok: false, error: "missing_fields" });
      return;
    }

    const wh = findWarehouseById(warehouseId);
    if (!wh || wh.marketplace !== marketplace) {
      res.status(400).json({ ok: false, error: "invalid_warehouse" });
      return;
    }

    let pickupPoints: { addressText: string }[] = [];
    if (needsPickup) {
      const addrs = body?.pickupAddresses;
      if (!Array.isArray(addrs)) {
        res.status(400).json({ ok: false, error: "pickup_addresses_required" });
        return;
      }
      pickupPoints = addrs
        .filter((a: unknown): a is string => typeof a === "string" && (a as string).trim().length > 0)
        .map((a: string) => ({ addressText: a.trim() }));
      if (pickupPoints.length === 0) {
        res.status(400).json({ ok: false, error: "pickup_addresses_required" });
        return;
      }
    }

    const order = await orderStore.create({
      clientTelegramId: clientId,
      clientUsername: undefined,
      product,
      quantityText,
      tz,
      needsPickup,
      pickupPoints: needsPickup ? pickupPoints : [],
      delivery: { marketplace, warehouseId },
      desiredDeliveryDate: desiredDeliveryDate || undefined,
      comment: comment || undefined,
    });

    const kb = {
      inline_keyboard: [
        [{ text: "📤 Отправить в работу", callback_data: `o:${order.id}:send` }],
        [{ text: "« Меню", callback_data: "menu:back" }],
      ],
    };

    // Отправляем уведомление клиенту (даже если создание было от менеджера)
    await sendTelegramMessage(
      token,
      clientId,
      `✅ <b>Черновик №${order.id}</b> создан${isProxyOrder ? " менеджером" : ""}.\n\n` +
        formatOrderHtml(order) +
        "\n\nНажмите «Отправить в работу», чтобы статус стал «Принято в работу».",
      kb,
    );

    const audiences = NOTIFY_ON_STATUS.draft;
    if (audiences?.length) {
      const text = `📦 <b>Статус заявки №${order.id}</b>\n` +
        `${ORDER_STATUS_LABEL.draft}\n\n` +
        formatOrderHtml(order);

      const targets = new Set<number>();
      for (const a of audiences) {
        if (a === "client") {
          targets.add(order.clientTelegramId);
          continue;
        }
        for (const id of ROLE_WHITELIST[a]) {
          targets.add(id);
        }
      }
      for (const chatId of targets) {
        try {
          await sendTelegramMessage(token, chatId, text);
          await sleep(40);
        } catch { /* ignore */ }
      }
    }

    res.status(200).json({ ok: true, orderId: order.id });
  } catch (err) {
    console.error("[miniapp] create-order error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleRegister(req: any, res: any, uid: number, token: string) {
  try {
    const {
      saveClientConsent,
      setClientPhone,
      setClientBusinessName,
      isClientRegistered,
      needsPhoneVerification,
      needsBusinessName,
    } = await import("../src/store/client-store.js");

    const body = req.body || {};
    const step = typeof body?.step === "string" ? body.step : "";

    if (step === "consent") {
      const initData = typeof body?.initData === "string" ? body.initData : "";
      const params = new URLSearchParams(initData);
      const userJson = params.get("user");
      let username: string | undefined;
      if (userJson) {
        try {
          const u = JSON.parse(userJson) as { username?: string };
          username = u.username;
        } catch { /* ignore */ }
      }
      await saveClientConsent(uid, username);

      const nextStep = await needsPhoneVerification(uid) ? "phone" : "business_name";
      res.status(200).json({ ok: true, nextStep });
      return;
    }

    if (step === "phone") {
      const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
      if (!phone || phone.length < 6) {
        res.status(400).json({ ok: false, error: "invalid_phone" });
        return;
      }
      await setClientPhone(uid, phone);

      const nextStep = await needsBusinessName(uid) ? "business_name" : "done";
      res.status(200).json({ ok: true, nextStep });
      return;
    }

    if (step === "business_name") {
      const businessName = typeof body?.businessName === "string" ? body.businessName.trim() : "";
      if (businessName.length < 2) {
        res.status(400).json({ ok: false, error: "name_too_short" });
        return;
      }
      if (businessName.length > 200) {
        res.status(400).json({ ok: false, error: "name_too_long" });
        return;
      }
      await setClientBusinessName(uid, businessName);

      const registered = await isClientRegistered(uid);
      res.status(200).json({ ok: true, nextStep: registered ? "done" : "phone" });
      return;
    }

    res.status(400).json({ ok: false, error: "invalid_step" });
  } catch (err) {
    console.error("[miniapp] register error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleSwitchRole(req: any, res: any, uid: number, token: string) {
  try {
    const { canShowSwitchRoleInMiniApp } = await import("../src/lib/miniapp-role.js");
    const { setLastSelectedBotRole } = await import("../src/store/last-bot-role-store.js");
    const { setLockedRole } = await import("../src/store/user-role-store.js");
    const { getRoleEntryPolicy } = await import("../src/lib/access.js");

    const body = req.body || {};
    const selectedRole = typeof body?.selectedRole === "string" ? body.selectedRole : "";

    if (!isBotRole(selectedRole)) {
      res.status(400).json({ ok: false, error: "invalid_role" });
      return;
    }

    const canSwitch = await canShowSwitchRoleInMiniApp(uid);
    if (!canSwitch) {
      res.status(403).json({ ok: false, error: "switch_not_allowed" });
      return;
    }

    if (!canUseRole(uid, selectedRole)) {
      res.status(403).json({ ok: false, error: "role_not_allowed" });
      return;
    }

    const policy = getRoleEntryPolicy(uid);
    if (policy === "lock_first") {
      const locked = await getLockedRole(uid);
      if (locked !== undefined && locked !== selectedRole) {
        res.status(403).json({ ok: false, error: "role_locked", lockedRole: locked });
        return;
      }
      if (locked === undefined) {
        await setLockedRole(uid, selectedRole);
      }
    }

    await setLastSelectedBotRole(uid, selectedRole);

    const ROLE_LABEL: Record<string, string> = {
      client: "Клиент",
      packer: "Работник склада",
      driver: "Водитель",
      manager: "Менеджер",
      supervisor: "Управляющий",
    };

    await sendTelegramMessage(
      token,
      uid,
      `✅ Роль изменена: <b>${ROLE_LABEL[selectedRole]}</b>`,
    );

    res.status(200).json({ ok: true, newRole: selectedRole });
  } catch (err) {
    console.error("[miniapp] switch-role error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

async function handleClientsList(req: any, res: any, uid: number, effectiveRole: string) {
  try {
    // Только менеджер/управляющий могут загружать список клиентов
    if (effectiveRole !== "manager" && effectiveRole !== "supervisor") {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }

    const allOrders = await orderStore.list();
    const { getBusinessNamesForTelegramIds } = await import("../src/store/client-store.js");
    
    // Собираем уникальных клиентов из всех заявок
    const clientIds = new Set<number>();
    const clientsMap = new Map<number, { id: number; username?: string; businessName?: string }>();
    
    for (const order of allOrders) {
      if (!clientsMap.has(order.clientTelegramId)) {
        clientIds.add(order.clientTelegramId);
        clientsMap.set(order.clientTelegramId, {
          id: order.clientTelegramId,
          username: order.clientUsername,
          businessName: undefined, // будет заполнено ниже
        });
      }
    }

    // Загружаем актуальные названия магазинов
    if (clientIds.size > 0) {
      const businessNames = await getBusinessNamesForTelegramIds(Array.from(clientIds));
      for (const [id, client] of clientsMap.entries()) {
        client.businessName = businessNames.get(id) || undefined;
      }
    }

    const clients = Array.from(clientsMap.values()).sort((a, b) => a.id - b.id);

    res.status(200).json({
      ok: true,
      clients,
    });
  } catch (err) {
    console.error("[miniapp] clients-list error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}

function getAvailableActions(role: string, status: string): string[] {
  const actions: string[] = [];

  if (role === "packer") {
    if (status === "accepted") actions.push("start_receiving");
    if (status === "receiving") actions.push("finish_receiving");
    if (status === "receiving_done") actions.push("send_to_sort");
    if (status === "pack_sort") actions.push("ready_for_unload");
  } else if (role === "driver") {
    if (status === "ready_for_unload") actions.push("start_delivery");
    if (status === "in_transit") actions.push("complete_delivery");
  } else if (role === "manager" || role === "supervisor") {
    if (status === "accepted") actions.push("start_receiving");
    if (status === "receiving") actions.push("finish_receiving");
    if (status === "receiving_done") actions.push("send_to_sort");
    if (status === "pack_sort") actions.push("ready_for_unload");
    if (status === "ready_for_unload") actions.push("start_delivery");
    if (status === "in_transit") actions.push("complete_delivery");
    if (status === "draft") actions.push("finalize_order");
  }

  return actions;
}
