// 通用 API 订阅用量查询，结构与 api-balance 一致。
// 各周期百分比用 JSON 路径映射：monitor.auth.paths = { fiveHours, week, month }，缺省的周期不返回。
// minimax 已改为官网同步适配器（见 minimax.js），本文件只服务 custom-usage。
const { pickByPath, toNumber, requestJson } = require('./api-balance');

const PRESETS = {
  'custom-usage': { url: '' },
};

// 纯函数：按 paths 映射从响应里取各周期百分比
function parseUsageByPaths(resp, paths) {
  const p = paths || {};
  const periods = {};
  for (const key of ['fiveHours', 'week', 'month']) {
    if (!p[key]) continue;
    const raw = pickByPath(resp, p[key]);
    if (raw === undefined || raw === null || raw === '') continue;
    const n = toNumber(raw, p[key]);
    periods[key] = { percent: Math.max(0, Math.min(100, n)) };
  }
  if (Object.keys(periods).length === 0) {
    throw new Error('未能从响应解析出任何用量周期，请检查 auth.paths 配置');
  }
  return { periods };
}

async function fetchUsage(monitor) {
  const auth = monitor.auth || {};
  const preset = PRESETS[monitor.provider] || PRESETS['custom-usage'];
  const url = auth.baseUrl || preset.url;
  if (!url) {
    throw new Error(`未配置查询地址（auth.baseUrl）：${monitor.provider}`);
  }
  const headers = Object.assign({}, auth.headers);
  if (auth.apiKey && !Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${auth.apiKey}`;
  }
  const json = await requestJson(url, { method: (auth.method || 'GET').toUpperCase(), headers });
  return parseUsageByPaths(json, auth.paths);
}

module.exports = { kind: 'usage', supportedKinds: ['usage'], fetchUsage, parseUsageByPaths, PRESETS };
