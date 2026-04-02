// Telegram Mini App — синхронизируйте списки складов с src/config/warehouses.ts
const tg = window.Telegram.WebApp;

tg.ready();
tg.expand();

const isDark = tg.colorScheme === "dark";

const themeColors = {
  light: {
    bg: "#ffffff",
    text: "#000000",
    secondary: "#757575",
    border: "#e0e0e0",
    primary: "#0088cc",
    success: "#31a24c",
    error: "#d74545",
    inputBg: "#f5f5f5",
  },
  dark: {
    bg: "#1a1a1a",
    text: "#ffffff",
    secondary: "#b0b0b0",
    border: "#333333",
    primary: "#0088cc",
    success: "#31a24c",
    error: "#d74545",
    inputBg: "#2a2a2a",
  },
};

const colors = isDark ? themeColors.dark : themeColors.light;

document.documentElement.style.setProperty("--bg-color", colors.bg);
document.documentElement.style.setProperty("--text-color", colors.text);
document.documentElement.style.setProperty("--secondary-color", colors.secondary);
document.documentElement.style.setProperty("--border-color", colors.border);
document.documentElement.style.setProperty("--primary-color", colors.primary);
document.documentElement.style.setProperty("--success-color", colors.success);
document.documentElement.style.setProperty("--error-color", colors.error);
document.documentElement.style.setProperty("--input-bg", colors.inputBg);

/** Склады WB / Ozon (как в warehouses.ts) */
const WB_WAREHOUSES = [
  { id: "wb_koledino", label: "Коледино", note: "Подольск" },
  { id: "wb_elektrostal", label: "Электросталь", note: "Московская обл." },
  { id: "wb_ryazan", label: "Рязань", note: "Рязанская обл." },
  { id: "wb_tula", label: "Тула (Алексин)", note: "Тульская обл." },
  { id: "wb_podolsk_4", label: "Подольск-4", note: "Московская обл." },
  { id: "wb_obukhovo", label: "Обухово", note: "Московская обл." },
  { id: "wb_kotovsk", label: "Котовск", note: "Тамбовская обл." },
  { id: "wb_chehov", label: "Чехов-1", note: "Московская обл." },
  { id: "wb_belaya_dacha", label: "Белая дача", note: "Московская обл." },
];

const OZON_WAREHOUSES = [
  { id: "ozon_grivno", label: "Гривно", note: "Московская обл." },
  { id: "ozon_domodedovo", label: "Домодедово", note: "Московская обл." },
  { id: "ozon_noginsk", label: "Ногинск", note: "Московская обл." },
  { id: "ozon_pushkino", label: "Пушкино", note: "Московская обл." },
  { id: "ozon_sofino", label: "Софьино", note: "МО" },
  { id: "ozon_zhukovskiy", label: "Жуковский", note: "Московская обл." },
  { id: "ozon_pavlovskaya", label: "Павловская слобода", note: "Московская обл." },
  { id: "ozon_petrovskoe", label: "Петровское", note: "Московская обл." },
  { id: "ozon_khoruzhino", label: "Хорухино", note: "Московская обл." },
  { id: "ozon_radumlja", label: "Радумля", note: "Московская обл." },
];

const warehousesForMarketplace = (m) => (m === "wb" ? WB_WAREHOUSES : m === "ozon" ? OZON_WAREHOUSES : []);

const formState = {
  step: "main",
  orderData: {
    product: "",
    quantity: "",
    tz: "",
    needsPickup: false,
    marketplace: "",
    warehouseId: "",
    pickupAddresses: [""],
    desiredDeliveryDate: "",
    comment: "",
  },
  errors: {},
  profileCanSwitchRole: false,
  currentRole: "client",
  selectedRoleForSwitch: null,
  registered: true,
  registrationStep: "done",
};

const initDataUnsafe = tg.initDataUnsafe;
const userId = initDataUnsafe?.user?.id ?? "unknown";
const userName = initDataUnsafe?.user?.first_name ?? "Пользователь";

const app = document.getElementById("app");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateFromIso(isoDate) {
  if (!isoDate || typeof isoDate !== "string" || !isoDate.includes("-")) {
    return "";
  }
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) {
    return "";
  }
  return `${day}.${month}.${year}`;
}

