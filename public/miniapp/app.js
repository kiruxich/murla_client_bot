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
  { id: "wb_koledino", label: "Коледино", note: "Подольск, Московская обл." },
  { id: "wb_sofino", label: "Софьино", note: "МО, технопарк Софьино" },
  { id: "wb_elektrostal", label: "Электросталь", note: "Московская обл." },
  { id: "wb_podolsk", label: "Подольск", note: "Московская обл." },
  { id: "wb_kazan", label: "Казань", note: "Респ. Татарстан" },
  { id: "wb_krasnodar", label: "Краснодар", note: "Краснодарский край" },
  { id: "wb_ekb", label: "Екатеринбург", note: "Свердловская обл." },
  { id: "wb_novosibirsk", label: "Новосибирск", note: "Новосибирская обл." },
  { id: "wb_spb_shushary", label: "Шушары", note: "Санкт-Петербург / ЛО" },
  { id: "wb_habarovsk", label: "Хабаровск", note: "Хабаровский край" },
];

const OZON_WAREHOUSES = [
  { id: "ozon_sofino", label: "Софьино", note: "МО, технопарк Софьино" },
  { id: "ozon_habarovsk", label: "Хабаровск", note: "Хабаровский край" },
  { id: "ozon_kazan", label: "Казань", note: "Респ. Татарстан" },
  { id: "ozon_krasnodar", label: "Краснодар", note: "Краснодарский край" },
  { id: "ozon_rostov", label: "Ростов-на-Дону", note: "Ростовская обл." },
  { id: "ozon_ekb", label: "Екатеринбург", note: "Свердловская обл." },
  { id: "ozon_novosibirsk", label: "Новосибирск", note: "Новосибирская обл." },
  { id: "ozon_spb", label: "Санкт-Петербург", note: "ЛО / СПб" },
  { id: "ozon_tver", label: "Тверь", note: "Тверская обл." },
  { id: "ozon_domodedovo", label: "Домодедово", note: "Московская обл." },
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
  document.getElementById("btn-new-order").onclick = () => goToNewOrder();
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
      (w) =>
        `<option value="${escapeHtml(w.id)}" ${d.warehouseId === w.id ? "selected" : ""}>${escapeHtml(w.label)}${
          w.note ? " — " + escapeHtml(w.note) : ""
        }</option>`,
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
          <label>Желаемая дата поставки</label>
          <input type="text" name="desiredDeliveryDate" placeholder="Например: 15.04.2026"
            value="${escapeHtml(d.desiredDeliveryDate)}" />
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
    if (t.name === "desiredDeliveryDate") formState.orderData.desiredDeliveryDate = t.value;
    if (t.name === "comment") formState.orderData.comment = t.value;
    if (t.name === "warehouseId") formState.orderData.warehouseId = t.value;
  });

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
    return { canSwitchRole: false };
  }
  try {
    const r = await fetch("/api/miniapp-config?initData=" + encodeURIComponent(initData));
    if (!r.ok) return { canSwitchRole: false };
    const j = await r.json();
    return { canSwitchRole: Boolean(j.canSwitchRole) };
  } catch {
    return { canSwitchRole: false };
  }
}

function renderProfileContent(cfg) {
  const canSwitch = cfg.canSwitchRole;
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
    </div>`;
  formState.step = "profile";
  formState.profileCanSwitchRole = canSwitch;
  document.getElementById("back-from-profile").onclick = () => goToMain();
  const closeBtn = document.getElementById("btn-close-app");
  if (closeBtn) closeBtn.onclick = () => tg.close();
  const switchBtn = document.getElementById("btn-switch-role");
  if (switchBtn) {
    switchBtn.onclick = () => {
      tg.sendData(JSON.stringify({ action: "switch_role" }));
      showNotification("Запрос отправлен боту. Смотрите чат.");
      tg.close();
    };
  }
  updateButtonState();
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
    renderProfileContent(cfg, orders);
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

function renderProfileContent(cfg, orders = []) {
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
  document.getElementById("back-from-profile").onclick = () => goToMain();
  const closeBtn = document.getElementById("btn-close-app");
  if (closeBtn) closeBtn.onclick = () => tg.close();
  const switchBtn = document.getElementById("btn-switch-role");
  if (switchBtn) {
    switchBtn.onclick = () => {
      tg.sendData(JSON.stringify({ action: "switch_role" }));
      showNotification("Запрос отправлен боту. Смотрите чат.");
      tg.close();
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

function goToMain() {
  renderMain();
}

function goToNewOrder() {
  if (!formState.orderData.needsPickup) {
    formState.orderData.pickupAddresses = [""];
  }
  renderNewOrder();
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

  tg.sendData(JSON.stringify(orderData));
  showNotification("✅ Заявка отправлена боту");

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
  setTimeout(() => goToMain(), 1500);
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
