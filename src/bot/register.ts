import {
  Bot,
  InlineKeyboard,
  Keyboard,
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
import { BOT_ROLES, isManagerLikeRole } from "../lib/roles.js";
import { canUseRole, getRoleEntryPolicy } from "../lib/access.js";
import { getLastSelectedBotRole, setLastSelectedBotRole } from "../store/last-bot-role-store.js";
import { getLockedRole, setLockedRole } from "../store/user-role-store.js";
import { orderStore } from "../store/order-store.js";
import {
  getBusinessNamesForTelegramIds,
  getClientDisplayNameForOrderList,
  getClientUsername,
  isClientRegistered,
  listClientsForPicker,
  needsBusinessName,
  needsPhoneVerification,
  saveClientConsent,
  setClientBusinessName,
  setClientPhone,
} from "../store/client-store.js";
import type { FulfillmentOrder } from "../domain/order.js";
import {
  emptyOrderDraft,
  type ClientOrdersListMode,
  type SessionData,
} from "./session-data.js";
import { escapeHtml, formatDraftSummaryHtml, formatOrderHtml } from "./format.js";
import { getMiniAppUrl } from "../env.js";
import { orderListButtonLabel } from "./order-list-label.js";
import { notifyApprovedDeliveryDate, notifyDriversWarehouseHandoff, notifyOnStatusChange } from "./notify.js";
import { canShowSwitchRoleInMiniApp } from "../lib/miniapp-role.js";

export type MyContext = Context & SessionFlavor<SessionData>;

const isMarketplaceId = (v: unknown): v is MarketplaceId =>
  typeof v === "string" && (MARKETPLACES as readonly string[]).includes(v);

const roleLabel: Record<BotRole, string> = {
  client: "Клиент",
  packer: "Работник склада",
  driver: "Водитель",
  manager: "Менеджер",
  supervisor: "Управляющий",
};

/** Кто может редактировать текущий черновик: клиент (свой) или менеджер/управляющий в режиме proxy. */
const canUseOrderDraft = (ctx: MyContext): boolean => {
  const role = ctx.session.role;
  const d = ctx.session.orderDraft;
  if (!d || !role) {
    return false;
  }
  if (role === "client") {
    return !d.proxyClientTelegramId;
  }
  if (isManagerLikeRole(role)) {
    if (d.step === "proxy_client_id") {
      return true;
    }
    return d.proxyClientTelegramId !== undefined && d.proxyClientTelegramId > 0;
  }
  return false;
};

const canFinalizeDraft = (ctx: MyContext): boolean => {
  const role = ctx.session.role;
  const d = ctx.session.orderDraft;
  if (!d || !role) {
    return false;
  }
  if (role === "client" && !d.proxyClientTelegramId) {
    return true;
  }
  if (isManagerLikeRole(role) && d.proxyClientTelegramId !== undefined && d.proxyClientTelegramId > 0) {
    return true;
  }
  return false;
};

/** Линейные этапы склада до передачи водителю (без «следующий этап» — только явные кнопки в карточке). */
const PACKER_WAREHOUSE_LINEAR: Partial<Record<OrderStatusId, OrderStatusId>> = {
  accepted: "receiving",
  receiving: "receiving_done",
  receiving_done: "pack_sort",
};

const appendPackerWarehouseActions = (kb: InlineKeyboard, orderId: string, o: FulfillmentOrder): void => {
  if (o.status === "accepted") {
    kb.text("📥 Принято на складе Мурла", `o:${orderId}:pkr`).row();
    return;
  }
  if (o.status === "receiving") {
    kb.text("🔧 Товар в работе", `o:${orderId}:pkr`).row();
    return;
  }
  if (o.status === "receiving_done") {
    kb.text("📦 Товар готов к отгрузке", `o:${orderId}:pkr`).row();
    return;
  }
  if (o.status === "pack_sort") {
    kb.text("🚚 Передать водителю", `o:${orderId}:pkr`).row();
    return;
  }
  if (o.status === "prep_unload") {
    if (o.driverUnloadPending) {
      kb.text("⏳ Ждём подтверждения водителя", "noop:0").row();
    } else {
      kb.text("🚚 Передать водителю", `o:${orderId}:pkr`).row();
    }
  }
};

/** Клавиатура карточки заявки для работника склада: этап + список + меню (как при открытии через «v:»). */
const packerOrderDetailKeyboard = (ctx: MyContext, orderId: string, o: FulfillmentOrder): InlineKeyboard => {
  const kb = new InlineKeyboard();
  appendPackerWarehouseActions(kb, orderId, o);
  const listCb =
    ctx.session.packerListSource === "archive" ? "menu:packer_archive" : "menu:packer_orders";
  kb.text("« К списку", listCb).row();
  kb.text("« Меню", "menu:back");
  return kb;
};

/** Карточка заявки для водителя (в т.ч. архив — «К списку» ведёт в нужный список). */
const driverOrderDetailKeyboard = (ctx: MyContext, orderId: string, o: FulfillmentOrder): InlineKeyboard => {
  const kb = new InlineKeyboard();
  if (o.driverUnloadPending) {
    kb.text("✅ Подтвердить готовность к выгрузке", `o:${orderId}:dvc`).row();
  }
  if (o.status === "prep_unload" && !o.approvedDeliveryDate) {
    kb.text("📅 Утвердить дату рейса", `o:${orderId}:dvc_date`).row();
  }
  if (o.status === "ready_for_unload") {
    if (!o.approvedDeliveryDate) {
      kb.text("📅 Выбрать дату рейса", `o:${orderId}:dvc_date`).row();
    } else {
      kb.text("📅 Изменить дату рейса", `o:${orderId}:dvc_date_edit`).row();
    }
    kb.text("🚛 В пути", `o:${orderId}:dvt`).row();
  }
  if (o.status === "in_transit") {
    kb.text("✔️ Завершено", `o:${orderId}:dvf`).row();
  }
  const listCb =
    ctx.session.driverListSource === "archive" ? "menu:driver_archive" : "menu:driver_orders";
  kb.text("« К списку", listCb).row();
  kb.text("« Меню", "menu:back");
  return kb;
};

const sortOrdersByUpdatedDesc = (orders: FulfillmentOrder[]): FulfillmentOrder[] =>
  [...orders].sort((a, b) => b.updatedAt - a.updatedAt);

const MURLA_SITE_URL = "https://murla.company";
const MURLA_GROUP_TG_URL = "https://t.me/MurlaWbOzonFF";
const MINIAPP_CACHE_BUSTER = "20260402-2";

const withMiniappVersion = (url: string): string => {
  try {
    const u = new URL(url);
    u.searchParams.set("cv", MINIAPP_CACHE_BUSTER);
    return u.toString();
  } catch {
    return url;
  }
};

const withMurlaLinksRow = (kb: InlineKeyboard): InlineKeyboard =>
  kb
    .row()
    .url("🌐 Сайт", MURLA_SITE_URL)
    .url("💬 Группа", MURLA_GROUP_TG_URL);

const mainMenuKeyboard = (role: BotRole): InlineKeyboard => {
  const kb = new InlineKeyboard();
  if (role === "client") {
    kb.text("➕ Новая заявка", "menu:new_order").row()
      .text("🔄 Активные", "menu:client_active")
      .text("📄 Черновики", "menu:client_drafts")
      .row()
      .text("📁 Архив", "menu:client_archive")
      .text("✏️ ИП / магазин", "menu:edit_business");
    const mini = getMiniAppUrl();
    if (mini) {
      kb.row().webApp("📱 Приложение", withMiniappVersion(mini));
    }
    return withMurlaLinksRow(kb);
  }
  if (role === "packer") {
    kb.text("📦 Заявки", "menu:packer_orders").text("📁 Архив", "menu:packer_archive");
    return withMurlaLinksRow(kb);
  }
  if (role === "driver") {
    kb.text("🚚 Заявки", "menu:driver_orders").text("📁 Архив", "menu:driver_archive");
    return withMurlaLinksRow(kb);
  }
  if (isManagerLikeRole(role)) {
    kb.text("➕ За клиента", "menu:proxy_order")
      .text("📑 Все заявки", "menu:all_orders")
      .row()
      .text("📊 Отчёт", "menu:report");
    return withMurlaLinksRow(kb);
  }
  return withMurlaLinksRow(kb);
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

const kbMenuRow = (kb: InlineKeyboard): InlineKeyboard =>
  kb.row().text("« Меню", "menu:back");

const kbCancelOnly = (): InlineKeyboard => new InlineKeyboard().text("« Отмена", "menu:back");

const kbBackCancel = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("« Назад", "draft:nav_back")
    .row()
    .text("« Отмена", "menu:back");

const kbPickupDecision = (): InlineKeyboard =>
  kbMenuRow(
    new InlineKeyboard()
      .text("Да", "pickup:y")
      .text("Нет", "pickup:n")
      .row()
      .text("« Назад", "draft:nav_back"),
  );

const MSG_PICK_ADDRESS_FIRST =
  "📍 <b>Шаг 4/7 — забор товара</b>\nУкажите <b>адрес забора</b> одним сообщением (своя точка / как добраться).";

const MSG_DESIRED_DELIVERY_DATE =
  "📅 <b>Шаг 6/7</b>\n<b>Желаемая дата поставки.</b>\n\nУкажите дату одним сообщением (например <code>15.04.2026</code>) или нажмите «Пропустить дату».";

const MSG_PICK_ADDRESS_NEXT =
  "📍 Укажите адрес <b>следующей</b> точки забора одним сообщением:";

const MSG_AFTER_PICKUP_ADDED =
  "✅ Адрес добавлен.\n\nДобавить ещё одну точку забора или перейти к выбору <b>места доставки</b>?";

const kbPickAfterPoint = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("➕ Ещё точка забора", "pmore:y")
    .row()
    .text("➡️ Дальше (куда везти)", "pmore:n")
    .row()
    .text("« Назад", "draft:nav_back")
    .row()
    .text("« Отмена", "menu:back");

const kbDeliveryMarketplaceFooter = (kb: InlineKeyboard): InlineKeyboard =>
  kb.row().text("« Назад", "draft:nav_back").row().text("« Отмена", "menu:back");

const kbDesiredDate = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("Пропустить дату", "skip:desired_date")
    .row()
    .text("« Назад", "draft:nav_back")
    .row()
    .text("« Отмена", "menu:back");

const kbConfirmDraft = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("✅ Создать черновик", "draft:create")
    .row()
    .text("« Назад", "draft:nav_back")
    .row()
    .text("« Отмена", "menu:back");

const ordersListCallback = (role: BotRole): string => {
  if (role === "client") {
    return "menu:client_active";
  }
  if (role === "packer") {
    return "menu:packer_orders";
  }
  if (role === "driver") {
    return "menu:driver_orders";
  }
  return "menu:all_orders";
};

const clientOrdersListCallback = (ctx: MyContext): string => {
  const m = ctx.session.clientOrdersListMode;
  if (m === "drafts") {
    return "menu:client_drafts";
  }
  if (m === "active") {
    return "menu:client_active";
  }
  if (m === "archive") {
    return "menu:client_archive";
  }
  return "menu:client_active";
};

const isActiveClientOrder = (o: FulfillmentOrder): boolean =>
  o.status !== "draft" && o.status !== "done" && o.status !== "cancelled";

const setClientListMode = (ctx: MyContext, mode: ClientOrdersListMode): void => {
  ctx.session.clientOrdersListMode = mode;
};

const MSG_PHONE_VERIFICATION =
  "📱 <b>Подтверждение номера</b>\n\n" +
  "Нажмите кнопку ниже — Telegram передаст номер, привязанный к вашему аккаунту. " +
  "Он нужен для связи по заявкам.";

const phoneRequestKeyboard = (): Keyboard =>
  new Keyboard().requestContact("📱 Отправить мой номер").resized();

const sendPhoneVerificationPrompt = async (ctx: MyContext): Promise<void> => {
  await ctx.reply(MSG_PHONE_VERIFICATION, {
    parse_mode: "HTML",
    reply_markup: phoneRequestKeyboard(),
  });
};

const MSG_BUSINESS_NAME =
  "🏷 <b>Регистрация — шаг 3</b>\n\n" +
  "Введите <b>одним сообщением</b>, как отображать вас в заявках:\n\n" +
  "• название ИП — например: <code>ИП Склемин Кирилл Андреевич</code>\n" +
  "• или название магазина — например: <code>КИС КИС</code>";

const sendBusinessNamePrompt = async (ctx: MyContext): Promise<void> => {
  await ctx.reply(MSG_BUSINESS_NAME, { parse_mode: "HTML" });
};

type SendMainMenuOpts = {
  /** Сразу после первого ввода названия ИП / магазина — одно сообщение с меню. */
  clientRegistrationComplete?: boolean;
  /** После смены названия из меню «Название ИП / магазина». */
  clientBusinessNameUpdated?: boolean;
};

const sendMainMenu = async (
  ctx: MyContext,
  role: BotRole,
  opts?: SendMainMenuOpts,
): Promise<void> => {
  const uid = ctx.from?.id;
  if (role === "client" && uid !== undefined) {
    if (await isClientRegistered(uid)) {
      let lead = "";
      if (opts?.clientRegistrationComplete) {
        lead = "✅ <b>Регистрация завершена.</b>\n\n";
      } else if (opts?.clientBusinessNameUpdated) {
        lead = "✅ <b>Название ИП / магазина обновлено.</b>\n\n";
      }
      const text = `Роль: <b>${roleLabel[role]}</b>\n\n${lead}Выберите действие:`;
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
      return;
    }
    if (await needsPhoneVerification(uid)) {
      /** Одно сообщение с reply-клавиатурой; не дублировать с editMessageText. */
      await sendPhoneVerificationPrompt(ctx);
      return;
    }
    if (await needsBusinessName(uid)) {
      await sendBusinessNamePrompt(ctx);
      return;
    }
    const kb = new InlineKeyboard().text("✅ Согласен с условиями", "reg:accept");
    const consentText =
      "📋 <b>Регистрация — шаг 1</b>\n\n" +
      "Для работы с заявками подтвердите согласие с условиями обслуживания и получения уведомлений в Telegram.";
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(consentText, { parse_mode: "HTML", reply_markup: kb });
    } else {
      await ctx.reply(consentText, { parse_mode: "HTML", reply_markup: kb });
    }
    return;
  }
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

/** Подпись «Клиент: …» только если пользователь полностью зарегистрирован в боте. */
const proxyTargetClientCaptionHtml = async (telegramId: number): Promise<string> => {
  if (!(await isClientRegistered(telegramId))) {
    return "";
  }
  const label = await getClientDisplayNameForOrderList(telegramId);
  return `\n\nКлиент: <b>${escapeHtml(label)}</b>`;
};

const showProxyOrderPicker = async (ctx: MyContext): Promise<void> => {
  const rows = await listClientsForPicker();
  const kb = new InlineKeyboard();
  for (const c of rows) {
    const label = c.label.length > 36 ? `${c.label.slice(0, 33)}…` : c.label;
    kb.text(label, `pxc:${c.telegramId}`).row();
  }
  kb.text("➕ Новый (ввести id)", "pxc:new").row();
  kb.text("« Меню", "menu:back");
  const text =
    "👤 <b>Заявка за клиента</b>\n\nВыберите клиента из списка или укажите Telegram user id нового клиента.";
  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  }
};

export const registerHandlers = (bot: Bot<MyContext>): void => {
  bot.use(
    session({
      initial: (): SessionData => ({}),
      storage: new MemorySessionStorage<SessionData>(),
    }),
  );

  /**
   * На serverless (Vercel) сессия в памяти не сохраняется между запросами.
   * Восстанавливаем роль из БД: закреплённая (lock_first) или последняя выбранная.
   */
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid !== undefined && ctx.session.role === undefined) {
      const locked = await getLockedRole(uid);
      if (locked) {
        ctx.session.role = locked;
      } else {
        const last = await getLastSelectedBotRole(uid);
        if (last && canUseRole(uid, last)) {
          ctx.session.role = last;
        }
      }
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) {
      return;
    }
    ctx.session.orderDraft = undefined;
    ctx.session.editingBusinessName = undefined;
    const policy = getRoleEntryPolicy(uid);

    if (policy === "full_bypass") {
      ctx.session.role = undefined;
      await ctx.reply(
        "👋 <b>Мурла — бот помощник</b>\n\n<i>Режим WHITELIST_BYPASS: любая роль.</i>\n\nВыберите роль:",
        { parse_mode: "HTML", reply_markup: roleSelectKeyboard(uid) },
      );
      return;
    }

    if (policy === "always_switch") {
      ctx.session.role = undefined;
      await ctx.reply(
        "👋 <b>Мурла — бот помощник</b>\n\nВыберите роль (при каждом /start можно сменить):",
        { parse_mode: "HTML", reply_markup: roleSelectKeyboard(uid) },
      );
      return;
    }

    if (policy === "lock_first") {
      const locked = await getLockedRole(uid);
      if (locked) {
        ctx.session.role = locked;
        await sendMainMenu(ctx, locked);
        return;
      }
      ctx.session.role = undefined;
      await ctx.reply(
        "👋 <b>Мурла — бот помощник</b>\n\nПервый вход — выберите роль (потом смена только у администратора БД):",
        { parse_mode: "HTML", reply_markup: roleSelectKeyboard(uid) },
      );
      return;
    }

    ctx.session.role = "client";
    await setLastSelectedBotRole(uid, "client");
    await sendMainMenu(ctx, "client");
  });

  bot.command("cancel", async (ctx) => {
    ctx.session.orderDraft = undefined;
    ctx.session.editingBusinessName = undefined;
    await ctx.reply("Черновик заявки сброшен. /start — меню.");
  });

  /** Данные из Telegram Mini App (`sendData`). */
  bot.on("message:web_app_data", async (ctx) => {
    const uid = ctx.from?.id;
    const raw = ctx.message?.web_app_data?.data;
    if (uid === undefined || raw === undefined) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await ctx.reply("Некорректные данные из приложения.");
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    const obj = parsed as Record<string, unknown>;

    if (obj.action === "switch_role") {
      if (!(await canShowSwitchRoleInMiniApp(uid))) {
        await ctx.reply("Смена роли недоступна.");
        return;
      }
      const selectedRoleRaw = typeof obj.selectedRole === "string" ? obj.selectedRole : undefined;
      const selectedRole = selectedRoleRaw as BotRole | undefined;
      const isKnownRole =
        selectedRole !== undefined && (BOT_ROLES as readonly string[]).includes(selectedRole);
      const isAllowedRole = selectedRole !== undefined && canUseRole(uid, selectedRole);

      if (selectedRole && isKnownRole && isAllowedRole) {
        const policy = getRoleEntryPolicy(uid);
        if (policy === "lock_first") {
          const locked = await getLockedRole(uid);
          if (locked !== undefined && locked !== selectedRole) {
            await ctx.reply(
              `❌ Роль уже закреплена: <b>${roleLabel[locked]}</b>. Смена недоступна.`,
              { parse_mode: "HTML" },
            );
            return;
          }
          if (locked === undefined) {
            await setLockedRole(uid, selectedRole);
          }
        }

        ctx.session.role = selectedRole;
        ctx.session.orderDraft = undefined;
        ctx.session.editingBusinessName = undefined;
        await setLastSelectedBotRole(uid, selectedRole);
        await ctx.reply(`✅ Роль изменена: <b>${roleLabel[selectedRole]}</b>`, {
          parse_mode: "HTML",
        });
        await sendMainMenu(ctx, selectedRole);
        return;
      }

      ctx.session.role = undefined;
      ctx.session.orderDraft = undefined;
      ctx.session.editingBusinessName = undefined;
      await ctx.reply("Выберите роль:", {
        parse_mode: "HTML",
        reply_markup: roleSelectKeyboard(uid),
      });
      return;
    }

    if (typeof obj.product !== "string") {
      return;
    }

    let effectiveRole = ctx.session.role;
    if (effectiveRole === undefined) {
      const locked = await getLockedRole(uid);
      if (locked !== undefined) {
        effectiveRole = locked;
      } else {
        const last = await getLastSelectedBotRole(uid);
        if (last !== undefined && canUseRole(uid, last)) {
          effectiveRole = last;
        }
      }
    }
    if (effectiveRole === undefined) {
      effectiveRole = "client";
    }
    ctx.session.role = effectiveRole;

    if (effectiveRole !== "client") {
      await ctx.reply("Создание заявки из приложения доступно только в роли «Клиент».");
      return;
    }

    const product = obj.product.trim();
    const quantityText = String(obj.quantity ?? "").trim();
    const tz = String(obj.tz ?? "").trim();
    const needsPickup = Boolean(obj.needsPickup);
    const marketplace = obj.marketplace;
    const warehouseId = String(obj.warehouseId ?? "").trim();
    const desiredDeliveryDate = String(obj.desiredDeliveryDate ?? "").trim();
    const comment = String(obj.comment ?? "").trim();

    if (!product || !quantityText || !tz) {
      await ctx.reply("Заполните товар, количество и ТЗ.");
      return;
    }
    if (!isMarketplaceId(marketplace)) {
      await ctx.reply("Укажите маркетплейс (WB или Ozon).");
      return;
    }
    const wh = findWarehouseById(warehouseId);
    if (!wh || wh.marketplace !== marketplace) {
      await ctx.reply("Выберите корректный склад.");
      return;
    }
    let pickupPoints: { addressText: string }[] = [];
    if (needsPickup) {
      const addrs = obj.pickupAddresses;
      if (!Array.isArray(addrs)) {
        await ctx.reply("Укажите хотя бы один адрес забора.");
        return;
      }
      pickupPoints = addrs
        .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        .map((a) => ({ addressText: a.trim() }));
      if (pickupPoints.length === 0) {
        await ctx.reply("Укажите хотя бы один адрес забора.");
        return;
      }
    }

    const delivery = { marketplace, warehouseId };

    let order: FulfillmentOrder;
    try {
      order = await orderStore.create({
        clientTelegramId: uid,
        clientUsername: ctx.from?.username,
        product,
        quantityText,
        tz,
        needsPickup,
        pickupPoints: needsPickup ? pickupPoints : [],
        delivery,
        desiredDeliveryDate: desiredDeliveryDate || undefined,
        comment: comment || undefined,
      });
    } catch (err) {
      console.error("web_app_data order create", err);
      await ctx.reply("Не удалось создать заявку. Попробуйте ещё раз.");
      return;
    }

    await notifyOnStatusChange(ctx.api, order, "draft");

    const kb = new InlineKeyboard();
    kb.text("📤 Отправить в работу", `o:${order.id}:send`).row();
    kb.text("« Меню", "menu:back");
    await ctx.reply(
      `✅ <b>Черновик №${order.id}</b> создан из приложения.\n\n` +
        formatOrderHtml(order) +
        "\n\nНажмите «Отправить в работу», чтобы статус стал «Принято в работу».",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  /** Главное меню без лишнего текста в чате: сообщение с командой удаляется после ответа. */
  bot.command("menu", async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.reply("Сначала /start и выберите роль «Клиент».");
      return;
    }
    ctx.session.orderDraft = undefined;
    ctx.session.editingBusinessName = undefined;
    await sendMainMenu(ctx, "client");
    try {
      await ctx.deleteMessage();
    } catch {
      // нет прав или клиент не дал удалять сообщения
    }
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
    ctx.session.editingBusinessName = undefined;
    await setLastSelectedBotRole(uid, role);
    await ctx.answerCallbackQuery();
    await sendMainMenu(ctx, role);
  });

  bot.callbackQuery("reg:accept", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined || ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Сначала выберите роль «Клиент» через /start" });
      return;
    }
    await saveClientConsent(uid, ctx.from?.username);
    await ctx.answerCallbackQuery({ text: "Шаг 2 — телефон" });
    if (ctx.callbackQuery.message) {
      await ctx.editMessageText(
        "✅ <b>Согласие сохранено.</b>\n\n📱 <b>Шаг 2:</b> подтвердите номер телефона кнопкой ниже в следующем сообщении.",
        { parse_mode: "HTML" },
      );
    }
    await sendPhoneVerificationPrompt(ctx);
  });

  bot.callbackQuery("menu:proxy_order", async (ctx) => {
    if (!ctx.session.role || !isManagerLikeRole(ctx.session.role)) {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    ctx.session.orderDraft = undefined;
    await ctx.answerCallbackQuery();
    await showProxyOrderPicker(ctx);
  });

  bot.callbackQuery("pxc:new", async (ctx) => {
    if (!ctx.session.role || !isManagerLikeRole(ctx.session.role)) {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    ctx.session.orderDraft = emptyOrderDraft();
    ctx.session.orderDraft.step = "proxy_client_id";
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      "📎 Введите <b>Telegram user id</b> клиента (целое число). Например, через @userinfobot.",
      { parse_mode: "HTML", reply_markup: kbCancelOnly() },
    );
  });

  bot.callbackQuery(/^pxc:(\d+)$/, async (ctx) => {
    if (!ctx.session.role || !isManagerLikeRole(ctx.session.role)) {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const id = Number(ctx.match[1]);
    ctx.session.orderDraft = emptyOrderDraft();
    ctx.session.orderDraft.proxyClientTelegramId = id;
    ctx.session.orderDraft.step = "product";
    await ctx.answerCallbackQuery();
    const cap = await proxyTargetClientCaptionHtml(id);
    await ctx.editMessageText(
      `📝 <b>Шаг 1/7</b>${cap}\n\nКакой у клиента товар?\n\nНапишите одним сообщением.`,
      { parse_mode: "HTML", reply_markup: kbCancelOnly() },
    );
  });

  bot.callbackQuery("menu:back", async (ctx) => {
    const role = ctx.session.role;
    if (!role) {
      await ctx.answerCallbackQuery({ text: "Сначала выберите роль через /start" });
      return;
    }
    ctx.session.orderDraft = undefined;
    ctx.session.editingBusinessName = undefined;
    await ctx.answerCallbackQuery();
    await sendMainMenu(ctx, role);
  });

  /** Навигация назад по шагам черновика заявки */
  bot.callbackQuery("draft:nav_back", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || !canUseOrderDraft(ctx)) {
      await ctx.answerCallbackQuery({ text: "Нет черновика" });
      return;
    }
    if (!ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      return;
    }
    await ctx.answerCallbackQuery();
    switch (d.step) {
      case "proxy_client_id":
        ctx.session.orderDraft = undefined;
        await showProxyOrderPicker(ctx);
        return;
      case "product":
        if (d.proxyClientTelegramId !== undefined && ctx.session.role && isManagerLikeRole(ctx.session.role)) {
          ctx.session.orderDraft = undefined;
          await showProxyOrderPicker(ctx);
          return;
        }
        await ctx.reply("Назад отсюда нельзя — используйте «Отмена» или /cancel.");
        return;
      case "quantity":
        d.step = "product";
        d.quantityText = "";
        await ctx.reply("📝 <b>Шаг 1/7</b>\nКакой у вас товар?\n\nНапишите одним сообщением.", {
          parse_mode: "HTML",
          reply_markup: kbCancelOnly(),
        });
        return;
      case "tz":
        d.step = "quantity";
        d.tz = "";
        await ctx.reply("📝 <b>Шаг 2/7</b>\nКоличество товара (в единицах измерения):", {
          parse_mode: "HTML",
          reply_markup: kbBackCancel(),
        });
        return;
      case "pickup_decision":
        d.step = "tz";
        await ctx.reply("📝 <b>Шаг 3/7</b>\nТЗ (техническое задание / условия):", {
          parse_mode: "HTML",
          reply_markup: kbBackCancel(),
        });
        return;
      case "pick_address":
        if (d.pickupPoints.length > 0) {
          d.step = "pick_after_point";
          await ctx.editMessageText(MSG_AFTER_PICKUP_ADDED, {
            parse_mode: "HTML",
            reply_markup: kbPickAfterPoint(),
          });
        } else {
          d.step = "pickup_decision";
          await ctx.editMessageText(
            "📝 <b>Шаг 4/7</b>\nНужен ли <b>забор товара</b> (со своей точки)?",
            { parse_mode: "HTML", reply_markup: kbPickupDecision() },
          );
        }
        return;
      case "pick_after_point":
        if (d.pickupPoints.length > 0) {
          d.pickupPoints.pop();
        }
        if (d.pickupPoints.length === 0) {
          d.step = "pick_address";
          await ctx.editMessageText(MSG_PICK_ADDRESS_FIRST, {
            parse_mode: "HTML",
            reply_markup: kbBackCancel(),
          });
        } else {
          d.step = "pick_after_point";
          await ctx.editMessageText(MSG_AFTER_PICKUP_ADDED, {
            parse_mode: "HTML",
            reply_markup: kbPickAfterPoint(),
          });
        }
        return;
      case "delivery_marketplace":
        d.deliveryMarketplace = undefined;
        if (d.needsPickup && d.pickupPoints.length > 0) {
          d.step = "pick_after_point";
          await ctx.editMessageText(MSG_AFTER_PICKUP_ADDED, {
            parse_mode: "HTML",
            reply_markup: kbPickAfterPoint(),
          });
        } else {
          d.step = "pickup_decision";
          await ctx.editMessageText(
            "📝 <b>Шаг 4/7</b>\nНужен ли <b>забор товара</b> (со своей точки)?",
            { parse_mode: "HTML", reply_markup: kbPickupDecision() },
          );
        }
        return;
      case "comment":
        if (!d.delivery) {
          await ctx.reply("Черновик сброшен. /start");
          return;
        }
        d.step = "desired_delivery_date";
        d.comment = "";
        await ctx.editMessageText(MSG_DESIRED_DELIVERY_DATE, {
          parse_mode: "HTML",
          reply_markup: kbDesiredDate(),
        });
        return;
      case "desired_delivery_date":
        if (!d.delivery) {
          await ctx.reply("Черновик сброшен. /start");
          return;
        }
        d.step = "delivery_warehouse";
        d.desiredDeliveryDate = "";
        {
          const mp = d.delivery.marketplace;
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
        }
        return;
      case "confirm":
        d.step = "comment";
        await ctx.editMessageText(
          "💬 <b>Шаг 7/7</b>\nКомментарий (при необходимости).\n\nИли нажмите «Пропустить».",
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("Пропустить комментарий", "skip:comment")
              .row()
              .text("« Назад", "draft:nav_back")
              .row()
              .text("« Отмена", "menu:back"),
          },
        );
        return;
      default:
        await ctx.reply("Назад отсюда нельзя — используйте «Отмена» или /cancel.");
    }
  });

  /** ——— Клиент: новая заявка (7 шагов) ——— */
  bot.callbackQuery("menu:new_order", async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const uid = ctx.from?.id;
    if (uid === undefined || !(await isClientRegistered(uid))) {
      await ctx.answerCallbackQuery({ text: "Сначала примите условия" });
      await sendMainMenu(ctx, "client");
      return;
    }
    ctx.session.orderDraft = emptyOrderDraft();
    ctx.session.orderDraft.step = "product";
    ctx.session.editingBusinessName = undefined;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      "📝 <b>Шаг 1/7</b>\nКакой у вас товар?\n\nНапишите одним сообщением.",
      { parse_mode: "HTML", reply_markup: kbCancelOnly() },
    );
  });

  bot.callbackQuery("menu:edit_business", async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const uid = ctx.from?.id;
    if (uid === undefined || !(await isClientRegistered(uid))) {
      await ctx.answerCallbackQuery({ text: "Сначала завершите регистрацию" });
      await sendMainMenu(ctx, "client");
      return;
    }
    ctx.session.orderDraft = undefined;
    ctx.session.editingBusinessName = true;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard().text("« Меню", "menu:back");
    const prompt =
      "✏️ <b>Название ИП / магазина</b>\n\n" +
      "Напишите одним сообщением, как показывать вас в списках заявок (то же поле, что при регистрации).\n\n" +
      "Минимум 2 символа, максимум 200.";
    if (ctx.callbackQuery.message) {
      await ctx.editMessageText(prompt, { parse_mode: "HTML", reply_markup: kb });
    } else {
      await ctx.reply(prompt, { parse_mode: "HTML", reply_markup: kb });
    }
  });

  bot.callbackQuery("pickup:y", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || !canUseOrderDraft(ctx) || d.step !== "pickup_decision") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.needsPickup = true;
    d.pickupPoints = [];
    d.step = "pick_address";
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(MSG_PICK_ADDRESS_FIRST, {
      parse_mode: "HTML",
      reply_markup: kbBackCancel(),
    });
  });

  bot.callbackQuery("pickup:n", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || !canUseOrderDraft(ctx) || d.step !== "pickup_decision") {
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
    kbDeliveryMarketplaceFooter(kb);
    await ctx.editMessageText(
      "🚚 <b>Шаг 5/7</b>\nВыберите маркетплейс, <b>куда нужно отвезти</b> товар:",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("pmore:y", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || !canUseOrderDraft(ctx) || d.step !== "pick_after_point") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.step = "pick_address";
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(MSG_PICK_ADDRESS_NEXT, {
      parse_mode: "HTML",
      reply_markup: kbBackCancel(),
    });
  });

  bot.callbackQuery("pmore:n", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || !canUseOrderDraft(ctx) || d.step !== "pick_after_point") {
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
    kbDeliveryMarketplaceFooter(kb);
    await ctx.editMessageText(
      "🚚 <b>Шаг 5/7</b>\nВыберите маркетплейс, <b>куда отвезти</b> товар:",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery(/^dm:(wb|ozon)$/, async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || !canUseOrderDraft(ctx) || d.step !== "delivery_marketplace") {
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
    if (!d || !canUseOrderDraft(ctx)) {
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
    kbDeliveryMarketplaceFooter(kb);
    await ctx.editMessageText("🚚 <b>Шаг 5/7</b>\nВыберите маркетплейс для доставки:", {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^dw:(.+)$/, async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || !canUseOrderDraft(ctx) || d.step !== "delivery_warehouse" || !d.deliveryMarketplace) {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    const wid = ctx.match[1];
    if (!findWarehouseById(wid)) {
      await ctx.answerCallbackQuery({ text: "Неизвестный склад" });
      return;
    }
    d.delivery = { marketplace: d.deliveryMarketplace, warehouseId: wid };
    d.step = "desired_delivery_date";
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(MSG_DESIRED_DELIVERY_DATE, {
      parse_mode: "HTML",
      reply_markup: kbDesiredDate(),
    });
  });

  bot.callbackQuery("skip:desired_date", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || !canUseOrderDraft(ctx) || d.step !== "desired_delivery_date") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.desiredDeliveryDate = "";
    d.step = "comment";
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text("Пропустить комментарий", "skip:comment")
      .row()
      .text("« Назад", "draft:nav_back")
      .row()
      .text("« Отмена", "menu:back");
    await ctx.editMessageText(
      "💬 <b>Шаг 7/7</b>\nКомментарий (при необходимости).\n\nИли нажмите «Пропустить».",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("skip:comment", async (ctx) => {
    const d = ctx.session.orderDraft;
    if (!d || !canUseOrderDraft(ctx) || d.step !== "comment") {
      await ctx.answerCallbackQuery({ text: "Сессия сброшена" });
      return;
    }
    d.comment = "";
    d.step = "confirm";
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `${formatDraftSummaryHtml(d)}\n\nПодтвердите создание черновика заявки.`,
      { parse_mode: "HTML", reply_markup: kbConfirmDraft() },
    );
  });

  bot.callbackQuery("draft:create", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined || !canFinalizeDraft(ctx)) {
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
    /** Сразу снимаем черновик из сессии, чтобы повторный колбэк (двойной тап) не создал вторую заявку. */
    const draftSnapshot = d;
    ctx.session.orderDraft = undefined;

    const isProxy = draftSnapshot.proxyClientTelegramId !== undefined;
    const clientTelegramId = isProxy ? draftSnapshot.proxyClientTelegramId! : uid;
    const clientUsername = isProxy
      ? (await getClientUsername(clientTelegramId)) ?? undefined
      : ctx.from?.username;
    const createdByTelegramId = isProxy ? uid : undefined;

    let order: FulfillmentOrder;
    try {
      order = await orderStore.create({
        clientTelegramId,
        clientUsername,
        createdByTelegramId,
        product: draftSnapshot.product.trim(),
        quantityText: draftSnapshot.quantityText.trim(),
        tz: draftSnapshot.tz.trim(),
        needsPickup: draftSnapshot.needsPickup ?? false,
        pickupPoints: draftSnapshot.needsPickup ? [...draftSnapshot.pickupPoints] : [],
        delivery: draftSnapshot.delivery!,
        desiredDeliveryDate: draftSnapshot.desiredDeliveryDate.trim() || undefined,
        comment: draftSnapshot.comment.trim() || undefined,
      });
    } catch (err) {
      console.error("draft:create orderStore.create", err);
      ctx.session.orderDraft = draftSnapshot;
      await ctx.answerCallbackQuery({ text: "Не удалось сохранить. Попробуйте ещё раз." });
      return;
    }

    await ctx.answerCallbackQuery();
    await notifyOnStatusChange(ctx.api, order, "draft");

    if (createdByTelegramId && (await isClientRegistered(clientTelegramId))) {
      try {
        await ctx.api.sendMessage(
          clientTelegramId,
          `📋 <b>Новый черновик заявки №${order.id}</b>\n\n` +
            `Для вас оформили черновик. Откройте «Черновики» в меню бота и при необходимости отправьте заявку в работу.\n\n` +
            formatOrderHtml(order),
          { parse_mode: "HTML" },
        );
      } catch (e) {
        console.error("notify client on proxy draft", e);
      }
    }

    const kb = new InlineKeyboard();
    if (!isProxy) {
      kb.text("📤 Отправить в работу", `o:${order.id}:send`).row();
    }
    kb.text("« Меню", "menu:back");
    const tail = isProxy
      ? "\n\n<i>Клиент увидит черновик у себя и сможет отправить его в работу.</i>"
      : "\n\nНажмите «Отправить в работу», чтобы статус стал «Принято в работу».";
    await ctx.editMessageText(`✅ <b>Черновик №${order.id}</b> создан.\n\n` + formatOrderHtml(order) + tail, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^o:(\d+):deldraft$/, async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const uid = ctx.from?.id;
    if (uid === undefined) {
      return;
    }
    const id = ctx.match[1];
    const o = await orderStore.get(id);
    if (!o || o.clientTelegramId !== uid) {
      await ctx.answerCallbackQuery({ text: "Заявка не найдена" });
      return;
    }
    if (o.status !== "draft") {
      await ctx.answerCallbackQuery({ text: "Можно удалить только черновик" });
      return;
    }
    await orderStore.delete(id);
    setClientListMode(ctx, "drafts");
    await ctx.answerCallbackQuery({ text: "Удалено" });
    await ctx.editMessageText(`🗑 Черновик №${id} удалён.`, {
      reply_markup: new InlineKeyboard()
        .text("📄 Черновики", "menu:client_drafts")
        .row()
        .text("« Меню", "menu:back"),
    });
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
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("« Меню", "menu:back") },
    );
  });

  bot.callbackQuery("menu:client_active", async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const uid = ctx.from?.id;
    if (uid === undefined) {
      return;
    }
    await ctx.answerCallbackQuery();
    setClientListMode(ctx, "active");
    const list = (await orderStore.listByClient(uid)).filter(isActiveClientOrder);
    if (!list.length) {
      await ctx.editMessageText("Активных заявок нет.", {
        reply_markup: new InlineKeyboard()
          .text("➕ Новая заявка", "menu:new_order")
          .text("« Меню", "menu:back"),
      });
      return;
    }
    const myName = await getClientDisplayNameForOrderList(uid);
    const kb = new InlineKeyboard();
    list.slice(0, 20).forEach((o, i) => {
      kb.text(orderListButtonLabel(myName, i, ORDER_STATUS_LABEL[o.status]), `v:${o.id}`).row();
    });
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("🔄 <b>Активные заявки</b> — в работе:", {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  bot.callbackQuery("menu:client_drafts", async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const uid = ctx.from?.id;
    if (uid === undefined) {
      return;
    }
    await ctx.answerCallbackQuery();
    setClientListMode(ctx, "drafts");
    const list = (await orderStore.listByClient(uid)).filter((o) => o.status === "draft");
    if (!list.length) {
      await ctx.editMessageText(
        "Черновиков нет.",
        {
          reply_markup: new InlineKeyboard()
            .text("➕ Новая заявка", "menu:new_order")
            .text("« Меню", "menu:back"),
        },
      );
      return;
    }
    const myName = await getClientDisplayNameForOrderList(uid);
    const kb = new InlineKeyboard();
    list.slice(0, 20).forEach((o, i) => {
      kb.text(orderListButtonLabel(myName, i, ORDER_STATUS_LABEL[o.status]), `v:${o.id}`).row();
    });
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText(
      "📄 <b>Черновики</b> — не отправлены в работу:",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("menu:client_archive", async (ctx) => {
    if (ctx.session.role !== "client") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    const uid = ctx.from?.id;
    if (uid === undefined) {
      return;
    }
    await ctx.answerCallbackQuery();
    setClientListMode(ctx, "archive");
    const list = (await orderStore.listByClient(uid)).filter((o) => o.status === "done" || o.status === "cancelled");
    if (!list.length) {
      await ctx.editMessageText("Архив пуст.", {
        reply_markup: new InlineKeyboard()
          .text("🔄 Активные", "menu:client_active")
          .text("« Меню", "menu:back"),
      });
      return;
    }
    const myName = await getClientDisplayNameForOrderList(uid);
    const kb = new InlineKeyboard();
    list.slice(0, 20).forEach((o, i) => {
      kb.text(orderListButtonLabel(myName, i, ORDER_STATUS_LABEL[o.status]), `v:${o.id}`).row();
    });
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText(
      "📁 <b>Архив</b> — завершённые и отменённые заявки:",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  /** ——— Работник склада ——— */
  bot.callbackQuery("menu:packer_orders", async (ctx) => {
    if (ctx.session.role !== "packer") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    ctx.session.packerListSource = "active";
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
        reply_markup: new InlineKeyboard()
          .text("📁 Архив выполненных", "menu:packer_archive")
          .row()
          .text("« Меню", "menu:back"),
      });
      return;
    }
    const slice = active.slice(0, 20);
    const names = await getBusinessNamesForTelegramIds(slice.map((o) => o.clientTelegramId));
    const kb = new InlineKeyboard();
    slice.forEach((o, i) => {
      const bn = names.get(o.clientTelegramId) ?? `Клиент ${o.clientTelegramId}`;
      kb.text(orderListButtonLabel(bn, i, ORDER_STATUS_LABEL[o.status]), `v:${o.id}`).row();
    });
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("📦 <b>Заявки</b>", { parse_mode: "HTML", reply_markup: kb });
  });

  bot.callbackQuery("menu:packer_archive", async (ctx) => {
    if (ctx.session.role !== "packer") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    ctx.session.packerListSource = "archive";
    await ctx.answerCallbackQuery();
    const done = sortOrdersByUpdatedDesc(
      (await orderStore.list()).filter((o) => o.status === "done"),
    ).slice(0, 20);
    if (!done.length) {
      await ctx.editMessageText("В архиве пока нет выполненных заявок.", {
        reply_markup: new InlineKeyboard()
          .text("📦 Заявки", "menu:packer_orders")
          .row()
          .text("« Меню", "menu:back"),
      });
      return;
    }
    const names = await getBusinessNamesForTelegramIds(done.map((o) => o.clientTelegramId));
    const kb = new InlineKeyboard();
    done.forEach((o, i) => {
      const bn = names.get(o.clientTelegramId) ?? `Клиент ${o.clientTelegramId}`;
      kb.text(orderListButtonLabel(bn, i, ORDER_STATUS_LABEL[o.status]), `v:${o.id}`).row();
    });
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("📁 <b>Архив — выполненные заявки</b>", {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  /** ——— Менеджер / управляющий ——— */
  bot.callbackQuery("menu:all_orders", async (ctx) => {
    if (!ctx.session.role || !isManagerLikeRole(ctx.session.role)) {
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
    const slice = list.slice(0, 20);
    const names = await getBusinessNamesForTelegramIds(slice.map((o) => o.clientTelegramId));
    const kb = new InlineKeyboard();
    slice.forEach((o, i) => {
      const bn = names.get(o.clientTelegramId) ?? `Клиент ${o.clientTelegramId}`;
      kb.text(orderListButtonLabel(bn, i, ORDER_STATUS_LABEL[o.status]), `v:${o.id}`).row();
    });
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("Все заявки:", { reply_markup: kb });
  });

  bot.callbackQuery("menu:report", async (ctx) => {
    if (!ctx.session.role || !isManagerLikeRole(ctx.session.role)) {
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
    ctx.session.driverListSource = "active";
    await ctx.answerCallbackQuery();
    const list = (await orderStore.list()).filter(
      (o) =>
        o.driverUnloadPending ||
        o.status === "ready_for_unload" ||
        o.status === "in_transit",
    );
    if (!list.length) {
      await ctx.editMessageText("Нет активных заявок.", {
        reply_markup: new InlineKeyboard()
          .text("📁 Архив выполненных", "menu:driver_archive")
          .row()
          .text("« Меню", "menu:back"),
      });
      return;
    }
    const slice = sortOrdersByUpdatedDesc(list).slice(0, 20);
    const names = await getBusinessNamesForTelegramIds(slice.map((o) => o.clientTelegramId));
    const kb = new InlineKeyboard();
    slice.forEach((o, i) => {
      const bn = names.get(o.clientTelegramId) ?? `Клиент ${o.clientTelegramId}`;
      const tag = o.driverUnloadPending ? "⏳ подтвердить" : ORDER_STATUS_LABEL[o.status];
      kb.text(orderListButtonLabel(bn, i, tag), `vd:${o.id}`).row();
    });
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("🚚 <b>Заявки</b>", { parse_mode: "HTML", reply_markup: kb });
  });

  bot.callbackQuery("menu:driver_archive", async (ctx) => {
    if (ctx.session.role !== "driver") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }
    ctx.session.driverListSource = "archive";
    await ctx.answerCallbackQuery();
    const done = sortOrdersByUpdatedDesc(
      (await orderStore.list()).filter((o) => o.status === "done"),
    ).slice(0, 20);
    if (!done.length) {
      await ctx.editMessageText("В архиве пока нет выполненных заявок.", {
        reply_markup: new InlineKeyboard()
          .text("🚚 Заявки", "menu:driver_orders")
          .row()
          .text("« Меню", "menu:back"),
      });
      return;
    }
    const names = await getBusinessNamesForTelegramIds(done.map((o) => o.clientTelegramId));
    const kb = new InlineKeyboard();
    done.forEach((o, i) => {
      const bn = names.get(o.clientTelegramId) ?? `Клиент ${o.clientTelegramId}`;
      kb.text(orderListButtonLabel(bn, i, ORDER_STATUS_LABEL[o.status]), `vd:${o.id}`).row();
    });
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText("📁 <b>Архив — выполненные заявки</b>", {
      parse_mode: "HTML",
      reply_markup: kb,
    });
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
    await ctx.editMessageText(
      `<b>Водитель — заявка №${id}</b>\n\n` + formatOrderHtml(o),
      { parse_mode: "HTML", reply_markup: driverOrderDetailKeyboard(ctx, id, o) },
    );
  });

  /** Работник склада / водитель: действия по заявке */
  bot.callbackQuery(/^o:(\d+):(pkr|drv|dvc|dvc_date|dvc_date_edit|dvt|dvf)$/, async (ctx) => {
    const id = ctx.match[1];
    const act = ctx.match[2];
    const o = await orderStore.get(id);
    if (!o) {
      await ctx.answerCallbackQuery({ text: "Не найдено" });
      return;
    }

    if (act === "pkr") {
      if (ctx.session.role !== "packer") {
        await ctx.answerCallbackQuery({ text: "Только работник склада" });
        return;
      }
      if (o.status === "prep_unload" && o.driverUnloadPending) {
        await ctx.answerCallbackQuery({ text: "Ждём подтверждения водителя" });
        return;
      }

      const handoffToDriver =
        o.status === "pack_sort" || (o.status === "prep_unload" && !o.driverUnloadPending);

      if (handoffToDriver) {
        await orderStore.update(id, { driverUnloadPending: false });
        const updated = await orderStore.setStatus(id, "ready_for_unload");
        if (updated) {
          await notifyDriversWarehouseHandoff(ctx.api, updated, ROLE_WHITELIST.driver);
        }
        await ctx.answerCallbackQuery({ text: "Передано водителю" });
        const after = await orderStore.get(id);
        await ctx.editMessageText(
          `✅ Заявка №${id} передана водителю. У вас она снята со списка.\n\n` + formatOrderHtml(after!),
          {
            parse_mode: "HTML",
            reply_markup: packerOrderDetailKeyboard(ctx, id, after!),
          },
        );
        return;
      }

      const nextSt = PACKER_WAREHOUSE_LINEAR[o.status];
      if (!nextSt) {
        await ctx.answerCallbackQuery({ text: "Недоступно для этого статуса" });
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
        {
          parse_mode: "HTML",
          reply_markup: packerOrderDetailKeyboard(ctx, id, afterStatus!),
        },
      );
      return;
    }

    if (act === "drv") {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
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
      await orderStore.setStatus(id, "ready_for_unload");
      await ctx.answerCallbackQuery({ text: "Подтверждено" });
      const afterDvc = await orderStore.get(id);
      await ctx.editMessageText(
        `<b>Водитель — заявка №${id}</b>\n\n` + formatOrderHtml(afterDvc!),
        {
          parse_mode: "HTML",
          reply_markup: driverOrderDetailKeyboard(ctx, id, afterDvc!),
        },
      );
      return;
    }

    if (act === "dvc_date") {
      if (ctx.session.role !== "driver") {
        await ctx.answerCallbackQuery({ text: "Только водитель" });
        return;
      }
      if (o.status !== "prep_unload" || o.approvedDeliveryDate) {
        await ctx.answerCallbackQuery({ text: "Недоступно" });
        return;
      }
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `📅 <b>Заявка №${id}</b>\n\nУкажите дату рейса одним сообщением (например: <code>15.04.2026</code>).`,
        {
          parse_mode: "HTML",
          reply_markup: kbCancelOnly(),
        },
      );
      ctx.session.dvcDateOrderId = id;
      return;
    }

    if (act === "dvc_date_edit") {
      if (ctx.session.role !== "driver") {
        await ctx.answerCallbackQuery({ text: "Только водитель" });
        return;
      }
      if (o.status !== "ready_for_unload") {
        await ctx.answerCallbackQuery({ text: "Неверный статус" });
        return;
      }
      await ctx.answerCallbackQuery();
      const currentDate = o.approvedDeliveryDate ? `<b>Текущая дата:</b> ${o.approvedDeliveryDate}\n\n` : "";
      await ctx.reply(
        `📅 <b>Заявка №${id}</b>\n\n${currentDate}Укажите новую дату рейса одним сообщением (например: <code>15.04.2026</code>).`,
        {
          parse_mode: "HTML",
          reply_markup: kbCancelOnly(),
        },
      );
      ctx.session.dvcDateOrderId = id;
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
        `<b>Водитель — заявка №${id}</b>\n\n` + formatOrderHtml(afterDvt!),
        {
          parse_mode: "HTML",
          reply_markup: driverOrderDetailKeyboard(ctx, id, afterDvt!),
        },
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
      const afterDvf = await orderStore.get(id);
      await ctx.editMessageText(
        `<b>Водитель — заявка №${id}</b>\n\n` + formatOrderHtml(afterDvf!),
        {
          parse_mode: "HTML",
          reply_markup: driverOrderDetailKeyboard(ctx, id, afterDvf!),
        },
      );
      return;
    }
  });

  /** Просмотр заявки (клиент / работник склада / менеджер / управляющий) */
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
    if (role === "client") {
      if (o.status === "draft") {
        kb.text("📤 Отправить в работу", `o:${id}:send`).row();
        kb.text("🗑 Удалить черновик", `o:${id}:deldraft`).row();
      }
    }
    if (role === "packer") {
      await ctx.editMessageText(formatOrderHtml(o), {
        parse_mode: "HTML",
        reply_markup: packerOrderDetailKeyboard(ctx, id, o),
      });
      return;
    }
    const listCb = role === "client" ? clientOrdersListCallback(ctx) : ordersListCallback(role);
    kb.text("« К списку", listCb).row();
    kb.text("« Меню", "menu:back");
    await ctx.editMessageText(formatOrderHtml(o), {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^noop:/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Ожидаем водителя" });
  });

  /** Подтверждение телефона через контакт (не SMS). */
  bot.on("message:contact", async (ctx) => {
    const uid = ctx.from?.id;
    const contact = ctx.message.contact;
    if (uid === undefined || !contact) {
      return;
    }
    if (ctx.session.role !== "client") {
      return;
    }
    if (contact.user_id !== undefined && contact.user_id !== uid) {
      await ctx.reply(
        "Нужен <b>ваш</b> номер: нажмите «Отправить мой номер» под полем ввода, не пересылайте чужой контакт.",
        { parse_mode: "HTML" },
      );
      return;
    }
    if (await needsPhoneVerification(uid)) {
      await setClientPhone(uid, contact.phone_number);
      await ctx.reply("✅ Номер телефона подтверждён.", {
        reply_markup: { remove_keyboard: true },
      });
      await sendBusinessNamePrompt(ctx);
      return;
    }
    if (await isClientRegistered(uid)) {
      await ctx.reply("Номер уже был подтверждён ранее.", {
        reply_markup: { remove_keyboard: true },
      });
      await sendMainMenu(ctx, "client");
      return;
    }
    if (await needsBusinessName(uid)) {
      await ctx.reply("Сначала введите название ИП или магазина одним текстовым сообщением.");
      return;
    }
  });

  /** Текстовые шаги черновика */
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const uidText = ctx.from?.id;
    if (
      ctx.session.role === "client" &&
      uidText !== undefined &&
      ctx.session.editingBusinessName &&
      (text === "Меню" || text === "« Меню")
    ) {
      ctx.session.editingBusinessName = undefined;
      await sendMainMenu(ctx, "client");
      try {
        await ctx.deleteMessage();
      } catch {
        // ignore
      }
      return;
    }
    if (
      ctx.session.role === "client" &&
      uidText !== undefined &&
      ctx.session.editingBusinessName &&
      !(await isClientRegistered(uidText))
    ) {
      ctx.session.editingBusinessName = undefined;
      await sendMainMenu(ctx, "client");
      return;
    }
    if (
      ctx.session.role === "client" &&
      uidText !== undefined &&
      ctx.session.editingBusinessName &&
      (await isClientRegistered(uidText))
    ) {
      if (text.length < 2) {
        await ctx.reply("Название слишком короткое — минимум 2 символа.");
        return;
      }
      if (text.length > 200) {
        await ctx.reply("Сократите название до 200 символов.");
        return;
      }
      await setClientBusinessName(uidText, text);
      ctx.session.editingBusinessName = undefined;
      await sendMainMenu(ctx, "client", { clientBusinessNameUpdated: true });
      return;
    }
    if (ctx.session.role === "client" && uidText !== undefined && (await needsBusinessName(uidText))) {
      if (text.length < 2) {
        await ctx.reply("Название слишком короткое — минимум 2 символа.");
        return;
      }
      if (text.length > 200) {
        await ctx.reply("Сократите название до 200 символов.");
        return;
      }
      await setClientBusinessName(uidText, text);
      await sendMainMenu(ctx, "client", { clientRegistrationComplete: true });
      return;
    }
    if (
      ctx.session.role === "client" &&
      uidText !== undefined &&
      (await needsPhoneVerification(uidText))
    ) {
      await ctx.reply(
        "Чтобы подтвердить номер, нажмите кнопку <b>«Отправить мой номер»</b> под полем ввода (не пишите номер текстом).",
        { parse_mode: "HTML", reply_markup: phoneRequestKeyboard() },
      );
      return;
    }
    /** Старая reply-клавиатура «Меню»: открываем меню и убираем сообщение из чата. */
    if (ctx.session.role === "client" && (text === "Меню" || text === "« Меню")) {
      ctx.session.orderDraft = undefined;
      ctx.session.editingBusinessName = undefined;
      await sendMainMenu(ctx, "client");
      try {
        await ctx.deleteMessage();
      } catch {
        // ignore
      }
      return;
    }

    /** Водитель вводит дату рейса */
    if (ctx.session.role === "driver" && ctx.session.dvcDateOrderId) {
      const orderId = ctx.session.dvcDateOrderId;
      if (text === "Меню" || text === "« Меню") {
        ctx.session.dvcDateOrderId = undefined;
        await sendMainMenu(ctx, "driver");
        try {
          await ctx.deleteMessage();
        } catch {
          // ignore
        }
        return;
      }
      if (text.length > 200) {
        await ctx.reply("Укажите дату не длиннее 200 символов.");
        return;
      }
      const dateText = text.trim();
      ctx.session.dvcDateOrderId = undefined;
      const updated = await orderStore.setApprovedDeliveryDate(orderId, dateText);
      if (!updated) {
        await ctx.reply("Ошибка при сохранении.");
        return;
      }
      await ctx.reply("✅ Дата утверждена!", {
        reply_markup: { remove_keyboard: true },
      });
      const role = ctx.session.role;
      if (role === "driver") {
        const list = await orderStore.list();
        const ready = list.filter((o) => o.status === "ready_for_unload");
        if (ready.length > 0) {
          const bn = await getClientDisplayNameForOrderList(ready[0].clientTelegramId);
          const kb = new InlineKeyboard();
          ready.slice(0, 20).forEach((o, i) => {
            kb.text(orderListButtonLabel(bn, i, ORDER_STATUS_LABEL[o.status]), `v:${o.id}`).row();
          });
          kb.text("📁 Архив", "menu:driver_archive").row();
          kb.text("« Меню", "menu:back");
          await ctx.reply("🚚 <b>Заявки</b>", {
            parse_mode: "HTML",
            reply_markup: kb,
          });
        } else {
          await sendMainMenu(ctx, "driver");
        }
      }
      await notifyApprovedDeliveryDate(ctx.api, updated, ROLE_WHITELIST.manager, ROLE_WHITELIST.supervisor);
      return;
    }

    const d = ctx.session.orderDraft;
    const role = ctx.session.role;

    if (d?.step === "proxy_client_id" && role && isManagerLikeRole(role)) {
      const raw = text.replace(/\s/g, "");
      const id = Number.parseInt(raw, 10);
      if (!Number.isFinite(id) || id <= 0) {
        await ctx.reply("Укажите числовой Telegram user id (например 123456789).");
        return;
      }
      d.proxyClientTelegramId = id;
      d.step = "product";
      const cap = await proxyTargetClientCaptionHtml(id);
      await ctx.reply(
        `📝 <b>Шаг 1/7</b>${cap}\n\nКакой у клиента товар?\n\nНапишите одним сообщением.`,
        { parse_mode: "HTML", reply_markup: kbCancelOnly() },
      );
      return;
    }

    if (!d || !canUseOrderDraft(ctx)) {
      return;
    }

    if (d.step === "product") {
      if (!text) {
        return;
      }
      d.product = text;
      d.step = "quantity";
      await ctx.reply("📝 <b>Шаг 2/7</b>\nКоличество товара (в единицах измерения):", {
        parse_mode: "HTML",
        reply_markup: kbBackCancel(),
      });
      return;
    }
    if (d.step === "quantity") {
      if (!text) {
        return;
      }
      d.quantityText = text;
      d.step = "tz";
      await ctx.reply("📝 <b>Шаг 3/7</b>\nТЗ (техническое задание / условия):", {
        parse_mode: "HTML",
        reply_markup: kbBackCancel(),
      });
      return;
    }
    if (d.step === "tz") {
      if (!text) {
        return;
      }
      d.tz = text;
      d.step = "pickup_decision";
      await ctx.reply(
        "📝 <b>Шаг 4/7</b>\nНужен ли <b>забор товара</b> (со своей точки)?",
        {
          parse_mode: "HTML",
          reply_markup: kbPickupDecision(),
        },
      );
      return;
    }
    if (d.step === "pick_address") {
      if (!text) {
        return;
      }
      d.pickupPoints.push({ addressText: text });
      d.step = "pick_after_point";
      await ctx.reply(MSG_AFTER_PICKUP_ADDED, {
        parse_mode: "HTML",
        reply_markup: kbPickAfterPoint(),
      });
      return;
    }
    if (d.step === "desired_delivery_date") {
      if (!text) {
        return;
      }
      if (text.length > 200) {
        await ctx.reply("Укажите дату не длиннее 200 символов.");
        return;
      }
      d.desiredDeliveryDate = text;
      d.step = "comment";
      const kb = new InlineKeyboard()
        .text("Пропустить комментарий", "skip:comment")
        .row()
        .text("« Назад", "draft:nav_back")
        .row()
        .text("« Отмена", "menu:back");
      await ctx.reply(
        "💬 <b>Шаг 7/7</b>\nКомментарий (при необходимости).\n\nИли нажмите «Пропустить».",
        { parse_mode: "HTML", reply_markup: kb },
      );
      return;
    }
    if (d.step === "comment") {
      d.comment = text;
      d.step = "confirm";
      await ctx.reply(
        `${formatDraftSummaryHtml(d)}\n\nПодтвердите создание черновика заявки.`,
        { parse_mode: "HTML", reply_markup: kbConfirmDraft() },
      );
      return;
    }
  });

  void bot.api
    .setMyCommands([
      { command: "start", description: "Начать / главное меню" },
      { command: "menu", description: "Главное меню" },
      { command: "cancel", description: "Сбросить черновик заявки" },
    ])
    .catch((e) => console.error("setMyCommands", e));

  bot.catch((err) => {
    console.error("bot error", err);
  });
};