function formatDateToIso(displayDate) {
  if (!displayDate || typeof displayDate !== "string" || !displayDate.includes(".")) {
    return "";
  }
  const [day, month, year] = displayDate.split(".");
  if (!year || !month || !day) {
    return "";
  }
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function renderPickupRows() {
  const rows = formState.orderData.pickupAddresses;
  return rows
    .map(
      (addr, i) => `
    <div class="pickup-row" data-idx="${i}">
      <label>Адрес забора ${i + 1} *</label>
      <input type="text" class="pickup-input" data-idx="${i}" placeholder="Адрес, ориентир, как добраться"
        value="${escapeHtml(addr)}" />
      ${rows.length > 1 ? `<button type="button" class="btn-text-remove" data-remove="${i}">Удалить</button>` : ""}
    </div>`,
    )
    .join("");
}

function bindPickupInputs() {
  document.querySelectorAll(".pickup-input").forEach((el) => {
    el.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.idx);
      formState.orderData.pickupAddresses[i] = e.target.value;
      if (formState.errors.pickupAddresses) delete formState.errors.pickupAddresses;
    });
  });
  document.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const el = e.target.closest("[data-remove]");
      const i = Number(el?.dataset?.remove);
      if (Number.isNaN(i)) return;
      formState.orderData.pickupAddresses.splice(i, 1);
      if (formState.orderData.pickupAddresses.length === 0) {
        formState.orderData.pickupAddresses = [""];
      }
      renderNewOrder();
    });
  });
}

function renderMain() {
  app.innerHTML = `
    <div class="container">
      <div class="header">
        <h1>Мурла 📦</h1>
        <p class="subtitle">Управление заявками</p>
      </div>
      <div class="menu">
        <button class="menu-btn" type="button" id="btn-new-order">
          <span class="menu-icon">➕</span>
          <span class="menu-text">Новая заявка</span>
        </button>
        <button class="menu-btn" type="button" id="btn-order-list">
          <span class="menu-icon">📋</span>
          <span class="menu-text">Мои заявки</span>
        </button>
        <button class="menu-btn" type="button" id="btn-profile">
          <span class="menu-icon">👤</span>
          <span class="menu-text">Профиль</span>
        </button>
      </div>
      <div class="info-block">
        <p class="info-text">Привет, <strong>${escapeHtml(userName)}</strong>!</p>
        <p class="info-text small">Ваш ID: ${userId}</p>
      </div>
    </div>`;
  formState.step = "main";
  document.getElementById("btn-new-order").onclick = () => checkRegistrationAndProceed();
  document.getElementById("btn-order-list").onclick = () => goToOrderList();
  document.getElementById("btn-profile").onclick = () => goToProfile();
  updateButtonState();
}

