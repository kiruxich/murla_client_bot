import { MARKETPLACE_LABEL } from "../config/marketplaces.js";
import { ORDER_STATUS_LABEL } from "../config/order-statuses.js";
import { findWarehouseById } from "../config/warehouses.js";
import type { FulfillmentOrder, PickupPoint } from "../domain/order.js";
import type { OrderDraft } from "./session-data.js";

export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const formatPointLine = (p: PickupPoint): string => `• ${escapeHtml(p.addressText)}`;

export const formatOrderHtml = (o: FulfillmentOrder): string => {
  const lines: string[] = [
    `<b>Заявка №${escapeHtml(o.id)}</b>`,
    `<b>Статус:</b> ${escapeHtml(ORDER_STATUS_LABEL[o.status])}`,
  ];
  if (o.createdByTelegramId !== undefined) {
    lines.push(
      "",
      `<b>Оформлено сотрудником</b> (Telegram id ${escapeHtml(String(o.createdByTelegramId))})`,
    );
  }
  lines.push(
    "",
    `<b>1. Товар:</b>\n${escapeHtml(o.product)}`,
    `<b>2. Количество:</b> ${escapeHtml(o.quantityText)}`,
    `<b>3. ТЗ:</b>\n${escapeHtml(o.tz)}`,
    "",
    `<b>4. Забор товара:</b> ${o.needsPickup ? "да" : "нет"}`,
  );
  if (o.needsPickup && o.pickupPoints.length) {
    lines.push("<b>Точки забора:</b>");
    for (const p of o.pickupPoints) {
      lines.push(formatPointLine(p));
    }
  }
  lines.push("");
  const dwh = findWarehouseById(o.delivery.warehouseId);
  const dm = MARKETPLACE_LABEL[o.delivery.marketplace];
  lines.push(
    `<b>5. Куда отвезти:</b> ${escapeHtml(dwh ? `${dm} — ${dwh.label}` : `${dm} — ${o.delivery.warehouseId}`)}`,
  );
  if (o.desiredDeliveryDate?.trim()) {
    lines.push("", `<b>6. Желаемая дата поставки:</b> ${escapeHtml(o.desiredDeliveryDate.trim())}`);
  } else {
    lines.push("", "<b>6. Желаемая дата поставки:</b> —");
  }
  if (o.comment) {
    lines.push("", `<b>7. Комментарий:</b>\n${escapeHtml(o.comment)}`);
  } else {
    lines.push("", "<b>7. Комментарий:</b> —");
  }
  return lines.join("\n");
};

/** Итог по черновику до создания заявки (шаги 1–6). */
export const formatDraftSummaryHtml = (d: OrderDraft): string => {
  const proxyBlock =
    d.proxyClientTelegramId !== undefined
      ? `<b>Клиент:</b> Telegram id ${escapeHtml(String(d.proxyClientTelegramId))}\n\n`
      : "";
  const pickupBlock =
    d.needsPickup === true
      ? d.pickupPoints.length
        ? `<b>Точки забора:</b>\n${d.pickupPoints.map((p) => formatPointLine(p)).join("\n")}`
        : "<b>Точки забора:</b> —"
      : "";
  let deliveryLine = "—";
  if (d.delivery) {
    const wh = findWarehouseById(d.delivery.warehouseId);
    const m = MARKETPLACE_LABEL[d.delivery.marketplace];
    deliveryLine = wh ? `${escapeHtml(m)} — ${escapeHtml(wh.label)}` : `${escapeHtml(m)} — ${escapeHtml(d.delivery.warehouseId)}`;
  }
  const dateBlock =
    d.desiredDeliveryDate.trim() !== "" ? escapeHtml(d.desiredDeliveryDate.trim()) : "—";
  const commentBlock =
    d.comment.trim() !== "" ? escapeHtml(d.comment) : "—";
  return (
    proxyBlock +
    `<b>Итог заявки</b>\n\n` +
    `<b>1. Товар:</b>\n${escapeHtml(d.product)}\n\n` +
    `<b>2. Количество:</b> ${escapeHtml(d.quantityText)}\n\n` +
    `<b>3. ТЗ:</b>\n${escapeHtml(d.tz)}\n\n` +
    `<b>4. Забор:</b> ${d.needsPickup === true ? "да" : d.needsPickup === false ? "нет" : "—"}\n` +
    `${pickupBlock}\n\n` +
    `<b>5. Куда отвезти:</b> ${deliveryLine}\n\n` +
    `<b>6. Желаемая дата поставки:</b> ${dateBlock}\n\n` +
    `<b>7. Комментарий:</b>\n${commentBlock}`
  );
};
