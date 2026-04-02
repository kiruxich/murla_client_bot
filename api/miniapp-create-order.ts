import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { orderStore } from "../src/store/order-store.js";
import { findWarehouseById } from "../src/config/warehouses.js";
import { MARKETPLACES, type MarketplaceId } from "../src/config/marketplaces.js";
import { formatOrderHtml } from "../src/bot/format.js";
import { NOTIFY_ON_STATUS } from "../src/config/notifications.js";
import { ROLE_WHITELIST } from "../src/config/role-whitelist.js";
import { ORDER_STATUS_LABEL } from "../src/config/order-statuses.js";
import { getLockedRole } from "../src/store/user-role-store.js";
import { getLastSelectedBotRole } from "../src/store/last-bot-role-store.js";
import { canUseRole } from "../src/lib/access.js";
import { isClientRegistered } from "../src/store/client-store.js";
import type { FulfillmentOrder } from "../src/domain/order.js";

let dbReady = false;

const isMarketplaceId = (v: unknown): v is MarketplaceId =>
  typeof v === "string" && (MARKETPLACES as readonly string[]).includes(v);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function notifyOrderCreated(
  botToken: string,
  order: FulfillmentOrder,
): Promise<void> {
  const audiences = NOTIFY_ON_STATUS.draft;
  if (!audiences?.length) return;

  const text =
    `📦 <b>Статус заявки №${order.id}</b>\n` +
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
      await sendTelegramMessage(botToken, chatId, text);
      await sleep(40);
    } catch { /* ignore */ }
  }
}

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
      console.error("miniapp-create-order initDb", err);
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

  const body = req.body;
  const initData = typeof body?.initData === "string" ? body.initData : "";
  if (!initData) {
    res.status(400).json({ ok: false, error: "initData_required" });
    return;
  }

  const uid = parseUserIdFromWebAppInitData(initData, token);
  if (uid === null) {
    res.status(401).json({ ok: false, error: "invalid_init_data" });
    return;
  }

  let effectiveRole = await getLockedRole(uid);
  if (!effectiveRole) {
    const last = await getLastSelectedBotRole(uid);
    if (last && canUseRole(uid, last)) {
      effectiveRole = last;
    }
  }
  if (!effectiveRole) effectiveRole = "client";

  if (effectiveRole !== "client") {
    res.status(403).json({ ok: false, error: "client_role_required" });
    return;
  }

  const registered = await isClientRegistered(uid);
  if (!registered) {
    res.status(403).json({ ok: false, error: "not_registered" });
    return;
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
  if (!isMarketplaceId(marketplace)) {
    res.status(400).json({ ok: false, error: "invalid_marketplace" });
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

  try {
    const order = await orderStore.create({
      clientTelegramId: uid,
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

    await sendTelegramMessage(
      token,
      uid,
      `✅ <b>Черновик №${order.id}</b> создан из приложения.\n\n` +
        formatOrderHtml(order) +
        "\n\nНажмите «Отправить в работу», чтобы статус стал «Принято в работу».",
      kb,
    );

    await notifyOrderCreated(token, order);

    res.status(200).json({ ok: true, orderId: order.id });
  } catch (err) {
    console.error("miniapp-create-order", err);
    res.status(500).json({ ok: false, error: "internal" });
  }
};