function renderNewOrder() {
  const d = formState.orderData;
  const err = formState.errors;
  const m = d.marketplace;
  const whList = warehousesForMarketplace(m);
  const whOpts = whList
    .map(
      (w) => {
        const isWb = m === "wb";
        const className = isWb ? "warehouse-option wb-warehouse" : "warehouse-option ozon-warehouse";
        return `<option value="${escapeHtml(w.id)}" ${d.warehouseId === w.id ? "selected" : ""} class="${className}">${escapeHtml(w.label)}${
          w.note ? " — " + escapeHtml(w.note) : ""
        }</option>`;
      },
    )
    .join("");

  app.innerHTML = `
    <div class="container">
      <div class="header">
        <button class="back-btn" type="button" id="back-from-order">← Назад</button>
        <h2>Новая заявка</h2>
      </div>
      <form class="form" id="order-form">
        <div class="form-group">
          <label>Товар *</label>
          <input type="text" name="product" placeholder="Например: куртка красная XL"
            value="${escapeHtml(d.product)}" class="${err.product ? "input-error" : ""}" />
          ${err.product ? `<span class="error-text">${escapeHtml(err.product)}</span>` : ""}
        </div>
        <div class="form-group">
          <label>Количество *</label>
          <input type="text" name="quantity" placeholder="Например: 10 шт"
            value="${escapeHtml(d.quantity)}" class="${err.quantity ? "input-error" : ""}" />
          ${err.quantity ? `<span class="error-text">${escapeHtml(err.quantity)}</span>` : ""}
        </div>
        <div class="form-group">
          <label>ТЗ (условия) *</label>
          <textarea name="tz" placeholder="Техническое задание, размеры, особенности..."
            class="${err.tz ? "input-error" : ""}">${escapeHtml(d.tz)}</textarea>
          ${err.tz ? `<span class="error-text">${escapeHtml(err.tz)}</span>` : ""}
        </div>
        <div class="form-group">
          <label>Нужен забор товара?</label>
          <label class="checkbox-label">
            <input type="checkbox" name="needsPickup" ${d.needsPickup ? "checked" : ""} />
            Да, со своей точки
          </label>
        </div>
        <div class="form-group pickup-block" style="${d.needsPickup ? "" : "display:none;"}">
          <label>Точки забора</label>
          ${renderPickupRows()}
          <button type="button" class="btn btn-secondary btn-small" id="add-pickup">+ Ещё адрес</button>
          ${err.pickupAddresses ? `<span class="error-text">${escapeHtml(err.pickupAddresses)}</span>` : ""}
        </div>
        <div class="form-group">
          <label>Маркетплейс *</label>
          <select name="marketplace" class="${err.marketplace ? "input-error" : ""}">
            <option value="">Выберите</option>
            <option value="wb" ${m === "wb" ? "selected" : ""}>Wildberries</option>
            <option value="ozon" ${m === "ozon" ? "selected" : ""}>Ozon</option>
          </select>
          ${err.marketplace ? `<span class="error-text">${escapeHtml(err.marketplace)}</span>` : ""}
        </div>
        <div class="form-group" style="${m ? "" : "display:none;"}">
          <label>Склад назначения *</label>
          <select name="warehouseId" class="${err.warehouseId ? "input-error" : ""}">
            <option value="">Выберите склад</option>
            ${whOpts}
          </select>
          ${err.warehouseId ? `<span class="error-text">${escapeHtml(err.warehouseId)}</span>` : ""}
        </div>
        <div class="form-group">
          <label>Желаемая дата поставки (диапазон)</label>
          <div class="date-range-container">
            <input type="date" id="date-start-picker" class="date-range-input" />
            <span class="date-range-separator">—</span>
            <input type="date" id="date-end-picker" class="date-range-input" />
            <button type="button" class="btn btn-secondary btn-small" id="clear-dates">Очистить</button>
          </div>
          <p class="info-text small date-range-hint" id="date-range-preview">
            ${d.desiredDeliveryDate ? `Выбрано: ${escapeHtml(d.desiredDeliveryDate)}` : "Дата не выбрана"}
          </p>
        </div>
        <div class="form-group">
          <label>Комментарий</label>
          <textarea name="comment" placeholder="Дополнительная информация...">${escapeHtml(d.comment)}</textarea>
        </div>
        <button type="submit" class="btn btn-primary">Создать заявку</button>
      </form>
    </div>`;

  formState.step = "new-order";
  document.getElementById("back-from-order").onclick = () => goToMain();

  const form = document.getElementById("order-form");
  const pickupBlock = form.querySelector(".pickup-block");
  const whGroup = form.querySelector('[name="warehouseId"]')?.closest(".form-group");

  form.querySelector('[name="needsPickup"]').addEventListener("change", (e) => {
    formState.orderData.needsPickup = e.target.checked;
    if (e.target.checked && formState.orderData.pickupAddresses.length === 0) {
      formState.orderData.pickupAddresses = [""];
    }
    renderNewOrder();
  });

  form.querySelector('[name="marketplace"]').addEventListener("change", (e) => {
    formState.orderData.marketplace = e.target.value;
    formState.orderData.warehouseId = "";
    renderNewOrder();
  });

  form.addEventListener("input", (e) => {
    const t = e.target;
    if (t.name === "product") formState.orderData.product = t.value;
    if (t.name === "quantity") formState.orderData.quantity = t.value;
    if (t.name === "tz") formState.orderData.tz = t.value;
    if (t.name === "comment") formState.orderData.comment = t.value;
    if (t.name === "warehouseId") formState.orderData.warehouseId = t.value;
  });

  const dateStartInput = document.getElementById("date-start-picker");
  const dateEndInput = document.getElementById("date-end-picker");
  const datePreview = document.getElementById("date-range-preview");

  const storedDate = formState.orderData.desiredDeliveryDate;
  if (storedDate.includes(" - ")) {
    const [startDisplay, endDisplay] = storedDate.split(" - ");
    if (dateStartInput) dateStartInput.value = formatDateToIso(startDisplay.trim());
    if (dateEndInput) dateEndInput.value = formatDateToIso(endDisplay.trim());
  } else if (storedDate) {
    if (dateStartInput) dateStartInput.value = formatDateToIso(storedDate.trim());
  }

  const syncDatePreview = () => {
    if (!dateStartInput) {
      return;
    }
    const start = dateStartInput.value ? formatDateFromIso(dateStartInput.value) : "";
    const end = dateEndInput && dateEndInput.value ? formatDateFromIso(dateEndInput.value) : "";

    if (!start) {
      formState.orderData.desiredDeliveryDate = "";
      if (datePreview) datePreview.textContent = "Дата не выбрана";
      return;
    }

    if (!end) {
      formState.orderData.desiredDeliveryDate = start;
      if (datePreview) datePreview.textContent = `Выбрано: ${start}`;
      return;
    }

    const startTime = new Date(dateStartInput.value).getTime();
    const endTime = new Date(dateEndInput.value).getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return;
    }

    const normalizedStart = startTime <= endTime ? start : end;
    const normalizedEnd = startTime <= endTime ? end : start;
    formState.orderData.desiredDeliveryDate = `${normalizedStart} - ${normalizedEnd}`;
    if (datePreview) datePreview.textContent = `Выбрано: ${normalizedStart} - ${normalizedEnd}`;
  };

  if (dateStartInput) {
    dateStartInput.addEventListener("change", syncDatePreview);
  }
  if (dateEndInput) {
    dateEndInput.addEventListener("change", syncDatePreview);
  }

  const clearBtn = document.getElementById("clear-dates");
  if (clearBtn) {
    clearBtn.onclick = () => {
      formState.orderData.desiredDeliveryDate = "";
      if (dateStartInput) dateStartInput.value = "";
      if (dateEndInput) dateEndInput.value = "";
      if (datePreview) datePreview.textContent = "Дата не выбрана";
    };
  }

  const addBtn = document.getElementById("add-pickup");
  if (addBtn) {
    addBtn.onclick = () => {
      formState.orderData.pickupAddresses.push("");
      renderNewOrder();
    };
  }
  bindPickupInputs();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitOrder();
  });

  updateButtonState();
}

