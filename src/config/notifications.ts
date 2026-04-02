import type { BotRole } from "../lib/roles.js";
import type { OrderStatusId } from "./order-statuses.js";

/**
 * Кому слать уведомление при переходе в статус (после действия роли).
 * Работник склада, менеджер и управляющий получают пуши по событиям из таблицы (whitelist в `role-whitelist.ts`).
 * Исключение: `ready_for_unload` — см. ниже. Водитель в матрицу не входит.
 *
 * `manager` и `supervisor` везде парой: в боте одинаковые права (см. `isManagerLikeRole` в `lib/roles.ts`).
 *
 * Статус `ready_for_unload` в эту матрицу не входит: общая рассылка не шлётся (клиент не должен
 * видеть «Готово к рейсу» при передаче водителю). Уведомление получают только водители —
 * см. `notifyDriversWarehouseHandoff` в `notify.ts`.
 */
export type NotificationAudience = Exclude<BotRole, "driver">;

/** Подписчики «операционных» алертов: клиент + все три роли, кроме водителя. */
const OPS_ALERT: readonly NotificationAudience[] = [
  "client",
  "manager",
  "supervisor",
  "packer",
];

export const NOTIFY_ON_STATUS: Partial<
  Record<OrderStatusId, readonly NotificationAudience[]>
> = {
  /** Клиент уже видит итог в `draft:create` (editMessageText) — не дублировать ему второй пуш. */
  draft: ["manager", "supervisor", "packer"],
  accepted: [...OPS_ALERT],
  receiving: [...OPS_ALERT],
  receiving_done: [...OPS_ALERT],
  pack_sort: [...OPS_ALERT],
  prep_unload: [...OPS_ALERT],
  in_transit: [...OPS_ALERT],
  done: [...OPS_ALERT],
  cancelled: [...OPS_ALERT],
};

/**
 * Роли, которым доступны **текстовые отчёты** в Telegram (менеджер и управляющий — одно и то же).
 * В хендлере отчётов: рассылать по id из whitelist для этих ролей.
 */
export const REPORT_RECIPIENT_ROLES = ["manager", "supervisor"] as const;
export type ReportRecipientRole = (typeof REPORT_RECIPIENT_ROLES)[number];

/**
 * Для водителя: уведомление только про «готово к выгрузке»,
 * и логично отправить **до** фиксации статуса (подтверждение выезда).
 * Реализуйте в хендлере: сначала `sendDriverReadyPrompt`, после ОК — статус.
 */
export const DRIVER_NOTIFY_STATUS: OrderStatusId = "ready_for_unload";

/** Роли, которым не шлём «общие» пуши по статусам (только водитель — отдельный канал). */
export const NO_BROADCAST_ROLES: readonly BotRole[] = ["driver"];
