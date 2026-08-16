// config.json（外观/窗口/语言）+ monitors.json（监控项 CRUD）读写。
// 关键约束：本文件不得顶层 require('electron')，目录通过 initConfig(dir) 注入，保证纯 node 可测。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONFIG = {
  alwaysOnTop: true,
  opacity: 0.92,
  x: null,
  y: null,
  width: 420,
  height: 580,
  layoutMode: 'vertical',
  locale: 'zh',
  appearance: {
    borderWidth: 8,
    bgColor: 'rgba(24, 24, 27, 0.88)',
    cardBgColor: 'rgba(39, 39, 42, 0.86)',
    ringTrackColor: 'rgba(255, 255, 255, 0.10)',
    ringUsedColor: 'rgba(250, 250, 250, 0.95)',
    fontColor: '#FAFAFA',
    fontSize: 11,
  },
  alert: {
    mode: 'dot',
    threshold1: 50,
    threshold2: 85,
    balanceThreshold1: 50, // 余额预警：安全/关注分界（余额 ≥ 此值为安全），必须大于 balanceThreshold2
    balanceThreshold2: 20, // 余额预警：关注/危险分界（余额低于此值为危险）
    colors: { safe: '#7ed6a5', warning: '#e6c860', danger: '#e06c75' },
    images: { safe: '', warning: '', danger: '' },
  },
};

let configPath = null;
let monitorsPath = null;
let configState = null;
let monitorsState = null;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// 深合并：对象递归，数组/原始值直接替换
function deepMerge(base, patch) {
  const out = Object.assign({}, base);
  for (const key of Object.keys(patch || {})) {
    const sv = patch[key];
    if (isPlainObject(sv) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], sv);
    } else if (isPlainObject(sv)) {
      out[key] = deepMerge({}, sv);
    } else {
      out[key] = sv;
    }
  }
  return out;
}

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error('Failed to read json:', file, e);
  }
  return fallback;
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write json:', file, e);
  }
}

function ensureInit() {
  if (!configState) throw new Error('config not initialized: call initConfig(dir) first');
}

function initConfig(dir) {
  configPath = path.join(dir, 'config.json');
  monitorsPath = path.join(dir, 'monitors.json');
  configState = deepMerge(DEFAULT_CONFIG, readJson(configPath, {}));
  const raw = readJson(monitorsPath, { monitors: [] });
  monitorsState = Array.isArray(raw.monitors) ? raw.monitors : [];
}

function getConfig() {
  ensureInit();
  return configState;
}

function patchConfig(patch) {
  ensureInit();
  configState = deepMerge(configState, patch || {});
  writeJson(configPath, configState);
  return configState;
}

function saveMonitors() {
  writeJson(monitorsPath, { monitors: monitorsState });
}

function listMonitors() {
  ensureInit();
  return monitorsState;
}

function getMonitor(id) {
  ensureInit();
  return monitorsState.find((m) => m.id === id) || null;
}

function addMonitor(data = {}) {
  ensureInit();
  const now = Date.now();
  const monitor = deepMerge(
    {
      kind: 'usage',
      name: '',
      provider: '',
      enabled: true,
      refresh: { mode: 'manual', minutes: 5 },
      auth: { apiKey: '', baseUrl: '', siteUrl: '' },
      currency: 'CNY',
    },
    data
  );
  monitor.id = crypto.randomUUID();
  monitor.createdAt = now;
  monitor.updatedAt = now;
  monitorsState.push(monitor);
  saveMonitors();
  return monitor;
}

function updateMonitor(id, patch = {}) {
  ensureInit();
  const idx = monitorsState.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  const merged = deepMerge(monitorsState[idx], patch);
  // 显式传 null 的字段表示删除（用于清除单 monitor 的预警覆盖等可选覆盖项）
  for (const k of Object.keys(patch)) {
    if (patch[k] === null) delete merged[k];
  }
  merged.id = monitorsState[idx].id;
  merged.createdAt = monitorsState[idx].createdAt;
  merged.updatedAt = Date.now();
  monitorsState[idx] = merged;
  saveMonitors();
  return merged;
}

function removeMonitor(id) {
  ensureInit();
  const before = monitorsState.length;
  monitorsState = monitorsState.filter((m) => m.id !== id);
  if (monitorsState.length === before) return false;
  saveMonitors();
  return true;
}

// 按 ids 顺序重排监控项；ids 必须与当前监控项一一对应（无缺漏/重复/未知 id），
// 不合法时不做任何修改并返回 null。排序会持久化到 monitors.json，主页按此顺序渲染。
function reorderMonitors(ids) {
  ensureInit();
  if (!Array.isArray(ids) || ids.length !== monitorsState.length) return null;
  const seen = new Set();
  const byId = new Map();
  for (const m of monitorsState) byId.set(m.id, m);
  const next = [];
  for (const id of ids) {
    if (!byId.has(id) || seen.has(id)) return null;
    seen.add(id);
    next.push(byId.get(id));
  }
  monitorsState = next;
  saveMonitors();
  return monitorsState;
}

module.exports = {
  initConfig,
  getConfig,
  patchConfig,
  listMonitors,
  getMonitor,
  addMonitor,
  updateMonitor,
  removeMonitor,
  reorderMonitors,
  deepMerge,
  DEFAULT_CONFIG,
};