function renderOrderList() {
  app.innerHTML = `
    <div class="container">
      <div class="header">
        <button class="back-btn" type="button" id="back-from-list">← Назад</button>
        <h2>Мои заявки</h2>
      </div>
      <div class="empty-state">
        <p class="empty-icon">📋</p>
        <p class="empty-text">Список заявок в чате с ботом</p>
        <p class="empty-subtext">Откройте бота и раздел «Все заявки» — здесь скоро появится синхронизация.</p>
        <button class="btn btn-primary" type="button" id="btn-create-from-list">Создать заявку</button>
      </div>
    </div>`;
  formState.step = "order-list";
  document.getElementById("back-from-list").onclick = () => goToMain();
  document.getElementById("btn-create-from-list").onclick = () => goToNewOrder();
  updateButtonState();
}

async function fetchMiniappConfig() {
  const initData = tg.initData;
  if (!initData) {
    return { canSwitchRole: false, currentRole: "client" };
  }
  try {
    // Добавляем timestamp чтобы избежать кеширования
    const timestamp = Date.now();
    const r = await fetch("/api/miniapp-config?initData=" + encodeURIComponent(initData) + "&t=" + timestamp, {
      headers: {
        "Cache-Control": "no-cache",
      },
    });
    if (!r.ok) return { canSwitchRole: false, currentRole: "client" };
    const j = await r.json();
    return {
      canSwitchRole: Boolean(j.canSwitchRole),
      currentRole: j.currentRole || "client",
      registered: j.registered !== false,
      registrationStep: j.registrationStep || "done",
    };
  } catch (err) {
    console.error("fetchMiniappConfig error:", err);
    return { canSwitchRole: false, currentRole: "client", registered: true, registrationStep: "done" };
  }
}

function goToProfile() {
  app.innerHTML = `
    <div class="container">
      <div class="header">
        <button class="back-btn" type="button" id="back-profile-loading">← Назад</button>
        <h2>Профиль</h2>
      </div>
      <p class="info-text">Загрузка…</p>
    </div>`;
  document.getElementById("back-profile-loading").onclick = () => goToMain();
  formState.step = "profile";
  Promise.all([fetchMiniappConfig(), fetchCalendarOrders()]).then(([cfg, orders]) => {
    renderProfileContent(cfg, orders, cfg.currentRole);
  });
  updateButtonState();
}

async function fetchCalendarOrders() {
  try {
    const initData = tg.initData;
    if (!initData) return [];
    const r = await fetch("/api/miniapp-orders?initData=" + encodeURIComponent(initData));
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.orders) ? j.orders : [];
  } catch {
    return [];
  }
}

const ROLES = [
  { id: "client", label: "👤 Клиент" },
  { id: "packer", label: "📦 Работник склада" },
  { id: "driver", label: "🚚 Водитель" },
  { id: "manager", label: "📊 Менеджер" },
  { id: "supervisor", label: "👨‍💼 Управляющий" },
];

