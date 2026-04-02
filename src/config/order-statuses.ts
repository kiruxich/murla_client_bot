/**
 * Операционные статусы заявки (редактируйте под процесс Мурлы).
 * Порядок в массиве может задавать «линейку» для отображения.
 */
export const ORDER_STATUS_IDS = [
  "draft",
  "accepted",
  "receiving",
  "receiving_done",
  "pack_sort",
  "prep_unload",
  "ready_for_unload",
  "in_transit",
  "done",
  "cancelled",
] as const;

export type OrderStatusId = (typeof ORDER_STATUS_IDS)[number];

/** Человекочитаемые подписи — поменяйте на свои формулировки. */
export const ORDER_STATUS_LABEL: Record<OrderStatusId, string> = {
  draft: "Черновик / заявка",
  accepted: "Принято в работу",
  receiving: "Принято на складе Мурла",
  receiving_done: "Товар в работе",
  pack_sort: "Товар готов к отгрузке",
  /** Старые заявки до смены сценария; новые заявки сюда не попадают. */
  prep_unload: "Подготовка к выгрузке (устар.)",
  ready_for_unload: "Готово к рейсу",
  in_transit: "В пути",
  done: "Завершено",
  cancelled: "Отменено",
};
