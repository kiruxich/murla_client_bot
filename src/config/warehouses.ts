import type { MarketplaceId } from "./marketplaces.js";

/**
 * Точки складов/СЦ для кнопок после выбора WB или Ozon.
 * Названия и адреса — ориентировочные, из открытых справочников;
 * замените `label` и `note` на точные подписи в боте сами.
 *
 * `id` — стабильный ключ для callback_data (не меняйте после выхода в прод,
 * или сделайте миграцию заявок).
 */
export type WarehousePoint = {
  id: string;
  marketplace: MarketplaceId;
  /** Подпись на кнопке (отредактируйте) */
  label: string;
  /** Подсказка / ориентир — можно убрать из UI */
  note?: string;
};

/** Wildberries — актуальные склады (синхронизированы с Mini App). */
export const WB_WAREHOUSES: readonly WarehousePoint[] = [
  { id: "wb_koledino", marketplace: "wb", label: "Коледино", note: "Подольск" },
  { id: "wb_elektrostal", marketplace: "wb", label: "Электросталь", note: "Московская обл." },
  { id: "wb_ryazan", marketplace: "wb", label: "Рязань", note: "Рязанская обл." },
  { id: "wb_tula", marketplace: "wb", label: "Тула (Алексин)", note: "Тульская обл." },
  { id: "wb_podolsk_4", marketplace: "wb", label: "Подольск-4", note: "Московская обл." },
  { id: "wb_obukhovo", marketplace: "wb", label: "Обухово", note: "Московская обл." },
  { id: "wb_kotovsk", marketplace: "wb", label: "Котовск", note: "Тамбовская обл." },
  { id: "wb_chehov", marketplace: "wb", label: "Чехов-1", note: "Московская обл." },
  { id: "wb_belaya_dacha", marketplace: "wb", label: "Белая дача", note: "Московская обл." },
];

/** Ozon — актуальные логистические центры (синхронизированы с Mini App). */
export const OZON_WAREHOUSES: readonly WarehousePoint[] = [
  { id: "ozon_grivno", marketplace: "ozon", label: "Гривно", note: "Московская обл." },
  { id: "ozon_domodedovo", marketplace: "ozon", label: "Домодедово", note: "Московская обл." },
  { id: "ozon_noginsk", marketplace: "ozon", label: "Ногинск", note: "Московская обл." },
  { id: "ozon_pushkino", marketplace: "ozon", label: "Пушкино", note: "Московская обл." },
  { id: "ozon_sofino", marketplace: "ozon", label: "Софьино", note: "МО" },
  { id: "ozon_zhukovskiy", marketplace: "ozon", label: "Жуковский", note: "Московская обл." },
  { id: "ozon_pavlovskaya", marketplace: "ozon", label: "Павловская слобода", note: "Московская обл." },
  { id: "ozon_petrovskoe", marketplace: "ozon", label: "Петровское", note: "Московская обл." },
  { id: "ozon_khoruzhino", marketplace: "ozon", label: "Хорухино", note: "Московская обл." },
  { id: "ozon_radumlja", marketplace: "ozon", label: "Радумля", note: "Московская обл." },
];

export const warehousesByMarketplace = (m: MarketplaceId): readonly WarehousePoint[] =>
  m === "wb" ? WB_WAREHOUSES : OZON_WAREHOUSES;

export const findWarehouseById = (id: string): WarehousePoint | undefined => {
  const all = [...WB_WAREHOUSES, ...OZON_WAREHOUSES] as WarehousePoint[];
  return all.find((w) => w.id === id);
};
