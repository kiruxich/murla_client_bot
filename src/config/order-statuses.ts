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
  receiving: "Приёмка на складе",
  receiving_done: "Приёмка завершена",
  pack_sort: "Упаковка и сортировка",
  prep_unload: "Подготовка к выгрузке",
  ready_for_unload: "Готово к выгрузке",
  in_transit: "В пути",
  done: "Завершено",
  cancelled: "Отменено",
};
