/**
 * Маркетплейсы для выбора точки забора (кнопки «WB» / «Ozon»).
 */
export const MARKETPLACES = ["wb", "ozon"] as const;
export type MarketplaceId = (typeof MARKETPLACES)[number];

export const MARKETPLACE_LABEL: Record<MarketplaceId, string> = {
  wb: "Wildberries",
  ozon: "Ozon",
};
