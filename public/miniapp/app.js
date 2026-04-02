// Telegram Mini App SDK
const tg = window.Telegram.WebApp;

// Инициализируем приложение
tg.ready();
tg.expand();

// Цветовая схема
const isDark = tg.colorScheme === 'dark';

// Стили для разных тем
const themeColors = {
  light: {
    bg: '#ffffff',
    text: '#000000',
    secondary: '#757575',
    border: '#e0e0e0',
    primary: '#0088cc',
    success: '#31a24c',
    error: '#d74545',
    inputBg: '#f5f5f5',
  },
  dark: {
    bg: '#1a1a1a',
    text: '#ffffff',
    secondary: '#b0b0b0',
    border: '#333333',
    primary: '#0088cc',
    success: '#31a24c',
    error: '#d74545',
    inputBg: '#2a2a2a',
  },
};

const colors = isDark ? themeColors.dark : themeColors.light;

// Применяем CSS переменные
document.documentElement.style.setProperty('--bg-color', colors.bg);
document.documentElement.style.setProperty('--text-color', colors.text);
document.documentElement.style.setProperty('--secondary-color', colors.secondary);
document.documentElement.style.setProperty('--border-color', colors.border);
document.documentElement.style.setProperty('--primary-color', colors.primary);
document.documentElement.style.setProperty('--success-color', colors.success);
document.documentElement.style.setProperty('--error-color', colors.error);
document.documentElement.style.setProperty('--input-bg', colors.inputBg);

// Состояние формы
const formState = {
  step: 'main', // main, new-order, order-list, profile
  orderData: {
    product: '',
    quantity: '',
    tz: '',
    needsPickup: false,
    marketplace: '',
    warehouseId: '',
    desiredDeliveryDate: '',
    comment: '',
  },
  errors: {},
};

// Получаем начальные данные от бота
const initData = tg.initDataUnsafe;
const userId = initData?.user?.id || 'unknown';
const userName = initData?.user?.first_name || 'Пользователь';

// === ЭЛЕМЕНТЫ СТРАНИЦЫ ===
const app = document.getElementById('app');

// === ГЛАВНОЕ МЕНЮ ===
function renderMain() {
  app.innerHTML = `
    <div class="container">
      <div class="header">
        <h1>Мурла 📦</h1>
        <p class="subtitle">Управление заявками</p>
      </div>

      <div class="menu">
        <button class="menu-btn" onclick="goToNewOrder()">
          <span class="menu-icon">➕</span>
          <span class="menu-text">Новая заявка</span>
        </button>
        
        <button class="menu-btn" onclick="goToOrderList()">
          <span class="menu-icon">📋</span>
          <span class="menu-text">Мои заявки</span>
        </button>
        
        <button class="menu-btn" onclick="goToProfile()">
          <span class="menu-icon">👤</span>
          <span class="menu-text">Профиль</span>
        </button>
      </div>

      <div class="info-block">
        <p class="info-text">Привет, <strong>${userName}</strong>!</p>
        <p class="info-text small">Ваш ID: ${userId}</p>
      </div>
    </div>
  `;
  
  formState.step = 'main';
  updateButtonState();
}

// === НОВАЯ ЗАЯВКА ===
function renderNewOrder() {
  const { product, quantity, tz, needsPickup, marketplace, desiredDeliveryDate, comment } = formState.orderData;
  const { product: productErr, quantity: quantityErr, tz: tzErr } = formState.errors;

  app.innerHTML = `
    <div class="container">
      <div class="header">
        <button class="back-btn" onclick="goToMain()">← Назад</button>
        <h2>Новая заявка</h2>
      </div>

      <form class="form">
        <div class="form-group">
          <label>Товар *</label>
          <input 
            type="text" 
            placeholder="Например: куртка красная XL"
            value="${product}"
            onchange="updateOrderData('product', this.value)"
            class="${productErr ? 'input-error' : ''}"
          />
          ${productErr ? `<span class="error-text">${productErr}</span>` : ''}
        </div>

        <div class="form-group">
          <label>Количество *</label>
          <input 
            type="text" 
            placeholder="Например: 10 шт"
            value="${quantity}"
            onchange="updateOrderData('quantity', this.value)"
            class="${quantityErr ? 'input-error' : ''}"
          />
          ${quantityErr ? `<span class="error-text">${quantityErr}</span>` : ''}
        </div>

        <div class="form-group">
          <label>ТЗ (условия) *</label>
          <textarea 
            placeholder="Техническое задание, размеры, особенности..."
            onchange="updateOrderData('tz', this.value)"
            class="${tzErr ? 'input-error' : ''}"
          >${tz}</textarea>
          ${tzErr ? `<span class="error-text">${tzErr}</span>` : ''}
        </div>

        <div class="form-group">
          <label>Нужен забор товара?</label>
          <div class="checkbox-group">
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                ${needsPickup ? 'checked' : ''}
                onchange="updateOrderData('needsPickup', this.checked)"
              />
              Да, со своей точки
            </label>
          </div>
        </div>

        <div class="form-group">
          <label>Маркетплейс</label>
          <select onchange="updateOrderData('marketplace', this.value)" value="${marketplace}">
            <option value="">Не выбран</option>
            <option value="wb">Wildberries</option>
            <option value="ozon">Ozon</option>
          </select>
        </div>

        <div class="form-group">
          <label>Желаемая дата поставки</label>
          <input 
            type="text" 
            placeholder="Например: 15.04.2026"
            value="${desiredDeliveryDate}"
            onchange="updateOrderData('desiredDeliveryDate', this.value)"
          />
        </div>

        <div class="form-group">
          <label>Комментарий</label>
          <textarea 
            placeholder="Дополнительная информация..."
            onchange="updateOrderData('comment', this.value)"
          >${comment}</textarea>
        </div>

        <button type="button" class="btn btn-primary" onclick="submitOrder()">
          Создать заявку
        </button>
      </form>
    </div>
  `;

  formState.step = 'new-order';
  updateButtonState();
}

