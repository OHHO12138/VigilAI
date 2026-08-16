// 渲染层共享状态：config 快照、monitors 列表、provider 元信息、每个 monitor 的最新数据。
const state = {
  config: null,
  monitors: [],
  providers: [],
  data: new Map(), // id → { id, ok, data, updatedAt, error }
};

function getEntry(id) {
  return state.data.get(id) || null;
}

function setEntry(entry) {
  if (entry && entry.id) state.data.set(entry.id, entry);
}

function getMonitor(id) {
  return state.monitors.find((m) => m.id === id) || null;
}

function getProviderMeta(provider) {
  return state.providers.find((p) => p.id === provider) || null;
}

// 卡片"打开官网"按钮的地址：monitor.auth.siteUrl 覆盖优先，否则用厂商预设 siteUrl
function getSiteUrl(monitor) {
  if (!monitor) return '';
  const over = monitor.auth && typeof monitor.auth.siteUrl === 'string' ? monitor.auth.siteUrl.trim() : '';
  if (over) return over;
  const meta = getProviderMeta(monitor.provider);
  return (meta && meta.siteUrl) || '';
}

// 单个监控项的预警覆盖（monitor.alert）深合并到全局 config.alert 上
function getAlertCfg(monitor) {
  const base = (state.config && state.config.alert) || {};
  const over = (monitor && monitor.alert) || null;
  if (!over) return base;
  return {
    ...base,
    ...over,
    colors: { ...(base.colors || {}), ...(over.colors || {}) },
    images: { ...(base.images || {}), ...(over.images || {}) },
  };
}

// 预警落档：<t1 安全，<t2 关注，否则危险。monitor 有覆盖时用覆盖的阈值
function alertLevel(percent, monitor) {
  const alertCfg = getAlertCfg(monitor);
  const t1 = alertCfg.threshold1 ?? 50;
  const t2 = alertCfg.threshold2 ?? 85;
  if (percent < t1) return 'safe';
  if (percent < t2) return 'warning';
  return 'danger';
}

// 余额预警落档（与用量相反，余额越高越安全）：≥bt1 安全，≥bt2 关注，否则危险。约束 bt1 > bt2
function balanceAlertLevel(balance, monitor) {
  const alertCfg = getAlertCfg(monitor);
  const bt1 = alertCfg.balanceThreshold1 ?? 50;
  const bt2 = alertCfg.balanceThreshold2 ?? 20;
  if (balance >= bt1) return 'safe';
  if (balance >= bt2) return 'warning';
  return 'danger';
}

// 计算拖动后的监控项顺序：把 dragId 移到 targetId 之前（after=false）或之后（after=true）。
// 输入不合法（id 不存在）时返回 null，调用方不保存。
function computeReorderIds(dragId, targetId, after) {
  const ids = state.monitors.map((m) => m.id);
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1) return null;
  const [moved] = ids.splice(from, 1);
  const targetIndex = ids.indexOf(targetId);
  ids.splice(targetIndex + (after ? 1 : 0), 0, moved);
  return ids;
}

export {
  state,
  getEntry,
  setEntry,
  getMonitor,
  getProviderMeta,
  getSiteUrl,
  getAlertCfg,
  alertLevel,
  balanceAlertLevel,
  computeReorderIds,
};
