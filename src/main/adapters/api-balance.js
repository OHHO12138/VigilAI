// 通用 API 余额查询 + 厂商预设。只用全局 fetch（Node 18+），无第三方依赖。
// deepseek / kimi 为已确认预设；custom-balance 走完全自定义：
// auth.baseUrl（完整查询 URL）+ auth.balancePath（JSON 路径）+ auth.method/headers。
// volcengine（签名 OpenAPI）有独立适配器，不在本文件。

const DEFAULT_TIMEOUT_MS = 20000;

// ---- 查询 URL 安全校验（SSRF 入口防护）----
// requestConfiguredJson 的 URL 来自用户配置（monitors.json）：仅允许 http/https，
// 默认拒绝 localhost/环回/私有/保留地址；局域网自建中转站等场景
// 由调用方传 allowPrivateHost: true（monitor.auth.allowPrivateHost）显式放行。

// 纯函数：IPv4 点分十进制是否为内网/保留段（非法地址也按不放行处理）
function isPrivateIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // 未指定/私有/环回
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // 组播与保留段
  return false;
}

// 纯函数：主机名（含 IPv4/IPv6 字面量）是否为内网/保留地址
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateIPv4(h);
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true; // 未指定/环回
    if (/^f[cd]/.test(h)) return true; // fc00::/7 唯一本地
    if (/^fe[89ab]/.test(h)) return true; // fe80::/10 链路本地
    return false;
  }
  return false;
}

// 纯函数：URL 合法性校验，不合法直接抛错（协议白名单 + 内网地址默认拒绝）
function assertUrlAllowed(rawUrl, allowPrivate) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`无效的查询 URL：${rawUrl}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`不支持的协议 ${u.protocol}：仅允许 http/https`);
  }
  if (!allowPrivate && isPrivateHost(u.hostname)) {
    throw new Error(`拒绝访问内网/保留地址 ${u.hostname}（如需监控局域网自建服务，请在该监控项配置中设置 allowPrivateHost: true）`);
  }
}

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

async function requestConfiguredJson(url, { method = 'GET', headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, allowPrivateHost = false } = {}) {
  assertUrlAllowed(url, allowPrivateHost === true);
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

// 纯函数：zhipu 响应 → { balance, currency }
// 接口是控制台同款（/api/biz/account/query-customer-account-report），非官方公开 API，
// Bearer API Key 即可调用；余额取 data.balance，缺失时回落 data.availableBalance。
function parseZhipu(resp, currency) {
  const data = resp && resp.data;
  if (!resp || resp.code !== 200 || resp.success !== true || !data || typeof data !== 'object') {
    throw new Error(`智谱响应错误：${(resp && (resp.msg || resp.error && resp.error.message)) || '未知错误'}`);
  }
  const value = data.balance !== undefined && data.balance !== null ? data.balance : data.availableBalance;
  return { balance: toNumber(value, 'data.balance'), currency: normalizeCurrency(currency) };
}

// 纯函数：siliconflow 响应 → { balance, currency }
// /v1/user/info 单位为元：totalBalance = 充值余额 + 赠送余额，取总余额，缺失时回落 balance。
function parseSiliconflow(resp, currency) {
  const data = resp && resp.data;
  if (!resp || resp.status !== true || !data || typeof data !== 'object') {
    throw new Error(`SiliconFlow 响应错误：${(resp && resp.message) || '未知错误'}`);
  }
  const value = data.totalBalance !== undefined && data.totalBalance !== null ? data.totalBalance : data.balance;
  return { balance: toNumber(value, 'data.totalBalance'), currency: normalizeCurrency(currency) };
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
  zhipu: { url: 'https://open.bigmodel.cn/api/biz/account/query-customer-account-report', parse: parseZhipu },
  siliconflow: { url: 'https://api.siliconflow.cn/v1/user/info', parse: parseSiliconflow },
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
  const json = await requestConfiguredJson(req.url, {
    method: req.method,
    headers: req.headers,
    allowPrivateHost: (monitor.auth || {}).allowPrivateHost === true,
  });
  if (preset.parse) return preset.parse(json, monitor.currency);
  return parseByPath(json, (monitor.auth || {}).balancePath, monitor.currency);
}

module.exports = {
  kind: 'balance',
  supportedKinds: ['balance'],
  fetchBalance,
  pickByPath,
  toNumber,
  requestConfiguredJson,
  assertUrlAllowed,
  isPrivateHost,
  isPrivateIPv4,
  parseDeepseek,
  parseKimi,
  parseZhipu,
  parseSiliconflow,
  parseByPath,
  normalizeCurrency,
  PRESETS,
};
