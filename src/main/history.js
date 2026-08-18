// 余额历史记录：按 monitor id 存储余额快照（时间戳 + 余额），用于计算日/周消费。
// 数据存为 JSON 文件（userData/balance-history.json），纯 node 可测，不依赖 electron。
const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 90 * 24 * 3600 * 1000; // 保留 90 天
const FILE_NAME = 'balance-history.json';

let filePath = null;
let data = {}; // { monitorId: [{ ts, balance }] }

function initHistory(dir) {
  filePath = path.join(dir, FILE_NAME);
  try {
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) || {};
    }
  } catch {
    data = {};
  }
}

function ensureInit() {
  if (!filePath) throw new Error('history not initialized: call initHistory(dir) first');
}

function save() {
  ensureInit();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  } catch (e) {
    console.error('[history] Failed to save:', e);
  }
}

// 记录一条余额快照
function record(id, balance) {
  ensureInit();
  if (typeof balance !== 'number' || !Number.isFinite(balance)) return;
  if (!data[id]) data[id] = [];
  const arr = data[id];
  arr.push({ ts: Date.now(), balance });
  // 裁剪过期数据（从头扫描，找到第一个未过期的位置，一次性截断）
  const cutoff = Date.now() - MAX_AGE_MS;
  const keep = arr.findIndex((e) => e.ts >= cutoff);
  if (keep > 0) arr.splice(0, keep);
  // 限制最大条数（90 天，每分钟一条 = ~130k，取安全上限 50000）
  if (arr.length > 50000) arr.splice(0, arr.length - 50000);
  save();
}

// 获取某 id 的历史记录（只读副本）
function getHistory(id) {
  return data[id] || [];
}

// 找到距离目标时间最近的快照（≤targetMs 内最接近的那条）
function findClosest(arr, targetMs) {
  if (!arr || arr.length === 0) return null;
  let lo = 0, hi = arr.length - 1;
  // 所有记录都在目标时间之后
  if (arr[0].ts > targetMs) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid].ts <= targetMs) lo = mid; else hi = mid - 1;
  }
  return arr[lo];
}

// 计算消费统计：返回 { dayDelta?, weekDelta? }（正值=消费/减少，负值=充值）
function computeStats(id) {
  const arr = getHistory(id);
  if (arr.length < 2) return {};
  const now = Date.now();
  const result = {};

  // 24 小时前的余额
  const dayTarget = now - 24 * 3600 * 1000;
  const dayEntry = findClosest(arr, dayTarget);
  if (dayEntry && dayEntry.ts < arr[arr.length - 1].ts) {
    result.dayDelta = dayEntry.balance - arr[arr.length - 1].balance;
    result.dayFromTs = dayEntry.ts;
  }

  // 7 天前的余额
  const weekTarget = now - 7 * 24 * 3600 * 1000;
  const weekEntry = findClosest(arr, weekTarget);
  if (weekEntry && weekEntry.ts < arr[arr.length - 1].ts) {
    result.weekDelta = weekEntry.balance - arr[arr.length - 1].balance;
    result.weekFromTs = weekEntry.ts;
  }

  return result;
}

module.exports = { initHistory, record, getHistory, computeStats, findClosest };