function showRoleSelector(currentRole) {
  const rolesHtml = ROLES.map(
    (r) => `
    <button type="button" class="role-option ${currentRole === r.id ? "role-selected" : ""}" data-role="${r.id}">
      ${r.label}
      ${currentRole === r.id ? " ✓" : ""}
    </button>`,
  ).join("");

  app.innerHTML = `
    <div class="container">
      <div class="header">
        <button class="back-btn" type="button" id="back-from-roles">← Назад</button>
        <h2>Выбор роли</h2>
      </div>
      <div class="role-selector">
        <p class="role-info">Выберите роль и нажмите «Подтвердить»</p>
        <div class="roles-list">${rolesHtml}</div>
        <button type="button" class="btn btn-primary" id="confirm-role" style="margin-top: 16px;">Подтвердить</button>
        <button type="button" class="btn btn-secondary" id="cancel-role" style="margin-top: 8px;">Отмена</button>
      </div>
    </div>`;

  formState.step = "role-selector";
  let selectedRole = currentRole;

  document.getElementById("back-from-roles").onclick = () => goToProfile();
  document.getElementById("cancel-role").onclick = () => goToProfile();

  document.querySelectorAll(".role-option").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".role-option").forEach((b) => b.classList.remove("role-selected"));
      btn.classList.add("role-selected");
      selectedRole = btn.dataset.role;
    };
  });

  document.getElementById("confirm-role").onclick = async () => {
    const confirmBtn = document.getElementById("confirm-role");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Подождите…";
    }

    try {
      const r = await fetch("/api/miniapp-switch-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData: tg.initData,
          selectedRole,
        }),
      });
      const j = await r.json();
      if (j.ok) {
        formState.currentRole = selectedRole;
        showNotification("✅ Роль изменена! Смотрите чат бота.");
        setTimeout(() => tg.close(), 1200);
      } else {
        showNotification("❌ " + (j.error === "role_locked" ? "Роль закреплена" : "Ошибка смены роли"));
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "Подтвердить";
        }
      }
    } catch (err) {
      console.error("switch-role error:", err);
      showNotification("❌ Ошибка сети");
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Подтвердить";
      }
    }
  };

  updateButtonState();
}

function renderProfileContent(cfg, orders = [], currentRole = "client") {
  const canSwitch = cfg.canSwitchRole;
  const ordersByDate = {};
  orders.forEach((o) => {
    const d = o.approvedDeliveryDate || o.desiredDeliveryDate || "без даты";
    if (!ordersByDate[d]) ordersByDate[d] = [];
    ordersByDate[d].push(o);
  });

  const datesHtml = Object.keys(ordersByDate)
    .sort()
    .map(
      (date) => `
    <div class="calendar-day">
      <button class="calendar-date" type="button" data-date="${escapeHtml(date)}">
        📅 ${escapeHtml(date)}
        <span class="calendar-count">${ordersByDate[date].length}</span>
      </button>
    </div>`,
    )
    .join("");

  app.innerHTML = `
    <div class="container">
      <div class="header">
        <button class="back-btn" type="button" id="back-from-profile">← Назад</button>
        <h2>Профиль</h2>
      </div>
      <div class="profile-card">
        <div class="avatar">${escapeHtml(userName.charAt(0).toUpperCase())}</div>
        <h3>${escapeHtml(userName)}</h3>
        <p class="profile-id">ID: ${userId}</p>
        <div class="profile-info">
          <div class="info-row">
            <span class="info-label">Текущая роль:</span>
            <span class="info-value">${ROLES.find((r) => r.id === currentRole)?.label || currentRole}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Статус:</span>
            <span class="info-value">Активен</span>
          </div>
        </div>
        ${
          canSwitch
            ? `<button type="button" class="btn btn-primary" id="btn-switch-role">Сменить роль</button>`
            : ""
        }
        <button type="button" class="btn btn-secondary" id="btn-close-app">Закрыть</button>
      </div>

      ${
        orders.length > 0
          ? `
      <div class="calendar-section">
        <h3>📅 Рейсы по датам</h3>
        <div class="calendar-list">${datesHtml}</div>
      </div>
      <div id="date-details" class="date-details" style="display:none;"></div>
      `
          : ""
      }
    </div>`;

  formState.step = "profile";
  formState.profileCanSwitchRole = canSwitch;
  formState.currentRole = currentRole;
  document.getElementById("back-from-profile").onclick = () => goToMain();
  const closeBtn = document.getElementById("btn-close-app");
  if (closeBtn) closeBtn.onclick = () => tg.close();
  const switchBtn = document.getElementById("btn-switch-role");
  if (switchBtn) {
    switchBtn.onclick = () => {
      showRoleSelector(currentRole);
    };
  }

  document.querySelectorAll(".calendar-date").forEach((btn) => {
    btn.onclick = () => {
      const date = btn.dataset.date;
      const ordersForDate = ordersByDate[date] || [];
      const detailsDiv = document.getElementById("date-details");
      if (!detailsDiv) return;
      const itemsHtml = ordersForDate
        .map(
          (o) => `
        <div class="order-item">
          <div class="order-header">
            <strong>Заявка №${o.id}</strong>
            <span class="order-status">${o.status}</span>
          </div>
          <div class="order-info">
            <p><strong>ИП:</strong> ${escapeHtml(o.businessName || "—")}</p>
            <p><strong>Товар:</strong> ${escapeHtml(o.product)}</p>
            <p><strong>Кол:</strong> ${escapeHtml(o.quantityText)}</p>
            ${o.approvedDeliveryDate ? `<p><strong>Дата рейса:</strong> ${escapeHtml(o.approvedDeliveryDate)}</p>` : ""}
            ${o.desiredDeliveryDate ? `<p><strong>Желаемая дата:</strong> ${escapeHtml(o.desiredDeliveryDate)}</p>` : ""}
          </div>
        </div>`,
        )
        .join("");
      detailsDiv.innerHTML = `
        <div class="details-header">
          <button type="button" class="back-btn" id="back-from-details">← К рейсам</button>
          <h3>${escapeHtml(date)}</h3>
        </div>
        <div class="orders-list">${itemsHtml}</div>`;
      detailsDiv.style.display = "block";
      document.getElementById("back-from-details").onclick = () => {
        detailsDiv.style.display = "none";
      };
    };
  });

  updateButtonState();
}

