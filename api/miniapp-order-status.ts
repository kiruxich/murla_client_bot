import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { orderStore } from "../src/store/order-store.js";
import { getLockedRole } from "../src/store/user-role-store.js";
import { getLastSelectedBotRole } from "../src/store/last-bot-role-store.js";
import { canUseRole } from "../src/lib/access.js";
import { ORDER_STATUS_LABEL } from "../src/config/order-statuses.js";

let dbReady = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
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
      console.error("miniapp-order-status initDb", err);
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
  const action = typeof body?.action === "string" ? body.action : "";

  if (!initData || !orderId || !action) {
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

    // Проверяем права доступа
    if (effectiveRole === "client") {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }

    // Определяем новый статус в зависимости от action
    let newStatus: string | null = null;

    if (effectiveRole === "packer") {
      if (action === "start_receiving" && order.status === "accepted") newStatus = "receiving";
      if (action === "finish_receiving" && order.status === "receiving") newStatus = "receiving_done";
      if (action === "send_to_sort" && order.status === "receiving_done") newStatus = "pack_sort";
    } else if (effectiveRole === "driver") {
      if (action === "start_delivery" && order.status === "ready_for_unload") newStatus = "in_transit";
      if (action === "complete_delivery" && order.status === "in_transit") newStatus = "delivered";
    } else if (effectiveRole === "manager" || effectiveRole === "supervisor") {
      // Менеджеры могут выполнять разные действия
      if (action === "start_receiving") newStatus = "receiving";
      if (action === "finish_receiving") newStatus = "receiving_done";
      if (action === "send_to_sort") newStatus = "pack_sort";
      if (action === "start_delivery") newStatus = "in_transit";
      if (action === "complete_delivery") newStatus = "delivered";
    }

    if (!newStatus) {
      res.status(400).json({ ok: false, error: "invalid_action" });
      return;
    }

    // Обновляем статус
    const updated = await orderStore.update(orderId, {
      status: newStatus as any,
    });

    if (!updated) {
      res.status(500).json({ ok: false, error: "update_failed" });
      return;
    }

    // Отправляем уведомление в Telegram (упрощенно)
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
    console.error("miniapp-order-status error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
};
