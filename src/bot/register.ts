import {
  Bot,
  InlineKeyboard,
  MemorySessionStorage,
  session,
  type Context,
  type SessionFlavor,
} from "grammy";
import {
  MARKETPLACE_LABEL,
  MARKETPLACES,
  type MarketplaceId,
} from "../config/marketplaces.js";
import { ORDER_STATUS_LABEL } from "../config/order-statuses.js";
import type { OrderStatusId } from "../config/order-statuses.js";
import { ROLE_WHITELIST } from "../config/role-whitelist.js";
import { warehousesByMarketplace } from "../config/warehouses.js";
import { findWarehouseById } from "../config/warehouses.js";
import type { BotRole } from "../lib/roles.js";
import { BOT_ROLES } from "../lib/roles.js";
import { canUseRole, getRoleEntryPolicy } from "../lib/access.js";
import { getLockedRole, setLockedRole } from "../store/user-role-store.js";
import { orderStore } from "../store/order-store.js";
import { emptyOrderDraft, type SessionData } from "./session-data.js";
import { formatDraftSummaryHtml, formatOrderHtml } from "./format.js";
import { notifyDriverUnloadRequest, notifyOnStatusChange } from "./notify.js";

export type MyContext = Context & SessionFlavor<SessionData>;

const roleLabel: Record<BotRole, string> = {
  client: "Клиент",
  packer: "Упаковщик",
  driver: "Водитель",
  manager: "Менеджер",
  supervisor: "Управляющий",
};

const packerNextStatus: Partial<Record<OrderStatusId, OrderStatusId>> = {
  accepted: "receiving",
  receiving: "receiving_done",
  receiving_done: "pack_sort",
  pack_sort: "prep_unload",
};

const mainMenuKeyboard = (role: BotRole): InlineKeyboard => {
  const kb = new InlineKeyboard();
  if (role === "client") {
    kb.text("➕ Новая заявка", "menu:new_order").row();
    kb.text("📋 Мои заявки", "menu:my_orders");
    return kb;
  }
  if (role === "packer") {
    kb.text("📦 Заявки в работе", "menu:packer_orders");
    return kb;
  }
  if (role === "driver") {
    kb.text("🚚 Задачи водителя", "menu:driver_orders");
    return kb;
  }
  if (role === "manager" || role === "supervisor") {
    kb.text("📑 Все заявки", "menu:all_orders").row();
    kb.text("📊 Отчёт", "menu:report");
    return kb;
  }
  return kb;
};

const roleSelectKeyboard = (userId: number): InlineKeyboard => {
  const kb = new InlineKeyboard();
  for (const r of BOT_ROLES) {
    if (!canUseRole(userId, r)) {
      continue;
    }
    kb.text(roleLabel[r], `role:${r}`).row();
  }
  return kb;
};

const sendMainMenu = async (ctx: MyContext, role: BotRole): Promise<void> => {
  const text = `Роль: <b>${roleLabel[role]}</b>\n\nВыберите действие:`;
  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(role),
    });
  } else {
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(role),
    });
  }
};

