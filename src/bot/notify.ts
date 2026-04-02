import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { NOTIFY_ON_STATUS } from "../config/notifications.js";
import { ROLE_WHITELIST } from "../config/role-whitelist.js";
import { ORDER_STATUS_LABEL } from "../config/order-statuses.js";
import type { OrderStatusId } from "../config/order-statuses.js";
import type { FulfillmentOrder } from "../domain/order.js";
import { formatOrderHtml } from "./format.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Рассылка при смене статуса: клиент, работник склада, менеджер и управляющий — по `NOTIFY_ON_STATUS` и whitelist. Водитель — отдельно. */
export const notifyOnStatusChange = async (
  api: Api,
  order: FulfillmentOrder,
  newStatus: OrderStatusId,
): Promise<void> => {
  const audiences = NOTIFY_ON_STATUS[newStatus];
  if (!audiences?.length) {
    return;
  }

  const text =
    `📦 <b>Статус заявки №${order.id}</b>\n` +
    `${ORDER_STATUS_LABEL[newStatus]}\n\n` +
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
      await api.sendMessage(chatId, text, { parse_mode: "HTML" });
      await sleep(40);
    } catch {
      // игнор: пользователь не писал боту / заблокировал
    }
  }
};

/**
 * Заявка передана водителю со склада (статус уже «Готово к рейсу»).
 * Водитель получает отдельное сообщение с кнопкой открытия карточки.
 */
export const notifyDriversWarehouseHandoff = async (
  api: Api,
  order: FulfillmentOrder,
  driverTelegramIds: readonly number[],
): Promise<void> => {
  if (!driverTelegramIds.length) {
    return;
  }
  const text =
    `🚚 <b>Заявка передана вам</b>\n` +
    `№${order.id} — ${ORDER_STATUS_LABEL.ready_for_unload}\n\n` +
    formatOrderHtml(order);

  const kb = new InlineKeyboard().text("Открыть заявку", `vd:${order.id}`);

  for (const chatId of driverTelegramIds) {
    try {
      await api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: kb,
      });
      await sleep(40);
    } catch {
      // ignore
    }
  }
};