function renderRegistration(step) {
  formState.step = "registration";

  if (step === "consent") {
    app.innerHTML = `
      <div class="container">
        <div class="header">
          <button class="back-btn" type="button" id="back-from-reg">← Назад</button>
          <h2>Регистрация</h2>
        </div>
        <div class="reg-card">
          <div class="reg-step-indicator">Шаг 1 из 3</div>
          <div class="reg-icon">📋</div>
          <h3>Согласие с условиями</h3>
          <p class="reg-text">
            Для работы с заявками подтвердите согласие с условиями обслуживания и получения уведомлений в Telegram.
          </p>
          <button type="button" class="btn btn-primary" id="reg-accept">✅ Согласен с условиями</button>
        </div>
      </div>`;
    document.getElementById("back-from-reg").onclick = () => goToMain();
    document.getElementById("reg-accept").onclick = async () => {
      const btn = document.getElementById("reg-accept");
      if (btn) { btn.disabled = true; btn.textContent = "Подождите…"; }
      try {
        const r = await fetch("/api/miniapp-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: tg.initData, step: "consent" }),
        });
        const j = await r.json();
        if (j.ok) {
          formState.registrationStep = j.nextStep;
          renderRegistration(j.nextStep);
        } else {
          showNotification("❌ Ошибка");
          if (btn) { btn.disabled = false; btn.textContent = "✅ Согласен с условиями"; }
        }
      } catch {
        showNotification("❌ Ошибка сети");
        if (btn) { btn.disabled = false; btn.textContent = "✅ Согласен с условиями"; }
      }
    };
    updateButtonState();
    return;
  }

  if (step === "phone") {
    app.innerHTML = `
      <div class="container">
        <div class="header">
          <button class="back-btn" type="button" id="back-from-reg">← Назад</button>
          <h2>Регистрация</h2>
        </div>
        <div class="reg-card">
          <div class="reg-step-indicator">Шаг 2 из 3</div>
          <div class="reg-icon">📱</div>
          <h3>Подтверждение телефона</h3>
          <p class="reg-text">
            Номер нужен для связи по заявкам. Нажмите кнопку — Telegram передаст номер автоматически.
          </p>
          <button type="button" class="btn btn-primary" id="reg-phone-tg">📱 Отправить номер через Telegram</button>
          <p class="reg-text small" style="margin-top:12px;">Или введите вручную:</p>
          <div class="form-group" style="margin-top:8px;">
            <input type="tel" id="reg-phone-input" placeholder="+7 999 123 45 67" class="reg-input" />
            <button type="button" class="btn btn-secondary btn-small" id="reg-phone-manual" style="margin-top:8px;">Отправить</button>
          </div>
        </div>
      </div>`;
    document.getElementById("back-from-reg").onclick = () => goToMain();

    document.getElementById("reg-phone-tg").onclick = () => {
      if (typeof tg.requestContact === "function") {
        tg.requestContact((sent, event) => {
          if (sent && event?.responseUnsafe?.contact?.phone_number) {
            submitPhone(event.responseUnsafe.contact.phone_number);
          } else if (sent) {
            showNotification("Номер не получен. Введите вручную.");
          }
        });
      } else {
        showNotification("Кнопка недоступна. Введите номер вручную.");
      }
    };

    document.getElementById("reg-phone-manual").onclick = () => {
      const val = document.getElementById("reg-phone-input").value.trim();
      if (!val || val.length < 6) {
        showNotification("Введите корректный номер телефона");
        return;
      }
      submitPhone(val);
    };
    updateButtonState();
    return;
  }

  if (step === "business_name") {
    app.innerHTML = `
      <div class="container">
        <div class="header">
          <button class="back-btn" type="button" id="back-from-reg">← Назад</button>
          <h2>Регистрация</h2>
        </div>
        <div class="reg-card">
          <div class="reg-step-indicator">Шаг 3 из 3</div>
          <div class="reg-icon">🏷</div>
          <h3>Название ИП / магазина</h3>
          <p class="reg-text">
            Как отображать вас в заявках? Например:
          </p>
          <p class="reg-example">ИП Иванов Иван Иванович</p>
          <p class="reg-example">Магазин «КИС КИС»</p>
          <div class="form-group" style="margin-top:12px;">
            <input type="text" id="reg-business-input" placeholder="Название ИП или магазина" class="reg-input" />
          </div>
          <button type="button" class="btn btn-primary" id="reg-business-submit" style="margin-top:12px;">Завершить регистрацию</button>
        </div>
      </div>`;
    document.getElementById("back-from-reg").onclick = () => goToMain();
    document.getElementById("reg-business-submit").onclick = async () => {
      const val = document.getElementById("reg-business-input").value.trim();
      if (val.length < 2) {
        showNotification("Минимум 2 символа");
        return;
      }
      if (val.length > 200) {
        showNotification("Максимум 200 символов");
        return;
      }
      const btn = document.getElementById("reg-business-submit");
      if (btn) { btn.disabled = true; btn.textContent = "Подождите…"; }
      try {
        const r = await fetch("/api/miniapp-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: tg.initData, step: "business_name", businessName: val }),
        });
        const j = await r.json();
        if (j.ok && j.nextStep === "done") {
          formState.registered = true;
          formState.registrationStep = "done";
          showNotification("✅ Регистрация завершена!");
          setTimeout(() => goToNewOrder(), 800);
        } else if (j.ok) {
          formState.registrationStep = j.nextStep;
          renderRegistration(j.nextStep);
        } else {
          const msg = j.error === "name_too_short" ? "Минимум 2 символа" : "Ошибка";
          showNotification("❌ " + msg);
          if (btn) { btn.disabled = false; btn.textContent = "Завершить регистрацию"; }
        }
      } catch {
        showNotification("❌ Ошибка сети");
        if (btn) { btn.disabled = false; btn.textContent = "Завершить регистрацию"; }
      }
    };
    updateButtonState();
    return;
  }

  goToMain();
}

