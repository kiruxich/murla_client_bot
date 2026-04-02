import type { MarketplaceId } from "../config/marketplaces.js";
import type { OrderStatusId } from "../config/order-statuses.js";

/** Адрес(а) забора со своей точки — текст от клиента. */
export type PickupPoint = {
  addressText: string;
};

/** Куда отвезти (маркетплейс + склад назначения). */
export type DeliveryPoint = {
  marketplace: MarketplaceId;
  warehouseId: string;
};

export type FulfillmentOrder = {
  id: string;
  clientTelegramId: number;
  clientUsername?: string;
  /** Кто создал заявку (менеджер/управляющий), если не сам клиент. */
  createdByTelegramId?: number;
  status: OrderStatusId;
  /** Шаг 1 — какой товар */
  product: string;
  /** Шаг 2 — количество с единицами */
  quantityText: string;
  /** Шаг 3 — ТЗ */
  tz: string;
  /** Шаг 4 — нужен ли забор */
  needsPickup: boolean;
  /** Точки забора (если needsPickup) */
  pickupPoints: PickupPoint[];
  /** Шаг 5 — куда отвезти */
  delivery: DeliveryPoint;
  /** Желаемая дата поставки (текст от клиента). */
  desiredDeliveryDate?: string;
  /** Шаг 7 — комментарий */
  comment?: string;
  createdAt: number;
  updatedAt: number;
  driverUnloadPending: boolean;
};
