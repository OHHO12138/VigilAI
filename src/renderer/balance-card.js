// 余额卡片：自定义名 + 余额（币种符号）+ 刷新时间 + 手动刷新按钮
import { el } from './dom.js';
import { t } from './i18n.js';
import { getEntry, getAlertCfg, balanceAlertLevel } from './state.js';
import { buildCardHeader, buildErrorBody } from './monitor-card.js';

function currencySymbol(monitor, data) {
  const cur = monitor.currency || (data && data.currency) || 'CNY';
  if (cur === 'USD') return '$';
  return '¥'; // RMB / CNY
}

function formatBalance(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return value.toFixed(2);
}

export function renderBalanceCard(elm, monitor) {
  const entry = getEntry(monitor.id);
  elm.innerHTML = '';
  elm.classList.toggle('disabled', !monitor.enabled);
  elm.appendChild(buildCardHeader(monitor, entry));

  if (!monitor.enabled) {
    elm.appendChild(el('div', { class: 'card-hint' }, t('card.disabled')));
    return;
  }
  if (!entry) {
    elm.appendChild(el('div', { class: 'card-hint' }, t('card.loading')));
    return;
  }
  if (!entry.ok && !entry.data) {
    elm.appendChild(buildErrorBody(monitor, entry));
    return;
  }

  const balance = entry.data && entry.data.balance;
  const children = [
    el('span', { class: 'balance-symbol' }, currencySymbol(monitor, entry.data)),
    el('span', { class: 'balance-number' }, formatBalance(balance)),
  ];
  // 余额预警：按余额落档。dot 模式显示色球，image 模式显示档位图（未配图回退色球）
  if (typeof balance === 'number' && Number.isFinite(balance)) {
    const alertCfg = getAlertCfg(monitor);
    const level = balanceAlertLevel(balance, monitor);
    const imgSrc = alertCfg.mode === 'image' ? (alertCfg.images || {})[level] : '';
    if (imgSrc) {
      children.push(
        el('img', { class: 'balance-alert-image', src: `file:///${String(imgSrc).replace(/\\/g, '/')}`, alt: level })
      );
    } else {
      children.push(
        el('span', { class: `alert-dot balance-alert-dot ${level}`, style: `background:${(alertCfg.colors || {})[level] || 'transparent'}` })
      );
    }
  }
  elm.appendChild(el('div', { class: 'balance-value' }, children));
  if (entry.error) elm.appendChild(buildErrorBody(monitor, entry));
}

export function createBalanceCard(monitor) {
  const elm = el('div', { class: 'card balance-card', dataset: { id: monitor.id } });
  renderBalanceCard(elm, monitor);
  return elm;
}

export function updateBalanceCard(elm, monitor) {
  renderBalanceCard(elm, monitor);
}
