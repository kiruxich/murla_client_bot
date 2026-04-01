import type { MarketplaceId } from "../config/marketplaces.js";
import type { BotRole } from "../lib/roles.js";
import type { DeliveryPoint, PickupPoint } from "../domain/order.js";

export type OrderDraftStep =
  | "idle"
  | "product"
  | "quantity"
  | "tz"
  | "pickup_decision"
  | "pick_marketplace"
  | "pick_warehouse"
  | "pick_after_point"
  | "delivery_marketplace"
  | "delivery_warehouse"
  | "comment"
  | "confirm";

export type OrderDraft = {
  step: OrderDraftStep;
  product: string;
  quantityText: string;
  tz: string;
  needsPickup?: boolean;
  pickupPoints: PickupPoint[];
  pickupMarketplace?: MarketplaceId;
  delivery?: DeliveryPoint;
  deliveryMarketplace?: MarketplaceId;
  comment: string;
};

export const emptyOrderDraft = (): OrderDraft => ({
  step: "idle",
  product: "",
  quantityText: "",
  tz: "",
  pickupPoints: [],
  comment: "",
});

export type SessionData = {
  role?: BotRole;
  orderDraft?: OrderDraft;
};
