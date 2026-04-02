import { MARKETPLACE_LABEL, type MarketplaceId } from "../config/marketplaces.js";
import { findWarehouseById } from "../config/warehouses.js";
import type { PickupPoint } from "../domain/order.js";

/**
 * Разбор pickup_points_json: новый формат { addressText }; старый { marketplace, warehouseId }.
 */
export const parsePickupPointsFromJson = (raw: string): PickupPoint[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizePickupPoint);
  } catch {
    return [];
  }
};

const normalizePickupPoint = (x: unknown): PickupPoint => {
  if (
    typeof x === "object" &&
    x !== null &&
    "addressText" in x &&
    typeof (x as { addressText: unknown }).addressText === "string"
  ) {
    return { addressText: (x as { addressText: string }).addressText.trim() || "—" };
  }
  if (
    typeof x === "object" &&
    x !== null &&
    "marketplace" in x &&
    "warehouseId" in x
  ) {
    const m = String((x as { marketplace: string }).marketplace) as MarketplaceId;
    const wid = String((x as { warehouseId: string }).warehouseId);
    const wh = findWarehouseById(wid);
    const label = MARKETPLACE_LABEL[m] ?? m;
    const line = wh ? `${label} — ${wh.label}` : `${label} — ${wid}`;
    return { addressText: `(${line})` };
  }
  return { addressText: String(x) };
};