async function submitPhone(phone) {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  try {
    const r = await fetch("/api/miniapp-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData, step: "phone", phone: cleaned }),
    });
    const j = await r.json();
    if (j.ok) {
      formState.registrationStep = j.nextStep;
      if (j.nextStep === "done") {
        formState.registered = true;
        showNotification("✅ Регистрация завершена!");
        setTimeout(() => goToNewOrder(), 800);
      } else {
        renderRegistration(j.nextStep);
      }
    } else {
      showNotification("❌ Некорректный номер");
    }
  } catch {
    showNotification("❌ Ошибка сети");
  }
}

async function checkRegistrationAndProceed() {
  app.innerHTML = `
    <div class="container">
      <div class="header">
        <button class="back-btn" type="button" id="back-from-loading">← Назад</button>
        <h2>Проверка…</h2>
      </div>
      <p class="info-text">Загрузка…</p>
    </div>`;
  document.getElementById("back-from-loading").onclick = () => goToMain();

  const cfg = await fetchMiniappConfig();
  formState.registered = cfg.registered;
  formState.registrationStep = cfg.registrationStep;
  formState.currentRole = cfg.currentRole;

  if (!cfg.registered) {
    renderRegistration(cfg.registrationStep);
    return;
  }

  if (!formState.orderData.needsPickup) {
    formState.orderData.pickupAddresses = [""];
  }
  renderNewOrder();
}

function goToMain() {
  renderMain();
}

function goToNewOrder() {
  if (formState.registered) {
    if (!formState.orderData.needsPickup) {
      formState.orderData.pickupAddresses = [""];
    }
    renderNewOrder();
  } else {
    checkRegistrationAndProceed();
  }
}

function goToOrderList() {
  renderOrderList();
}

function validateOrder() {
  const errors = {};
  const d = formState.orderData;
  if (!d.product || !d.product.trim()) errors.product = "Укажите товар";
  if (!d.quantity || !d.quantity.trim()) errors.quantity = "Укажите количество";
  if (!d.tz || !d.tz.trim()) errors.tz = "Укажите ТЗ/условия";
  if (!d.marketplace) errors.marketplace = "Выберите маркетплейс";
  if (!d.warehouseId) errors.warehouseId = "Выберите склад";
  if (d.needsPickup) {
    const filled = d.pickupAddresses.map((a) => a.trim()).filter(Boolean);
    if (filled.length === 0) errors.pickupAddresses = "Укажите хотя бы один адрес забора";
  }
  formState.errors = errors;
  return Object.keys(errors).length === 0;
}

function submitOrder() {
  if (!validateOrder()) {
    renderNewOrder();
    return;
  }
  const d = formState.orderData;
  const pickupAddresses = d.needsPickup
    ? d.pickupAddresses.map((a) => a.trim()).filter(Boolean)
    : [];

  const orderData = {
    product: d.product.trim(),
    quantity: d.quantity.trim(),
    tz: d.tz.trim(),
    needsPickup: d.needsPickup,
    marketplace: d.marketplace,
    warehouseId: d.warehouseId,
    pickupAddresses,
    desiredDeliveryDate: d.desiredDeliveryDate.trim(),
    comment: d.comment.trim(),
    userId,
    userName,
    timestamp: new Date().toISOString(),
  };

  showOrderSummary(orderData);
}

