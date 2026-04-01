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

/** Wildberries — крупные СЦ/склады (подборка; список на селлерских справочниках шире). */
export const WB_WAREHOUSES: readonly WarehousePoint[] = [
  { id: "wb_koledino", marketplace: "wb", label: "Коледино", note: "Подольск, Московская обл." },
  { id: "wb_sofino", marketplace: "wb", label: "Софьино", note: "МО, технопарк Софьино" },
  { id: "wb_elektrostal", marketplace: "wb", label: "Электросталь", note: "Московская обл." },
  { id: "wb_podolsk", marketplace: "wb", label: "Подольск", note: "Московская обл." },
  { id: "wb_kazan", marketplace: "wb", label: "Казань", note: "Респ. Татарстан" },
  { id: "wb_krasnodar", marketplace: "wb", label: "Краснодар", note: "Краснодарский край" },
  { id: "wb_ekb", marketplace: "wb", label: "Екатеринбург", note: "Свердловская обл." },
  { id: "wb_novosibirsk", marketplace: "wb", label: "Новосибирск", note: "Новосибирская обл." },
  { id: "wb_spb_shushary", marketplace: "wb", label: "Шушары", note: "Санкт-Петербург / ЛО" },
  { id: "wb_habarovsk", marketplace: "wb", label: "Хабаровск", note: "Хабаровский край" },
];

/** Ozon — логистические центры (подборка; актуальный список уточняйте в кабинете Ozon). */
export const OZON_WAREHOUSES: readonly WarehousePoint[] = [
  { id: "ozon_sofino", marketplace: "ozon", label: "Софьино", note: "МО, технопарк Софьино" },
  { id: "ozon_habarovsk", marketplace: "ozon", label: "Хабаровск", note: "Хабаровский край" },
  { id: "ozon_kazan", marketplace: "ozon", label: "Казань", note: "Респ. Татарстан" },
  { id: "ozon_krasnodar", marketplace: "ozon", label: "Краснодар", note: "Краснодарский край" },
  { id: "ozon_rostov", marketplace: "ozon", label: "Ростов-на-Дону", note: "Ростовская обл." },
  { id: "ozon_ekb", marketplace: "ozon", label: "Екатеринбург", note: "Свердловская обл." },
  { id: "ozon_novosibirsk", marketplace: "ozon", label: "Новосибирск", note: "Новосибирская обл." },
  { id: "ozon_spb", marketplace: "ozon", label: "Санкт-Петербург", note: "ЛО / СПб" },
  { id: "ozon_tver", marketplace: "ozon", label: "Тверь", note: "Тверская обл." },
  { id: "ozon_domodedovo", marketplace: "ozon", label: "Домодедово", note: "Московская обл." },
];

export const warehousesByMarketplace = (m: MarketplaceId): readonly WarehousePoint[] =>
  m === "wb" ? WB_WAREHOUSES : OZON_WAREHOUSES;

export const findWarehouseById = (id: string): WarehousePoint | undefined => {
  const all = [...WB_WAREHOUSES, ...OZON_WAREHOUSES] as WarehousePoint[];
  return all.find((w) => w.id === id);
};
