// 余额历史记录：按 monitor id 存储余额快照（时间戳 + 余额），用于计算日/周消费。
// 数据存为 JSON 文件（userData/balance-history.json），纯 node 可测，不依赖 electron。
const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 90 * 24 * 3600 * 1000; // 保留 90 天
const FILE_NAME = 'balance-history.json';
// 相邻记录余额相同且间隔小于该值时跳过：interval 刷新可能每分钟产生一条相同余额，
// 不限制会快速膨胀文件并干扰"目标时刻最近快照"的选取。
const DEDUP_GAP_MS = 12 * 3600 * 1000;
// 目标时刻前后两条快照的跨度超过该值时视为数据不足（中间有大段空窗），不做估算。
const ESTIMATE_MAX_GAP_MS = 48 * 3600 * 1000;

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

// 记录一条余额快照（相邻同值且间隔小于 DEDUP_GAP_MS 时跳过，避免重复膨胀）
function record(id, balance) {
  ensureInit();
  if (typeof balance !== 'number' || !Number.isFinite(balance)) return;
  if (!data[id]) data[id] = [];
  const arr = data[id];
  const now = Date.now();
  const last = arr[arr.length - 1];
  if (last && last.balance === balance && now - last.ts < DEDUP_GAP_MS) return;
  arr.push({ ts: now, balance });
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

// 估算 targetMs 时刻的余额：用该时刻前后两条快照线性插值。
// 前后快照跨度超过 ESTIMATE_MAX_GAP_MS（中间有大段空窗）或任一侧缺失时返回 null，
// 避免把几天前/几天后的余额硬算成"目标时刻"的值（这是日/周消费算不准的主因）。
function estimateBalanceAt(arr, targetMs) {
  if (!arr || arr.length === 0) return null;
  const lastIdx = arr.length - 1;
  // 所有记录都在 target 之前（最新记录也比目标时刻早）→ 目标时刻之后没有观测，无法估算
  if (arr[lastIdx].ts <= targetMs) return null;
  // 所有记录都在 target 之后
  if (arr[0].ts > targetMs) return null;
  let lo = 0, hi = lastIdx;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid].ts <= targetMs) lo = mid; else hi = mid - 1;
  }
  const a = arr[lo];
  const b = arr[lo + 1];
  if (!b || b.ts - a.ts > ESTIMATE_MAX_GAP_MS) return null;
  const ratio = (targetMs - a.ts) / (b.ts - a.ts);
  return a.balance + (b.balance - a.balance) * ratio;
}

// 本地时区当天 0 点（自然日口径：0:00 到次日 0:00）
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 计算消费统计：返回 { dayDelta? }（正值=消费/减少，负值=充值）
// dayDelta = 今天 0 点估算余额 - 最新余额（自然日口径，而非滚动 24 小时）。
// 目标时刻附近无有效快照（数据不足）时字段缺省，界面不显示。
function computeStats(id) {
  const arr = getHistory(id);
  if (arr.length < 2) return {};
  const now = Date.now();
  const last = arr[arr.length - 1];
  const result = {};

  const dayBalance = estimateBalanceAt(arr, startOfDay(now));
  if (dayBalance !== null) result.dayDelta = dayBalance - last.balance;

  return result;
}

module.exports = { initHistory, record, getHistory, computeStats, findClosest, estimateBalanceAt, startOfDay };
