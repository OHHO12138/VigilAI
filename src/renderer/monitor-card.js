// 订阅用量卡片：圆环只渲染 periods 实际返回的键（fiveHours/week/month 顺序固定）。
// dot 模式：环中心显示百分比，标签前放落档色球；image 模式：圆环替换为档位图片，百分比移到标签后。
import { el } from './dom.js';
import { t } from './i18n.js';
import { getEntry, getAlertCfg, alertLevel, getSiteUrl } from './state.js';

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const PERIODS = ['fiveHours', 'week', 'month'];

function formatTime(updatedAt) {
  if (!updatedAt) return t('card.never');
  const d = new Date(updatedAt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 卡片头部：左 name，右 刷新时间 + 手动刷新按钮（interval 模式隐藏按钮）
export function buildCardHeader(monitor, entry) {
  const isInterval = monitor.refresh && monitor.refresh.mode === 'interval';
  const children = [
    el('span', { class: 'card-name', title: monitor.name || '' }, monitor.name || monitor.provider),
    el('span', { class: 'card-time' }, entry ? formatTime(entry.updatedAt) : t('card.never')),
  ];
  if (!isInterval) {
    children.push(
      el(
        'button',
        {
          class: 'card-refresh',
          title: t('card.refresh'),
          onclick: () => window.api.refreshMonitor(monitor.id),
        },
        '⟳'
      )
    );
  }
  const siteUrl = getSiteUrl(monitor);
  if (siteUrl) {
    children.push(
      el(
        'button',
        {
          class: 'card-site',
          title: t('card.site'),
          onclick: () => window.api.openSite(siteUrl),
        },
        '↗'
      )
    );
  }
  return el('div', { class: 'card-header' }, children);
}

function createRingSvg(percent) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 60 60');
  svg.classList.add('ring-svg');

  for (const cls of ['ring-track', 'ring-progress']) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', '30');
    c.setAttribute('cy', '30');
    c.setAttribute('r', String(RADIUS));
    c.classList.add(cls);
    svg.appendChild(c);
  }
  const progress = svg.lastChild;
  progress.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
  progress.style.strokeDashoffset = String(CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE);
  return svg;
}

function renderRing(monitor, periodKey, percent) {
  const alertCfg = getAlertCfg(monitor);
  const level = alertLevel(percent, monitor);
  const label = t(`period.${periodKey}`);

  const box = el('div', { class: 'ring-box' });
  let labelNode;

  if (alertCfg.mode === 'image') {
    const src = (alertCfg.images || {})[level];
    if (src) {
      // Windows 路径转 file URL（反斜杠 → 正斜杠，补三斜杠）
      box.appendChild(el('img', { class: 'ring-image', src: `file:///${String(src).replace(/\\/g, '/')}`, alt: label }));
    } else {
      // 该档未配图时回退圆环（百分比在标签后，环中心不再重复）
      box.appendChild(createRingSvg(percent));
    }
    // image 模式：百分比显示在标签后面
    labelNode = el('span', { class: 'ring-label' }, `${label} ${Math.round(percent)}%`);
  } else {
    box.appendChild(createRingSvg(percent));
    box.appendChild(el('span', { class: 'ring-percent' }, `${Math.round(percent)}%`));
    labelNode = el('span', { class: 'ring-label' }, [
      el('span', { class: `alert-dot ${level}`, style: `background:${(alertCfg.colors || {})[level] || 'transparent'}` }),
      label,
    ]);
  }

  return el('div', { class: 'ring-wrapper' }, [box, labelNode]);
}

// 错误态：文字提示 + 重试按钮（interval 模式也显示）
export function buildErrorBody(monitor, entry) {
  return el('div', { class: 'card-error' }, [
    el('span', { class: 'card-error-text', title: entry.error || '' }, `${t('card.failed')}: ${entry.error || ''}`),
    el('button', { class: 'card-retry', onclick: () => window.api.refreshMonitor(monitor.id) }, t('card.retry')),
  ]);
}

function renderUsageCard(elm, monitor) {
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

  const periods = (entry.data && entry.data.periods) || {};
  const rings = el('div', { class: 'card-rings' });
  for (const key of PERIODS) {
    if (!periods[key]) continue;
    rings.appendChild(renderRing(monitor, key, Math.min(100, periods[key].percent || 0)));
  }
  elm.appendChild(rings);
  if (entry.error) elm.appendChild(buildErrorBody(monitor, entry)); // 有旧数据但本次失败：底部提示
}

export function createUsageCard(monitor) {
  const elm = el('div', { class: 'card usage-card', dataset: { id: monitor.id } });
  renderUsageCard(elm, monitor);
  return elm;
}

export function updateUsageCard(elm, monitor) {
  renderUsageCard(elm, monitor);
}
