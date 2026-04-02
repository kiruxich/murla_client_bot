import type { BotRole } from "../lib/roles.js";
import type { DeliveryPoint, PickupPoint } from "../domain/order.js";
import type { MarketplaceId } from "../config/marketplaces.js";

export type OrderDraftStep =
  | "idle"
  | "proxy_client_id"
  | "product"
  | "quantity"
  | "tz"
  | "pickup_decision"
  | "pick_address"
  | "pick_after_point"
  | "delivery_marketplace"
  | "delivery_warehouse"
  | "desired_delivery_date"
  | "comment"
  | "confirm";

export type OrderDraft = {
  step: OrderDraftStep;
  /** Для менеджера/управляющего: telegram id клиента, от имени которого черновик. */
  proxyClientTelegramId?: number;
  product: string;
  quantityText: string;
  tz: string;
  needsPickup?: boolean;
  pickupPoints: PickupPoint[];
  delivery?: DeliveryPoint;
  deliveryMarketplace?: MarketplaceId;
  /** Желаемая дата поставки до сохранения заявки. */
  desiredDeliveryDate: string;
  comment: string;
};

export const emptyOrderDraft = (): OrderDraft => ({
  step: "idle",
  product: "",
  quantityText: "",
  tz: "",
  pickupPoints: [],
  desiredDeliveryDate: "",
  comment: "",
});

/** По какому списку клиент зашёл в заявку — для «К списку». */
export type ClientOrdersListMode = "all" | "drafts" | "active";

/** Активные заявки или архив (выполненные) — для «К списку» у работника склада и водителя. */
export type StaffOrdersListSource = "active" | "archive";

export type SessionData = {
  role?: BotRole;
  orderDraft?: OrderDraft;
  clientOrdersListMode?: ClientOrdersListMode;
  /** Клиент вводит новое название ИП / магазина из меню. */
  editingBusinessName?: boolean;
  packerListSource?: StaffOrdersListSource;
  driverListSource?: StaffOrdersListSource;
  /** Водитель вводит дату рейса для заявки */
  dvcDateOrderId?: string;
};