export const registerHandlers = (bot: Bot<MyContext>): void => {
  bot.use(
    session({
      initial: (): SessionData => ({}),
      storage: new MemorySessionStorage<SessionData>(),
    }),
  );

  bot.command("start", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) {
      return;
    }
    ctx.session.orderDraft = undefined;
    const policy = getRoleEntryPolicy(uid);

    if (policy === "full_bypass") {
      ctx.session.role = undefined;
      await ctx.reply(
        "👋 <b>Мурла — бот заявок</b>\n\n<i>Режим WHITELIST_BYPASS: любая роль.</i>\n\nВыберите роль:",
        { parse_mode: "HTML", reply_markup: roleSelectKeyboard(uid) },
      );
      return;
    }

    if (policy === "always_switch") {
      ctx.session.role = undefined;
      await ctx.reply(
        "👋 <b>Мурла — бот заявок</b>\n\nВыберите роль (при каждом /start можно сменить):",
        { parse_mode: "HTML", reply_markup: roleSelectKeyboard(uid) },
      );
      return;
    }

    if (policy === "lock_first") {
      const locked = await getLockedRole(uid);
      if (locked) {
        ctx.session.role = locked;
        await ctx.reply(
          `👋 <b>Мурла — бот заявок</b>\n\nРоль закреплена: <b>${roleLabel[locked]}</b>.`,
          { parse_mode: "HTML", reply_markup: mainMenuKeyboard(locked) },
        );
        return;
      }
      ctx.session.role = undefined;
      await ctx.reply(
        "👋 <b>Мурла — бот заявок</b>\n\nПервый вход — выберите роль (потом смена только у администратора БД):",
        { parse_mode: "HTML", reply_markup: roleSelectKeyboard(uid) },
      );
      return;
    }

    ctx.session.role = "client";
    await ctx.reply(
      "👋 <b>Мурла — бот заявок</b>\n\nВы вошли как <b>клиент</b>.",
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard("client") },
    );
  });

  bot.command("cancel", async (ctx) => {
    ctx.session.orderDraft = undefined;
    await ctx.reply("Черновик заявки сброшен. /start — меню.");
  });

  bot.callbackQuery(/^role:(.+)$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) {
      return;
    }
    const role = ctx.match[1] as BotRole;
    if (!(BOT_ROLES as readonly string[]).includes(role)) {
      await ctx.answerCallbackQuery({ text: "Неизвестная роль" });
      return;
    }
    const policy = getRoleEntryPolicy(uid);
    if (policy === "lock_first") {
      const locked = await getLockedRole(uid);
      if (locked !== undefined && locked !== role) {
        await ctx.answerCallbackQuery({ text: "Роль уже закреплена. /start — меню." });
        return;
      }
    }
    if (!canUseRole(uid, role)) {
      await ctx.answerCallbackQuery({ text: "Нет доступа к этой роли" });
      return;
    }
    if (policy === "lock_first" && (await getLockedRole(uid)) === undefined) {
      await setLockedRole(uid, role);
    }
    ctx.session.role = role;
    await ctx.answerCallbackQuery();
    await sendMainMenu(ctx, role);
  });

  bot.callbackQuery("menu:back", async (ctx) => {
    const role = ctx.session.role;
    if (!role) {
      await ctx.answerCallbackQuery({ text: "Сначала выберите роль через /start" });
      return;
    }
    ctx.session.orderDraft = undefined;
    await ctx.answerCallbackQuery();
    await sendMainMenu(ctx, role);
  });

  /** ——— Клиент: новая заявка (6 шагов) ——— */
  bot.callbackQuery("menu:new_order", async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    ctx.session.orderDraft = emptyOrderDraft();
    ctx.session.orderDraft.step = "product";
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      "📝 <b>Шаг 1/6</b>\nКакой у вас товар?\n\nНапишите одним сообщением.",
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery("pickup:y", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || d.step !== "pickup_decision") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.needsPickup = true;
    d.pickupPoints = [];
    d.step = "pick_marketplace";
    d.pickupMarketplace = undefined;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const m of MARKETPLACES) {
      kb.text(MARKETPLACE_LABEL[m], `pm:${m}`).row();
    }
    kb.text("« Отмена", "menu:back");
    await ctx.editMessageText(
      "📍 <b>Шаг 4/6 — забор товара</b>\nВыберите маркетплейс для <b>точки забора</b>:",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("pickup:n", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || d.step !== "pickup_decision") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.needsPickup = false;
    d.pickupPoints = [];
    d.step = "delivery_marketplace";
    d.deliveryMarketplace = undefined;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const m of MARKETPLACES) {
      kb.text(MARKETPLACE_LABEL[m], `dm:${m}`).row();
    }
    kb.text("« Отмена", "menu:back");
    await ctx.editMessageText(
      "🚚 <b>Шаг 5/6</b>\nВыберите маркетплейс, <b>куда нужно отвезти</b> товар:",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery(/^pm:(wb|ozon)$/, async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || d.step !== "pick_marketplace") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    const mp = ctx.match[1] as MarketplaceId;
    d.pickupMarketplace = mp;
    d.step = "pick_warehouse";
    await ctx.answerCallbackQuery();
    const list = warehousesByMarketplace(mp);
    const kb = new InlineKeyboard();
    for (const w of list) {
      kb.text(w.label, `pw:${w.id}`).row();
    }
    kb.text("« Назад", "draft:pm_back").row();
    kb.text("« Отмена", "menu:back");
    await ctx.editMessageText(
      `📍 <b>Склад забора ${MARKETPLACE_LABEL[mp]}</b>\nВыберите точку:`,
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("draft:pm_back", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d) {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.step = "pick_marketplace";
    d.pickupMarketplace = undefined;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const m of MARKETPLACES) {
      kb.text(MARKETPLACE_LABEL[m], `pm:${m}`).row();
    }
    kb.text("« Отмена", "menu:back");
    await ctx.editMessageText(
      "📍 Выберите маркетплейс для точки забора:",
      { reply_markup: kb },
    );
  });

  bot.callbackQuery(/^pw:(.+)$/, async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || d.step !== "pick_warehouse" || !d.pickupMarketplace) {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    const wid = ctx.match[1];
    if (!findWarehouseById(wid)) {
      await ctx.answerCallbackQuery({ text: "Неизвестный склад" });
      return;
    }
    d.pickupPoints.push({ marketplace: d.pickupMarketplace, warehouseId: wid });
    d.step = "pick_after_point";
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text("➕ Ещё точка забора", "pmore:y")
      .row()
      .text("➡️ Дальше (куда везти)", "pmore:n")
      .row()
      .text("« Отмена", "menu:back");
    await ctx.editMessageText(
      `✅ Точка добавлена.\n\nДобавить ещё одну точку забора или перейти к выбору <b>места доставки</b>?`,
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("pmore:y", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || d.step !== "pick_after_point") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.step = "pick_marketplace";
    d.pickupMarketplace = undefined;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const m of MARKETPLACES) {
      kb.text(MARKETPLACE_LABEL[m], `pm:${m}`).row();
    }
    kb.text("« Отмена", "menu:back");
    await ctx.editMessageText("Выберите маркетплейс для следующей точки забора:", {
      reply_markup: kb,
    });
  });

  bot.callbackQuery("pmore:n", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || d.step !== "pick_after_point") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    if (d.needsPickup && d.pickupPoints.length === 0) {
      await ctx.answerCallbackQuery({ text: "Нужна хотя бы одна точка" });
      return;
    }
    d.step = "delivery_marketplace";
    d.deliveryMarketplace = undefined;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const m of MARKETPLACES) {
      kb.text(MARKETPLACE_LABEL[m], `dm:${m}`).row();
    }
    kb.text("« Отмена", "menu:back");
    await ctx.editMessageText(
      "🚚 <b>Шаг 5/6</b>\nВыберите маркетплейс, <b>куда отвезти</b> товар:",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery(/^dm:(wb|ozon)$/, async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || d.step !== "delivery_marketplace") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    const mp = ctx.match[1] as MarketplaceId;
    d.deliveryMarketplace = mp;
    d.step = "delivery_warehouse";
    await ctx.answerCallbackQuery();
    const list = warehousesByMarketplace(mp);
    const kb = new InlineKeyboard();
    for (const w of list) {
      kb.text(w.label, `dw:${w.id}`).row();
    }
    kb.text("« Назад", "draft:dm_back").row();
    kb.text("« Отмена", "menu:back");
    await ctx.editMessageText(
      `📍 <b>Куда везти — ${MARKETPLACE_LABEL[mp]}</b>\nВыберите склад назначения:`,
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("draft:dm_back", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d) {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.step = "delivery_marketplace";
    d.deliveryMarketplace = undefined;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const m of MARKETPLACES) {
      kb.text(MARKETPLACE_LABEL[m], `dm:${m}`).row();
    }
    kb.text("« Отмена", "menu:back");
    await ctx.editMessageText("🚚 Выберите маркетплейс для доставки:", {
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^dw:(.+)$/, async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || d.step !== "delivery_warehouse" || !d.deliveryMarketplace) {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    const wid = ctx.match[1];
    if (!findWarehouseById(wid)) {
      await ctx.answerCallbackQuery({ text: "Неизвестный склад" });
      return;
    }
    d.delivery = { marketplace: d.deliveryMarketplace, warehouseId: wid };
    d.step = "comment";
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text("Пропустить комментарий", "skip:comment")
      .row()
      .text("« Отмена", "menu:back");
    await ctx.editMessageText(
      "💬 <b>Шаг 6/6</b>\nКомментарий (при необходимости).\n\nИли нажмите «Пропустить».",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("skip:comment", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || d.step !== "comment") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.comment = "";
    d.step = "confirm";
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text("✅ Создать черновик", "draft:create")
      .row()
      .text("« Отмена", "menu:back");
    await ctx.editMessageText(
      `${formatDraftSummaryHtml(d)}\n\nПодтвердите создание черновика заявки.`,
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("draft:create", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined || ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      return;
    }
    const d = ctx.session.orderDraft;
    if (!d || !d.delivery) {
      await ctx.answerCallbackQuery({ text: "Не заполнены обязательные поля" });
      return;
    }
    if (d.needsPickup && d.pickupPoints.length === 0) {
      await ctx.answerCallbackQuery({ text: "Укажите точки забора" });
      return;
    }
    const order = await orderStore.create({
      clientTelegramId: uid,
      clientUsername: ctx.from.username,
      product: d.product.trim(),
      quantityText: d.quantityText.trim(),
      tz: d.tz.trim(),
      needsPickup: d.needsPickup ?? false,
      pickupPoints: d.needsPickup ? [...d.pickupPoints] : [],
      delivery: d.delivery,
      comment: d.comment.trim() || undefined,
    });
    ctx.session.orderDraft = undefined;
    await ctx.answerCallbackQuery();
    await notifyOnStatusChange(ctx.api, order, "draft");
    const kb = new InlineKeyboard().text("📤 Отправить в работу", `o:${order.id}:send`);
    await ctx.editMessageText(
      `✅ <b>Черновик №${order.id}</b> создан.\n\n` +
        formatOrderHtml(order) +
        "\n\nНажмите «Отправить в работу», чтобы статус стал «Принято в работу».",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery(/^o:(\d+):send$/, async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const id = ctx.match[1];
    const o = await orderStore.get(id);
    if (!o || o.clientTelegramId !== ctx.from?.id) {
      await ctx.answerCallbackQuery({ text: "Заявка не найдена" });
      return;
    }
    if (o.status !== "draft") {
      await ctx.answerCallbackQuery({ text: "Уже отправлено" });
      return;
    }
    const next = await orderStore.setStatus(id, "accepted");
    if (!next) {
      return;
    }
    await ctx.answerCallbackQuery();
    await notifyOnStatusChange(ctx.api, next, "accepted");
    await ctx.editMessageText(
      `✅ Заявка №${id} принята в работу.\n\n` + formatOrderHtml(next),
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery("menu:my_orders", async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const uid = ctx.from?.id;
    if (uid === undefined) {
      return;
    }
    await ctx.answerCallbackQuery();
    const list = await orderStore.listByClient(uid);
    if (!list.length) {
      await ctx.editMessageText("Заявок пока нет.", {
        reply_markup: new InlineKeyboard().text("« Меню", "menu:back"),
      });
      return;
    }
    const kb = new InlineKeyboard();
    for (const o of list.slice(0, 20)) {
      kb.text(`№${o.id} — ${ORDER_STATUS_LABEL[o.status]}`, `v:${o.id}`).row();
    }
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("Ваши заявки:", { reply_markup: kb });
  });

  /** ——— Упаковщик ——— */
  bot.callbackQuery("menu:packer_orders", async (ctx) => {
    if (ctx.session.role !== "packer") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    await ctx.answerCallbackQuery();
    const active = (await orderStore.list()).filter(
      (o) =>
        o.status !== "done" &&
        o.status !== "cancelled" &&
        o.status !== "draft" &&
        o.status !== "in_transit" &&
        o.status !== "ready_for_unload",
    );
    if (!active.length) {
      await ctx.editMessageText("Нет заявок для обработки.", {
        reply_markup: new InlineKeyboard().text("« Меню", "menu:back"),
      });
      return;
    }
    const kb = new InlineKeyboard();
    for (const o of active.slice(0, 20)) {
      kb.text(`№${o.id} — ${ORDER_STATUS_LABEL[o.status]}`, `v:${o.id}`).row();
    }
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("Заявки на складе:", { reply_markup: kb });
  });

  /** ——— Менеджер / управляющий ——— */
  bot.callbackQuery("menu:all_orders", async (ctx) => {
    if (ctx.session.role !== "manager" && ctx.session.role !== "supervisor") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    await ctx.answerCallbackQuery();
    const list = await orderStore.list();
    if (!list.length) {
      await ctx.editMessageText("Заявок нет.", {
        reply_markup: new InlineKeyboard().text("« Меню", "menu:back"),
      });
      return;
    }
    const kb = new InlineKeyboard();
    for (const o of list.slice(0, 20)) {
      kb.text(`№${o.id} — ${ORDER_STATUS_LABEL[o.status]}`, `v:${o.id}`).row();
    }
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("Все заявки:", { reply_markup: kb });
  });

  bot.callbackQuery("menu:report", async (ctx) => {
    if (ctx.session.role !== "manager" && ctx.session.role !== "supervisor") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    await ctx.answerCallbackQuery();
    const list = await orderStore.list();
    const byStatus = new Map<string, number>();
    for (const s of list) {
      byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
    }
    const lines = ["📊 <b>Отчёт (мок)</b>\n", `Всего заявок: ${list.length}`];
    for (const [st, n] of byStatus) {
      lines.push(`${ORDER_STATUS_LABEL[st as OrderStatusId]}: ${n}`);
    }
    lines.push("", "<i>Позже — выгрузка в Google Таблицы.</i>");
    await ctx.editMessageText(lines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("« Меню", "menu:back"),
    });
  });

  /** ——— Водитель ——— */
  bot.callbackQuery("menu:driver_orders", async (ctx) => {
    if (ctx.session.role !== "driver") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    await ctx.answerCallbackQuery();
    const list = (await orderStore.list()).filter(
      (o) =>
        o.driverUnloadPending ||
        o.status === "ready_for_unload" ||
        o.status === "in_transit",
    );
    if (!list.length) {
      await ctx.editMessageText("Нет активных задач.", {
        reply_markup: new InlineKeyboard().text("« Меню", "menu:back"),
      });
      return;
    }
    const kb = new InlineKeyboard();
    for (const o of list.slice(0, 20)) {
      const tag = o.driverUnloadPending ? "⏳ подтвердить" : ORDER_STATUS_LABEL[o.status];
      kb.text(`№${o.id} — ${tag}`, `vd:${o.id}`).row();
    }
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("Задачи водителя:", { reply_markup: kb });
  });

  bot.callbackQuery(/^vd:(\d+)$/, async (ctx) => {
    if (ctx.session.role !== "driver") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const id = ctx.match[1];
    const o = await orderStore.get(id);
    if (!o) {
      await ctx.answerCallbackQuery({ text: "Не найдено" });
      return;
    }
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    if (o.driverUnloadPending) {
      kb.text("✅ Подтвердить готовность к выгрузке", `o:${id}:dvc`).row();
    }
    if (o.status === "ready_for_unload") {
      kb.text("🚛 В пути", `o:${id}:dvt`).row();
    }
    if (o.status === "in_transit") {
      kb.text("✔️ Завершено", `o:${id}:dvf`).row();
    }
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText(
      `<b>Водитель — заявка №${id}</b>\n\n` + formatOrderHtml(o),
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  /** Упаковщик / водитель: действия по заявке */
  bot.callbackQuery(/^o:(\d+):(pkr|drv|dvc|dvt|dvf)$/, async (ctx) => {
    const id = ctx.match[1];
    const act = ctx.match[2];
    const o = await orderStore.get(id);
    if (!o) {
      await ctx.answerCallbackQuery({ text: "Не найдено" });
      return;
    }

    if (act === "pkr") {
      if (ctx.session.role !== "packer") {
        await ctx.answerCallbackQuery({ text: "Только упаковщик" });
        return;
      }
      if (o.status === "prep_unload" && o.driverUnloadPending) {
        await ctx.answerCallbackQuery({ text: "Ждём подтверждения водителя" });
        return;
      }
      if (o.status === "prep_unload") {
        await orderStore.setDriverUnloadPending(id, true);
        const updated = await orderStore.get(id);
        if (updated) {
          await notifyDriverUnloadRequest(ctx.api, updated, ROLE_WHITELIST.driver);
        }
        await ctx.answerCallbackQuery({ text: "Водитель уведомлён" });
        const after = await orderStore.get(id);
        await ctx.editMessageText(
          `Запрос водителю отправлен по заявке №${id}.\n\n` + formatOrderHtml(after!),
          { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("« Меню", "menu:back") },
        );
        return;
      }
      const nextSt = packerNextStatus[o.status];
      if (!nextSt) {
        await ctx.answerCallbackQuery({ text: "Нельзя перевести дальше" });
        return;
      }
      const updated = await orderStore.setStatus(id, nextSt);
      if (updated) {
        await notifyOnStatusChange(ctx.api, updated, nextSt);
      }
      await ctx.answerCallbackQuery({ text: "Готово" });
      const afterStatus = await orderStore.get(id);
      await ctx.editMessageText(
        `Заявка №${id} → ${ORDER_STATUS_LABEL[nextSt]}\n\n` + formatOrderHtml(afterStatus!),
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("« Меню", "menu:back") },
      );
      return;
    }

    if (act === "drv") {
      await ctx.answerCallbackQuery({ text: "Используйте кнопку на этапе prep_unload" });
      return;
    }

    if (act === "dvc") {
      if (ctx.session.role !== "driver") {
        await ctx.answerCallbackQuery({ text: "Только водитель" });
        return;
      }
      if (!o.driverUnloadPending) {
        await ctx.answerCallbackQuery({ text: "Не требуется" });
        return;
      }
      await orderStore.update(id, { driverUnloadPending: false });
      const ready = await orderStore.setStatus(id, "ready_for_unload");
      if (ready) {
        await notifyOnStatusChange(ctx.api, ready, "ready_for_unload");
      }
      await ctx.answerCallbackQuery({ text: "Подтверждено" });
      const afterDvc = await orderStore.get(id);
      await ctx.editMessageText(
        `Статус: ${ORDER_STATUS_LABEL.ready_for_unload}\n\n` + formatOrderHtml(afterDvc!),
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("« Меню", "menu:back") },
      );
      return;
    }

    if (act === "dvt") {
      if (ctx.session.role !== "driver") {
        await ctx.answerCallbackQuery({ text: "Только водитель" });
        return;
      }
      if (o.status !== "ready_for_unload") {
        await ctx.answerCallbackQuery({ text: "Неверный статус" });
        return;
      }
      const updated = await orderStore.setStatus(id, "in_transit");
      if (updated) {
        await notifyOnStatusChange(ctx.api, updated, "in_transit");
      }
      await ctx.answerCallbackQuery();
      const afterDvt = await orderStore.get(id);
      await ctx.editMessageText(
        `В пути — заявка №${id}\n\n` + formatOrderHtml(afterDvt!),
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("« Меню", "menu:back") },
      );
      return;
    }

    if (act === "dvf") {
      if (ctx.session.role !== "driver") {
        await ctx.answerCallbackQuery({ text: "Только водитель" });
        return;
      }
      if (o.status !== "in_transit") {
        await ctx.answerCallbackQuery({ text: "Неверный статус" });
        return;
      }
      const updated = await orderStore.setStatus(id, "done");
      if (updated) {
        await notifyOnStatusChange(ctx.api, updated, "done");
      }
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `Завершено — заявка №${id}`,
        { reply_markup: new InlineKeyboard().text("« Меню", "menu:back") },
      );
      return;
    }
  });

  /** Просмотр заявки (клиент / упаковщик / менеджер / управляющий) */
  bot.callbackQuery(/^v:(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    const o = await orderStore.get(id);
    if (!o) {
      await ctx.answerCallbackQuery({ text: "Не найдено" });
      return;
    }
    const role = ctx.session.role;
    if (!role) {
      await ctx.answerCallbackQuery({ text: "Сначала /start" });
      return;
    }
    if (role === "client" && o.clientTelegramId !== ctx.from?.id) {
      await ctx.answerCallbackQuery({ text: "Чужая заявка" });
      return;
    }
    if (role === "driver") {
      await ctx.answerCallbackQuery({ text: "Используйте меню водителя" });
      return;
    }
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    if (role === "packer") {
      if (o.status === "prep_unload" && !o.driverUnloadPending) {
        kb.text("🚚 Запросить выгрузку у водителя", `o:${id}:pkr`).row();
      } else if (o.status !== "prep_unload" && packerNextStatus[o.status]) {
        kb.text("➡️ Следующий этап", `o:${id}:pkr`).row();
      } else if (o.status === "prep_unload" && o.driverUnloadPending) {
        kb.text("⏳ Ждём водителя", "noop:0").row();
      }
    }
    kb.text("« Назад", "menu:back");
    await ctx.editMessageText(formatOrderHtml(o), {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^noop:/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Ожидаем водителя" });
  });

  /** Текстовые шаги черновика */
  bot.on("message:text", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || ctx.session.role !== "client") {
      return;
    }
    const text = ctx.message.text.trim();

    if (d.step === "product") {
      if (!text) {
        return;
      }
      d.product = text;
      d.step = "quantity";
      await ctx.reply("📝 <b>Шаг 2/6</b>\nКоличество товара (в единицах измерения):", {
        parse_mode: "HTML",
      });
      return;
    }
    if (d.step === "quantity") {
      if (!text) {
        return;
      }
      d.quantityText = text;
      d.step = "tz";
      await ctx.reply("📝 <b>Шаг 3/6</b>\nТЗ (техническое задание / условия):", {
        parse_mode: "HTML",
      });
      return;
    }
    if (d.step === "tz") {
      if (!text) {
        return;
      }
      d.tz = text;
      d.step = "pickup_decision";
      const kb = new InlineKeyboard()
        .text("Да", "pickup:y")
        .text("Нет", "pickup:n")
        .row()
        .text("« Отмена", "menu:back");
      await ctx.reply("📝 <b>Шаг 4/6</b>\nНужен ли <b>забор товара</b> (с маркетплейса)?", {
        parse_mode: "HTML",
        reply_markup: kb,
      });
      return;
    }
    if (d.step === "comment") {
      d.comment = text;
      d.step = "confirm";
      const kb = new InlineKeyboard()
        .text("✅ Создать черновик", "draft:create")
        .row()
        .text("« Отмена", "menu:back");
      await ctx.reply(
        `${formatDraftSummaryHtml(d)}\n\nПодтвердите создание черновика заявки.`,
        { parse_mode: "HTML", reply_markup: kb },
      );
      return;
    }
  });

  bot.catch((err) => {
    console.error("bot error", err);
  });
};
