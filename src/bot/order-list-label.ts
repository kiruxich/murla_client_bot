/** Лимит подписи inline-кнопки в Telegram. */
export const TG_INLINE_BUTTON_MAX = 64;

export const truncateInlineButton = (s: string): string =>
  s.length <= TG_INLINE_BUTTON_MAX ? s : `${s.slice(0, TG_INLINE_BUTTON_MAX - 1)}…`;

/**
 * Список заявок: «Название ИП/магазина - №N — статус»,
 * N — порядковый номер в текущем списке (1, 2, 3…).
 */
export const orderListButtonLabel = (
  businessName: string,
  listIndexZeroBased: number,
  statusPart: string,
): string => {
  const raw = `${businessName} - №${listIndexZeroBased + 1} — ${statusPart}`;
  return truncateInlineButton(raw);
};