function showOrderSummary(orderData) {
  const pickupList = orderData.pickupAddresses.length > 0
    ? `<div class="summary-section">
        <strong>📍 Точки забора:</strong>
        ${orderData.pickupAddresses.map((a) => `<p>• ${escapeHtml(a)}</p>`).join("")}
      </div>`
    : "";

  const whLabel = OZON_WAREHOUSES.concat(WB_WAREHOUSES).find((w) => w.id === orderData.warehouseId)?.label || orderData.warehouseId;

  app.innerHTML = `
    <div class="container">
      <div class="header">
        <h2>✅ Подтверждение заявки</h2>
      </div>
      <div class="summary-card">
        <div class="summary-section">
          <strong>📦 Товар:</strong>
          <p>${escapeHtml(orderData.product)}</p>
        </div>
        <div class="summary-section">
          <strong>📊 Количество:</strong>
          <p>${escapeHtml(orderData.quantity)}</p>
        </div>
        <div class="summary-section">
          <strong>📝 ТЗ (условия):</strong>
          <p>${escapeHtml(orderData.tz)}</p>
        </div>
        ${
          orderData.needsPickup
            ? `<div class="summary-section">
                <strong>🚚 Нужен забор:</strong>
                <p>Да</p>
              </div>`
            : ""
        }
        ${pickupList}
        <div class="summary-section">
          <strong>🏪 Маркетплейс:</strong>
          <p>${orderData.marketplace === "wb" ? "Wildberries" : "Ozon"}</p>
        </div>
        <div class="summary-section">
          <strong>📍 Склад назначения:</strong>
          <p>${escapeHtml(whLabel)}</p>
        </div>
        ${
          orderData.desiredDeliveryDate
            ? `<div class="summary-section">
                <strong>📅 Желаемая дата поставки:</strong>
                <p>${escapeHtml(orderData.desiredDeliveryDate)}</p>
              </div>`
            : ""
        }
        ${
          orderData.comment
            ? `<div class="summary-section">
                <strong>💬 Комментарий:</strong>
                <p>${escapeHtml(orderData.comment)}</p>
              </div>`
            : ""
        }
        <div style="margin-top: 20px; display: flex; gap: 8px; flex-direction: column;">
          <button type="button" class="btn btn-primary" id="confirm-order">✅ Создать заявку</button>
          <button type="button" class="btn btn-secondary" id="edit-order">✏️ Редактировать</button>
        </div>
      </div>
    </div>`;

  formState.step = "order-summary";

  document.getElementById("confirm-order").onclick = async () => {
    const confirmBtn = document.getElementById("confirm-order");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Отправка…";
    }

    try {
      const r = await fetch("/api/miniapp-create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData: tg.initData,
          product: orderData.product,
          quantity: orderData.quantity,
          tz: orderData.tz,
          needsPickup: orderData.needsPickup,
          marketplace: orderData.marketplace,
          warehouseId: orderData.warehouseId,
          pickupAddresses: orderData.pickupAddresses,
          desiredDeliveryDate: orderData.desiredDeliveryDate,
          comment: orderData.comment,
        }),
      });
      const j = await r.json();
      if (j.ok) {
        showNotification("✅ Заявка №" + j.orderId + " создана! Смотрите чат бота.");
        formState.orderData = {
          product: "",
          quantity: "",
          tz: "",
          needsPickup: false,
          marketplace: "",
          warehouseId: "",
          pickupAddresses: [""],
          desiredDeliveryDate: "",
          comment: "",
        };
        formState.errors = {};
        setTimeout(() => tg.close(), 1500);
      } else {
        const msg = j.error === "not_registered" ? "Завершите регистрацию в боте"
          : j.error === "client_role_required" ? "Доступно только в роли Клиент"
          : "Ошибка создания заявки";
        showNotification("❌ " + msg);
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "✅ Создать заявку";
        }
      }
    } catch (err) {
      console.error("create-order error:", err);
      showNotification("❌ Ошибка сети");
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "✅ Создать заявку";
      }
    }
  };

  document.getElementById("edit-order").onclick = () => {
    renderNewOrder();
  };

  updateButtonState();
}

function showNotification(text) {
  const notification = document.createElement("div");
  notification.className = "notification";
  notification.textContent = text;
  document.body.appendChild(notification);
  setTimeout(() => notification.classList.add("show"), 10);
  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => notification.remove(), 300);
  }, 2500);
}

function updateButtonState() {
  /** Основная кнопка в форме — дублировать MainButton не нужно (избегаем двойной отправки). */
  tg.MainButton.hide();
}

renderMain();