// === СПИСОК ЗАЯВОК ===
function renderOrderList() {
  app.innerHTML = `
    <div class="container">
      <div class="header">
        <button class="back-btn" onclick="goToMain()">← Назад</button>
        <h2>Мои заявки</h2>
      </div>

      <div class="empty-state">
        <p class="empty-icon">📋</p>
        <p class="empty-text">Здесь будут ваши заявки</p>
        <p class="empty-subtext">Создайте новую заявку, чтобы она появилась здесь</p>
        <button class="btn btn-primary" onclick="goToNewOrder()">Создать заявку</button>
      </div>
    </div>
  `;

  formState.step = 'order-list';
  updateButtonState();
}

// === ПРОФИЛЬ ===
function renderProfile() {
  app.innerHTML = `
    <div class="container">
      <div class="header">
        <button class="back-btn" onclick="goToMain()">← Назад</button>
        <h2>Профиль</h2>
      </div>

      <div class="profile-card">
        <div class="avatar">${userName.charAt(0).toUpperCase()}</div>
        <h3>${userName}</h3>
        <p class="profile-id">ID: ${userId}</p>
        
        <div class="profile-info">
          <div class="info-row">
            <span class="info-label">Статус:</span>
            <span class="info-value">Активен</span>
          </div>
          <div class="info-row">
            <span class="info-label">Язык:</span>
            <span class="info-value">Русский</span>
          </div>
        </div>

        <button class="btn btn-secondary" onclick="logout()">
          Выход
        </button>
      </div>
    </div>
  `;

  formState.step = 'profile';
  updateButtonState();
}

// === ФУНКЦИИ НАВИГАЦИИ ===
function goToMain() {
  renderMain();
}

function goToNewOrder() {
  renderNewOrder();
}

function goToOrderList() {
  renderOrderList();
}

function goToProfile() {
  renderProfile();
}

// === ФУНКЦИИ РАБОТЫ С ФОРМОЙ ===
function updateOrderData(field, value) {
  formState.orderData[field] = value;
  // Очищаем ошибку для этого поля
  if (formState.errors[field]) {
    delete formState.errors[field];
  }
}

function validateOrder() {
  const errors = {};
  const { product, quantity, tz } = formState.orderData;

  if (!product || product.trim().length === 0) {
    errors.product = 'Укажите товар';
  }
  if (!quantity || quantity.trim().length === 0) {
    errors.quantity = 'Укажите количество';
  }
  if (!tz || tz.trim().length === 0) {
    errors.tz = 'Укажите ТЗ/условия';
  }

  formState.errors = errors;
  return Object.keys(errors).length === 0;
}

function submitOrder() {
  if (!validateOrder()) {
    renderNewOrder();
    return;
  }

  // Отправляем данные боту через Web App API
  const orderData = {
    ...formState.orderData,
    userId,
    userName,
    timestamp: new Date().toISOString(),
  };

  // Отправляем данные боту
  tg.sendData(JSON.stringify(orderData));

  // Показываем сообщение об успехе
  showNotification('✅ Заявка создана!');

  // Очищаем форму
  formState.orderData = {
    product: '',
    quantity: '',
    tz: '',
    needsPickup: false,
    marketplace: '',
    warehouseId: '',
    desiredDeliveryDate: '',
    comment: '',
  };

  // Возвращаемся в меню
  setTimeout(() => goToMain(), 1500);
}

function logout() {
  tg.close();
}

// === УВЕДОМЛЕНИЯ ===
function showNotification(text) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = text;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 2500);
}

// === КНОПКА ОТПРАВКИ ===
function updateButtonState() {
  if (formState.step === 'new-order') {
    tg.MainButton.text = 'Создать заявку';
    tg.MainButton.show();
    tg.MainButton.onClick(() => submitOrder());
  } else {
    tg.MainButton.hide();
  }
}

// === ИНИЦИАЛИЗАЦИЯ ===
renderMain();
