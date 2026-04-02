import type { OrderDraft, OrderDraftStep } from "./session-data.js";
import { escapeHtml } from "./format.js";

const LABELS = [
  "Товар",
  "Кол-во",
  "ТЗ",
  "Забор",
  "Куда везти",
  "Дата поставки",
  "Комментарий",
] as const;

/** Линейный индекс шага 1–7; 0 — только выбор клиента (proxy); 8 — подтверждение. */
const stepToLinearIndex = (step: OrderDraftStep): number => {
  switch (step) {
    case "idle":
      return -1;
    case "proxy_client_id":
      return 0;
    case "product":
      return 1;
    case "quantity":
      return 2;
    case "tz":
      return 3;
    case "pickup_decision":
    case "pick_address":
    case "pick_after_point":
      return 4;
    case "delivery_marketplace":
    case "delivery_warehouse":
      return 5;
    case "desired_delivery_date":
      return 6;
    case "comment":
      return 7;
    case "confirm":
      return 8;
    default:
      return -1;
  }
};

export type OrderDraftMinimapOptions = {
  /** Если задан — в миникарте показывается полоса «Клиент». */
  proxyClientTelegramId?: number;
};

/**
 * Компактная «миникарта» маршрута заявки (HTML для Telegram).
 * Дублирует 7 шагов в виде шкалы + списка с отметками ✓ / ▶ / ○.
 */
export const formatOrderDraftMinimapHtml = (
  step: OrderDraftStep,
  options?: OrderDraftMinimapOptions,
): string => {
  const idx = stepToLinearIndex(step);
  if (idx < 0) {
    return "";
  }

  const proxyId = options?.proxyClientTelegramId;
  const showProxyLane =
    step === "proxy_client_id" || (proxyId !== undefined && proxyId > 0);

  const preBody: string[] = [];

  if (showProxyLane) {
    const clientDone = step !== "proxy_client_id";
    const clientMark = clientDone ? "✓" : "▶";
    preBody.push(`${clientMark} Клиент`);
    preBody.push("────────");
  }

  for (let i = 0; i < 7; i++) {
    const n = i + 1;
    let mark: string;
    if (idx === 0) {
      mark = "○";
    } else if (idx >= 8) {
      mark = "✓";
    } else if (n < idx) {
      mark = "✓";
    } else if (n === idx) {
      mark = "▶";
    } else {
      mark = "○";
    }
    preBody.push(`${n} ${mark} ${LABELS[i]}`);
  }

  if (idx >= 8) {
    preBody.push("────────");
    preBody.push("✅ Подтверждение черновика");
  }

  const rail = LABELS.map((_, i) => {
    const n = i + 1;
    if (idx === 0) {
      return "○";
    }
    if (idx >= 8) {
      return "✓";
    }
    if (n < idx) {
      return "✓";
    }
    if (n === idx) {
      return "▶";
    }
    return "○";
  }).join(" ");

  const lines: string[] = [
    "",
    "🗺 <b>Маршрут заявки</b>",
    `<code>${escapeHtml(rail)}</code>`,
    `<i>${escapeHtml("①②③④⑤⑥⑦")}</i>`,
    `<i>${escapeHtml("✓ готово · ▶ сейчас · ○ дальше")}</i>`,
    `<pre>${preBody.map((line) => escapeHtml(line)).join("\n")}</pre>`,
  ];

  return lines.join("\n");
};

/** Добавляет миникарту к телу сообщения, если в сессии есть активный черновик. */
export const appendOrderDraftMinimap = (
  bodyHtml: string,
  draft: OrderDraft | undefined,
): string => {
  if (!draft || draft.step === "idle") {
    return bodyHtml;
  }
  const mini = formatOrderDraftMinimapHtml(draft.step, {
    proxyClientTelegramId: draft.proxyClientTelegramId,
  });
  if (!mini) {
    return bodyHtml;
  }
  return `${bodyHtml}${mini}`;
};
