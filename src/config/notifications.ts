import type { BotRole } from "../lib/roles.js";
import type { OrderStatusId } from "./order-statuses.js";

/**
 * Кому слать уведомление при переходе в статус (после действия роли).
 * Упаковщик и водитель в общую рассылку НЕ входят — они сами переводят статусы.
 *
 * Водитель — исключение: отдельное правило для статуса `ready_for_unload`
 * (см. `notifyDriverBeforeReadyForUnload`).
 */
export type NotificationAudience = Exclude<BotRole, "packer" | "driver"> | "client";

export const NOTIFY_ON_STATUS: Partial<
  Record<OrderStatusId, readonly NotificationAudience[]>
> = {
  draft: ["client", "manager", "supervisor"],
  accepted: ["client", "manager", "supervisor"],
  receiving: ["client", "manager", "supervisor"],
  receiving_done: ["client", "manager", "supervisor"],
  pack_sort: ["client", "manager", "supervisor"],
  prep_unload: ["client", "manager", "supervisor"],
  ready_for_unload: ["client", "manager", "supervisor"],
  in_transit: ["client", "manager", "supervisor"],
  done: ["client", "manager", "supervisor"],
  cancelled: ["client", "manager", "supervisor"],
};

/**
 * Роли, которым доступны **текстовые отчёты** в Telegram (как менеджеру).
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

/** Роли, которым не шлём «общие» пуши по статусам (они исполнители UI). */
export const NO_BROADCAST_ROLES: readonly BotRole[] = ["packer", "driver"];
