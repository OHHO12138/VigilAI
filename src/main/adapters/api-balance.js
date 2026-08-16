// 通用 API 余额查询 + 厂商预设。只用全局 fetch（Node 18+），无第三方依赖。
// deepseek / kimi 为已确认预设；custom-balance 走完全自定义：
// auth.baseUrl（完整查询 URL）+ auth.balancePath（JSON 路径）+ auth.method/headers。
// volcengine（签名 OpenAPI）有独立适配器，不在本文件。

const DEFAULT_TIMEOUT_MS = 20000;

// 纯函数：按 "a.b.c" 路径取值
function pickByPath(obj, path) {
  if (!path || typeof path !== 'string') return undefined;
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

function toNumber(value, label) {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new Error(`无法解析数字：${label} = ${JSON.stringify(value)}`);
  return n;
}

async function requestJson(url, { method = 'GET', headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetch !== 'function') throw new Error('当前运行环境不支持全局 fetch（需要 Node 18+）');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`请求失败 HTTP ${res.status}：${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('响应不是有效 JSON');
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// schema 里 currency 允许 RMB | USD，deepseek 返回的是 CNY | USD
function normalizeCurrency(c) {
  return c === 'RMB' ? 'CNY' : c || 'CNY';
}

// 纯函数：deepseek 响应 → { balance, currency }
function parseDeepseek(resp, currency) {
  const infos = resp && resp.balance_infos;
  if (!Array.isArray(infos) || infos.length === 0) {
    throw new Error('DeepSeek 响应缺少 balance_infos');
  }
  const want = normalizeCurrency(currency);
  const hit = infos.find((i) => i && i.currency === want) || infos[0];
  return { balance: toNumber(hit.total_balance, 'total_balance'), currency: hit.currency || want };
}

// 纯函数：kimi 响应 → { balance, currency }
function parseKimi(resp) {
  if (!resp || resp.code !== 0 || !resp.data) {
    throw new Error(`Kimi 响应错误：${(resp && resp.message) || '未知错误'}`);
  }
  return { balance: toNumber(resp.data.available_balance, 'available_balance'), currency: 'CNY' };
}

// 纯函数：通用 JSON 路径解析（volcengine / custom-balance）
function parseByPath(resp, balancePath, currency) {
  if (!balancePath) throw new Error('未配置余额解析路径（auth.balancePath）');
  const value = pickByPath(resp, balancePath);
  if (value === undefined || value === null) {
    throw new Error(`路径 ${balancePath} 在响应中不存在`);
  }
  return { balance: toNumber(value, balancePath), currency: normalizeCurrency(currency) };
}

const PRESETS = {
  deepseek: { url: 'https://api.deepseek.com/user/balance', parse: parseDeepseek },
  kimi: { url: 'https://api.moonshot.cn/v1/users/me/balance', parse: parseKimi },
  'custom-balance': { url: '', parse: null },
};

function buildRequest(monitor, preset) {
  const auth = monitor.auth || {};
  const url = auth.baseUrl || preset.url;
  if (!url) throw new Error(`未配置查询地址（auth.baseUrl）：${monitor.provider}`);
  const headers = Object.assign({}, auth.headers);
  if (auth.apiKey && !Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${auth.apiKey}`;
  }
  return { url, method: (auth.method || 'GET').toUpperCase(), headers };
}

async function fetchBalance(monitor) {
  const preset = PRESETS[monitor.provider] || PRESETS['custom-balance'];
  const req = buildRequest(monitor, preset);
  const json = await requestJson(req.url, { method: req.method, headers: req.headers });
  if (preset.parse) return preset.parse(json, monitor.currency);
  return parseByPath(json, (monitor.auth || {}).balancePath, monitor.currency);
}

module.exports = {
  kind: 'balance',
  supportedKinds: ['balance'],
  fetchBalance,
  pickByPath,
  toNumber,
  requestJson,
  parseDeepseek,
  parseKimi,
  parseByPath,
  normalizeCurrency,
  PRESETS,
};
