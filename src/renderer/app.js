// 渲染层编排：标题栏、卡片列表、设置面板、i18n 重渲染、数据流。
// 数据流：init-state（config 快照）→ monitors:list → 每项 monitor:get 拿缓存渲染
// （无缓存的触发一次 monitor:refresh）→ onMonitorData 更新对应卡片。
import { $, $$, el, deepMerge } from './dom.js';
import { t, setLocale, getLocale, onLocaleChange } from './i18n.js';
import { state, setEntry, getMonitor } from './state.js';
import { createUsageCard, updateUsageCard } from './monitor-card.js';
import { createBalanceCard, updateBalanceCard } from './balance-card.js';
import { openSettings, isSettingsOpen, renderSettings } from './settings.js';

const api = window.api || null;
const cardEls = new Map(); // monitor id → card element

// ---- config → CSS 变量 / 类 ----

function applyConfig(cfg) {
  if (!cfg) return;
  const root = document.documentElement.style;
  const a = cfg.appearance || {};
  if (a.borderWidth != null) root.setProperty('--app-border-width', `${a.borderWidth}px`);
  if (a.bgColor) root.setProperty('--app-bg', a.bgColor);
  if (a.cardBgColor) root.setProperty('--card-bg', a.cardBgColor);
  if (a.ringTrackColor) root.setProperty('--ring-track', a.ringTrackColor);
  if (a.ringUsedColor) root.setProperty('--ring-used', a.ringUsedColor);
  if (a.fontColor) root.setProperty('--font-color', a.fontColor);
  if (a.fontSize != null) root.setProperty('--font-size', `${a.fontSize}px`);
  $('#app').style.opacity = String(cfg.opacity ?? 0.92);
  setPinState(!!cfg.alwaysOnTop);
}

// 置顶=实心三角，非置顶=空心三角
function setPinState(on) {
  const btn = $('#btn-pin');
  btn.textContent = on ? '▲' : '△';
  btn.classList.toggle('active', on);
}

// ---- 横排 / 竖排切换 ----

let fitRaf = 0;

function scheduleFit() {
  if (!api || !$('#app').classList.contains('layout-horizontal')) return;
  cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    fitRaf = requestAnimationFrame(fitHorizontalWindow);
  });
}

