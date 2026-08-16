// 监控调度器：按每个 monitor 的 refresh.mode 调度取数，30s 内存缓存，结果经注入的 broadcast 推送。
// electron 依赖（webContents 推送、app/safeStorage、适配器注册表）全部通过 initMonitor 注入，纯 node 可测。
const config = require('./config');

const CACHE_TTL_MS = 30 * 1000;
const INTERVAL_MINUTES = [1, 5, 10, 30];

let adapters = {};
let ctx = {};
let broadcast = () => {};
const cache = new Map(); // id -> { id, ok, data, updatedAt, error }
const timers = new Map(); // id -> interval timer

function initMonitor(deps = {}) {
  adapters = deps.adapters || {};
  ctx = deps.ctx || {};
  broadcast = typeof deps.broadcast === 'function' ? deps.broadcast : () => {};
}

function getCached(id) {
  return cache.get(id) || null;
}

async function refreshMonitor(id, { force = false } = {}) {
  const cached = cache.get(id);
  if (!force && cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return cached;
  }

  const monitor = config.getMonitor(id);
  if (!monitor) return cached || null;
  if (!monitor.enabled) {
    return cached || { id, ok: false, data: null, updatedAt: Date.now(), error: '监控项已停用' };
  }

  const adapter = adapters[monitor.provider];
  let entry;
  if (!adapter) {
    entry = { id, ok: false, data: cached ? cached.data : null, updatedAt: Date.now(), error: `未知适配器：${monitor.provider}` };
  } else {
    try {
      // monitor.provider + monitor.kind 决定走哪条路；adapter.supportedKinds 声明支持的类型
      const kind = monitor.kind === 'balance' ? 'balance' : 'usage';
      const kinds = adapter.supportedKinds || (adapter.kind ? [adapter.kind] : []);
      if (!kinds.includes(kind)) {
        throw new Error(`适配器 ${monitor.provider} 不支持 ${kind} 类型`);
      }
      const data =
        kind === 'balance' ? await adapter.fetchBalance(monitor, ctx) : await adapter.fetchUsage(monitor, ctx);
      entry = { id, ok: true, data, updatedAt: Date.now(), error: null };
    } catch (e) {
      // 失败保留上次数据，附带 error
      entry = { id, ok: false, data: cached ? cached.data : null, updatedAt: Date.now(), error: e.message || String(e) };
    }
  }
  cache.set(id, entry);
  broadcast(entry);
  return entry;
}

function schedule(m) {
  if (!m.enabled || !m.refresh || m.refresh.mode !== 'interval') return;
  const minutes = INTERVAL_MINUTES.includes(m.refresh.minutes) ? m.refresh.minutes : 5;
  const timer = setInterval(() => {
    refreshMonitor(m.id, { force: true }).catch(() => {});
  }, minutes * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(m.id, timer);
  // 启动时先取一次（走缓存， cold 时即为首次取数）
  refreshMonitor(m.id).catch(() => {});
}

function startAll() {
  stopAll();
  for (const m of config.listMonitors()) schedule(m);
}

function stopAll() {
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
}

module.exports = {
  initMonitor,
  refreshMonitor,
  getCached,
  startAll,
  stopAll,
  rescheduleAll: startAll,
  CACHE_TTL_MS,
  INTERVAL_MINUTES,
};
