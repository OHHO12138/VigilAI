// MiniMax 官方 API（调研自官方 CLI 仓库 MiniMax-AI/cli 源码）。
// usage：GET {baseUrl}/v1/token_plan/remains（Token Plan 订阅用量，5小时滚动窗口 + 每周，无 month）
// balance：GET {baseUrl}/account/query_balance（按量付费账户，sk-api- 开头的 key）
// 认证均为 Authorization: Bearer {apiKey}；baseUrl 可用 auth.baseUrl 覆盖（国际站 https://www.minimax.io）
const { requestJson, toNumber } = require('./api-balance');

const DEFAULT_BASE_URL = 'https://www.minimaxi.com';

// HTTP 200 但 base_resp.status_code !== 0 也是业务错误（1004 未登录 / 1008 余额不足等）
function checkBaseResp(resp) {
  const br = resp && resp.base_resp;
  if (br && typeof br.status_code === 'number' && br.status_code !== 0) {
    throw new Error(`MiniMax 错误 ${br.status_code}: ${br.status_msg || '未知错误'}`);
  }
}

// 单模型单周期已用百分比：status=3 无限制→0，status=2 已耗尽→100；
// total>0 用 usage/total；total=0 用 100-remaining_percent（weekly_boost_permille 放大系数不用）
function usedPercent(total, usage, remainingPercent, status) {
  if (status === 3) return 0;
  if (status === 2) return 100;
  if (typeof total === 'number' && total > 0 && typeof usage === 'number') {
    return (usage / total) * 100;
  }
  if (typeof remainingPercent === 'number') return 100 - remainingPercent;
  return null;
}

function clampPercent(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// 纯函数：token_plan/remains 响应 → {periods:{fiveHours, week}}（无 month；多模型各周期取 max）
function parseTokenPlan(resp) {
  checkBaseResp(resp);
  const models = resp && resp.model_remains;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('MiniMax 响应缺少 model_remains');
  }
  let five = null;
  let week = null;
  for (const m of models) {
    if (!m || typeof m !== 'object') continue;
    const i = usedPercent(
      m.current_interval_total_count,
      m.current_interval_usage_count,
      m.current_interval_remaining_percent,
      m.current_interval_status
    );
    if (i !== null) five = five === null ? i : Math.max(five, i);
    const w = usedPercent(
      m.current_weekly_total_count,
      m.current_weekly_usage_count,
      m.current_weekly_remaining_percent,
      m.current_weekly_status
    );
    if (w !== null) week = week === null ? w : Math.max(week, w);
  }
  const periods = {};
  if (five !== null) periods.fiveHours = { percent: clampPercent(five) };
  if (week !== null) periods.week = { percent: clampPercent(week) };
  if (Object.keys(periods).length === 0) {
    throw new Error('MiniMax 响应中没有可用的用量数据');
  }
  return { periods };
}

// 纯函数：query_balance 响应 → {balance, currency:'CNY'}（金额是 string）
function parseMinimaxBalance(resp) {
  checkBaseResp(resp);
  if (!resp || resp.available_amount === undefined || resp.available_amount === null) {
    throw new Error('MiniMax 响应缺少 available_amount');
  }
  return { balance: toNumber(resp.available_amount, 'available_amount'), currency: 'CNY' };
}

function buildUrl(monitor, path) {
  const auth = (monitor && monitor.auth) || {};
  const base = (auth.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return `${base}${path}`;
}

function buildHeaders(monitor) {
  const auth = (monitor && monitor.auth) || {};
  if (!auth.apiKey) throw new Error('未配置 MiniMax apiKey');
  const headers = Object.assign({}, auth.headers);
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${auth.apiKey}`;
  }
  return headers;
}

async function fetchUsage(monitor) {
  const json = await requestJson(buildUrl(monitor, '/v1/token_plan/remains'), { headers: buildHeaders(monitor) });
  return parseTokenPlan(json);
}

async function fetchBalance(monitor) {
  const json = await requestJson(buildUrl(monitor, '/account/query_balance'), { headers: buildHeaders(monitor) });
  return parseMinimaxBalance(json);
}

module.exports = {
  kind: 'usage',
  supportedKinds: ['usage', 'balance'],
  fetchUsage,
  fetchBalance,
  parseTokenPlan,
  parseMinimaxBalance,
  usedPercent,
  DEFAULT_BASE_URL,
};