// 横向模式：窗口宽度 = 左侧标题列 + 全部卡片一行排开的宽度；高度 = 最高卡片 + 边距
function fitHorizontalWindow() {
  if (!api || !$('#app').classList.contains('layout-horizontal')) return;
  const border =
    (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-border-width')) || 8) * 2;
  const titleBar = $('#title-bar').getBoundingClientRect();
  const cards = $('#cards');
  const cardEls = $$('.card');
  const cardsH = cardEls.length ? Math.max(...cardEls.map((c) => c.offsetHeight)) : 120;
  const contentH = Math.max(cardsH + 12, 110);
  const width = Math.ceil(titleBar.width + cards.scrollWidth + border);
  const height = Math.ceil(contentH + border);
  api.setLayoutSize({ width, height, minWidth: 320, minHeight: 120, mode: 'horizontal' });
}

function applyLayoutMode(mode, { fit = true } = {}) {
  const app = $('#app');
  const horizontal = mode === 'horizontal';
  if (horizontal) {
    // 先按当前竖排尺寸量卡片宽度，保证切过去后卡片框大小不变
    const card = $('.card');
    const border =
      (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-border-width')) || 8) * 2;
    const w = card
      ? card.getBoundingClientRect().width
      : Math.max(260, Math.round(window.innerWidth - border * 2 - 16));
    app.style.setProperty('--h-card-width', `${w}px`);
  } else {
    app.style.removeProperty('--h-card-width');
  }
  app.classList.toggle('layout-horizontal', horizontal);
  $('.title-text').textContent = horizontal ? t('app.title').replace(/\s+/, '\n') : t('app.title');
  const btn = $('#btn-layout');
  btn.dataset.i18nTitle = horizontal ? 'title.layoutVertical' : 'title.layoutHorizontal';
  btn.title = t(btn.dataset.i18nTitle);
  if (!fit) return;
  if (horizontal) {
    scheduleFit();
  } else {
    cancelAnimationFrame(fitRaf);
    const w = Math.max(260, Math.round(state.config.width || 420));
    const h = Math.max(300, Math.round(state.config.height || 580));
    api.setLayoutSize({ width: w, height: h, minWidth: 260, minHeight: 300, mode: 'vertical' });
  }
}

// 设置面板改动：本地已合并 state.config，这里应用 + 防抖持久化（合并累积的 patch）
let pendingPatch = {};
let patchTimer = null;
function onConfigChange(patch) {
  applyConfig(state.config);
  pendingPatch = deepMerge(pendingPatch, patch);
  clearTimeout(patchTimer);
  patchTimer = setTimeout(() => {
    const p = pendingPatch;
    pendingPatch = {};
    api.patchConfig(p);
  }, 400);
}

// ---- 卡片 ----

function renderCards() {
  const container = $('#cards');
  container.innerHTML = '';
  cardEls.clear();
  // 主界面只显示启用的监控项；停用的仍在设置里可见，可重新勾选
  const visible = state.monitors.filter((m) => m.enabled !== false);
  if (!visible.length) {
    const hasMonitors = state.monitors.length > 0;
    container.appendChild(
      el('div', { class: 'empty-state' }, [
        el('span', { class: 'empty-icon' }, '◔'),
        el('span', { class: 'empty-text' }, hasMonitors ? t('empty.allDisabled') : t('empty.text')),
        el('span', { class: 'empty-hint' }, hasMonitors ? t('empty.allDisabledHint') : t('empty.hint')),
      ])
    );
    return;
  }
  for (const m of visible) {
    const card = m.kind === 'balance' ? createBalanceCard(m) : createUsageCard(m);
    cardEls.set(m.id, card);
    container.appendChild(card);
  }
  scheduleFit();
}

function updateCard(id) {
  const m = getMonitor(id);
  const elm = cardEls.get(id);
  if (!m || !elm) return;
  if (m.kind === 'balance') updateBalanceCard(elm, m);
  else updateUsageCard(elm, m);
  scheduleFit();
}

async function reloadMonitors() {
  state.monitors = await api.listMonitors();
  renderCards();
  for (const m of state.monitors) {
    if (!m.enabled) continue;
    const cached = await api.getMonitor(m.id);
    if (cached) {
      setEntry(cached);
      updateCard(m.id);
    } else {
      api.refreshMonitor(m.id); // 首次取数，结果由 monitor:data 推送回来
    }
  }
}

// ---- 静态文案 ----

function applyStaticTexts() {
  document.documentElement.lang = getLocale() === 'zh' ? 'zh-CN' : 'en';
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
  }
  if ($('#app').classList.contains('layout-horizontal')) {
    $('.title-text').textContent = t('app.title').replace(/\s+/, '\n');
  }
}

// ---- 标题栏 ----

function wireTitleBar() {
  $('#btn-layout').addEventListener('click', () => {
    const next = $('#app').classList.contains('layout-horizontal') ? 'vertical' : 'horizontal';
    state.config.layoutMode = next;
    applyLayoutMode(next);
  });

  $('#btn-pin').addEventListener('click', async () => {
    const on = await api.toggleAlwaysOnTop();
    setPinState(!!on);
  });

  $('#btn-minimize').addEventListener('click', () => api.minimizeWindow());
  $('#btn-close').addEventListener('click', () => api.hideWindow());
  $('#btn-settings').addEventListener('click', () => openSettings({ onConfigChange, onMonitorsChanged: reloadMonitors }));
}

// ---- 启动 ----

async function init() {
  if (!api) return; // 浏览器直接打开时静默降级
  wireTitleBar();

  onLocaleChange(() => {
    applyStaticTexts();
    renderCards();
    if (isSettingsOpen()) renderSettings();
  });

  state.config = await api.getConfig();
  setLocale(state.config.locale || 'zh');
  state.providers = await api.listProviders();

  api.onInitState((snapshot) => {
    if (snapshot && snapshot.config) {
      state.config = snapshot.config;
      setLocale(snapshot.config.locale || 'zh');
      applyConfig(snapshot.config);
      applyLayoutMode(snapshot.config.layoutMode === 'horizontal' ? 'horizontal' : 'vertical', { fit: false });
      applyStaticTexts();
    }
  });

  api.onMonitorData((payload) => {
    setEntry(payload);
    updateCard(payload.id);
  });

  applyConfig(state.config);
  applyLayoutMode(state.config.layoutMode === 'horizontal' ? 'horizontal' : 'vertical', { fit: false });
  applyStaticTexts();
  await reloadMonitors();
}

init();
