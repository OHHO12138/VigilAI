// 通用官网同步引擎：登录窗口存凭证 + 隐藏窗口抓页面执行提取脚本。
// 各厂商预设（如 opencode-go）以 preset 配置接入，electron 延迟 require，纯函数部分可测。
//
// preset 配置：
// {
//   provider,                          // 决定 session partition 与凭证文件名
//   supportedKinds: ['usage','balance'],
//   loginUrl, loginTitle,
//   successUrlPattern: RegExp,         // did-navigate 命中即视为登录成功（或用 isLoggedIn(url, webContents)）
//   captureFromUrl(url) → object|null, // 从命中 URL 提取标识（如 workspaceId）
//   captureJs,                         // 可选：登录成功后在页面执行，抓取额外标识
//   origin + cookieName,               // 可选：登录成功后存指定 cookie（safeStorage 加密）
//   captureFile,                       // 可选：capture JSON 文件名（默认 websync-{provider}-capture.json）
//   targetUrl(capture, monitor) → url, // 可用 monitor.auth.targetUrl 覆盖
//   buildExtractJs(monitor) → js,      // 可用 monitor.auth.extractJs 覆盖
//   shouldThrow(result) → Error|null,  // 轮询中提前终止（如登录过期）
//   isReady(result, monitor) → bool,   // 脚本返回是否可用
//   parse(result, monitor) → data,     // 纯函数：提取结果 → {periods} 或 {balance,currency}
// }
const fs = require('fs');
const path = require('path');
const { normalizeCurrency } = require('./api-balance');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30000;
const POLL_MAX = 30;
const POLL_INTERVAL_MS = 1000;

function electron() {
  return require('electron');
}

function userDataDir(ctx) {
  const app = (ctx && ctx.app) || electron().app;
  return app.getPath('userData');
}

function storage(ctx) {
  return (ctx && ctx.safeStorage) || electron().safeStorage;
}

function partitionOf(preset) {
  return preset.partition || `persist:planusage-${preset.provider}`;
}

function cookieFile(preset, ctx) {
  return path.join(userDataDir(ctx), `${preset.provider}-auth.enc`);
}

function captureFile(preset, ctx) {
  return path.join(userDataDir(ctx), preset.captureFile || `websync-${preset.provider}-capture.json`);
}

function readCapture(preset, ctx) {
  try {
    const file = captureFile(preset, ctx);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(`[${preset.provider}] Failed to read capture:`, e);
  }
  return null;
}

function saveCapture(preset, capture, ctx) {
  try {
    fs.writeFileSync(captureFile(preset, ctx), JSON.stringify(capture, null, 2), 'utf-8');
  } catch (e) {
    console.error(`[${preset.provider}] Failed to save capture:`, e);
  }
}

function readCookie(preset, ctx) {
  try {
    const file = cookieFile(preset, ctx);
    if (!fs.existsSync(file)) return null;
    const safe = storage(ctx);
    if (!safe.isEncryptionAvailable()) return null;
    return safe.decryptString(fs.readFileSync(file)) || null;
  } catch (e) {
    console.error(`[${preset.provider}] Failed to decrypt cookie:`, e);
    return null;
  }
}

function saveCookie(preset, value, ctx) {
  try {
    const safe = storage(ctx);
    if (!safe.isEncryptionAvailable()) return false;
    fs.writeFileSync(cookieFile(preset, ctx), safe.encryptString(value));
    return true;
  } catch (e) {
    console.error(`[${preset.provider}] Failed to save cookie:`, e);
    return false;
  }
}

function hasAuth(preset, ctx) {
  // 存 cookie 的厂商以 cookie 为准；其余以 capture 文件为准（session partition 本身持久化登录态）
  return preset.cookieName ? !!readCookie(preset, ctx) : !!readCapture(preset, ctx);
}

function clearAuth(preset, ctx) {
  try {
    const cf = cookieFile(preset, ctx);
    if (fs.existsSync(cf)) fs.unlinkSync(cf);
    const capf = captureFile(preset, ctx);
    if (fs.existsSync(capf)) fs.unlinkSync(capf);
  } catch (e) {
    console.error(`[${preset.provider}] Failed to clear auth:`, e);
  }
}

// ---- 登录 ----

const loginStates = new Map(); // provider → 是否正在登录

function login(preset, ctx) {
  if (loginStates.get(preset.provider)) return Promise.reject(new Error('登录正在进行中'));
  loginStates.set(preset.provider, true);
  const { BrowserWindow } = electron();

  return new Promise((resolve, reject) => {
    let parent;
    try {
      parent = require('../window').getMainWindow() || undefined;
    } catch {
      parent = undefined;
    }

    const win = new BrowserWindow({
      width: 560,
      height: 760,
      resizable: true,
      show: true,
      alwaysOnTop: true,
      parent,
      title: preset.loginTitle || `登录 ${preset.provider}`,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: partitionOf(preset),
        webSecurity: true,
      },
    });

    // 伪装标准 Chrome UA，避免官网拦截 Electron
    win.webContents.setUserAgent(CHROME_UA);
    win.webContents.session.setUserAgent(CHROME_UA);
    win.focus();
    win.loadURL(preset.loginUrl);

    let settled = false;
    const finish = (err, capture) => {
      if (settled) return;
      settled = true;
      loginStates.delete(preset.provider);
      clearTimeout(timeout);
      if (!win.isDestroyed()) {
        try {
          win.destroy();
        } catch {
          // ignore
        }
      }
      if (err) reject(err);
      else resolve({ success: true, capture });
    };

    const timeout = setTimeout(() => finish(new Error('登录超时，请重新尝试')), LOGIN_TIMEOUT_MS);

    const onNavigate = async (_event, url) => {
      try {
        if (settled || win.isDestroyed()) return;
        let matched = preset.isLoggedIn
          ? await preset.isLoggedIn(url, win.webContents)
          : !!(preset.successUrlPattern && preset.successUrlPattern.test(url));

        // 宽松兜底：配置了 origin+cookieName 时，落在官网任意非 /auth 页面且 cookie 已写入也算成功
        // （有些站点登录后落点不是固定路径，如 opencode 可能落到首页而非 /workspace/xxx）
        if (!matched && preset.cookieName && preset.origin && url.startsWith(preset.origin)) {
          const path = new URL(url).pathname;
          if (!path.startsWith('/auth')) {
            const cookies = await win.webContents.session.cookies.get({ url: preset.origin, name: preset.cookieName });
            matched = cookies.some((x) => x.name === preset.cookieName && x.value);
          }
        }
        if (!matched) return;

        let capture = {};
        if (preset.captureFromUrl) capture = preset.captureFromUrl(url) || {};
        if (preset.captureJs) {
          const extra = await win.webContents.executeJavaScript(preset.captureJs);
          if (extra && typeof extra === 'object') capture = Object.assign(capture, extra);
        }
        capture.loggedInAt = Date.now();

        if (preset.cookieName && preset.origin) {
          const grab = async () => {
            const cookies = await win.webContents.session.cookies.get({ url: preset.origin, name: preset.cookieName });
            const c = cookies.find((x) => x.name === preset.cookieName);
            return c && c.value ? `${c.name}=${c.value}` : null;
          };
          const value = await grab();
          if (value) {
            saveCookie(preset, value, ctx);
            saveCapture(preset, capture, ctx);
            finish(null, capture);
          } else {
            // 部分重定向链下 cookie 稍后才写入，再等 2s
            setTimeout(async () => {
              if (settled || win.isDestroyed()) return;
              const value2 = await grab();
              if (value2) {
                saveCookie(preset, value2, ctx);
                saveCapture(preset, capture, ctx);
                finish(null, capture);
              } else {
                finish(new Error('登录成功但未找到凭证 cookie'));
              }
            }, 2000);
          }
        } else {
          saveCapture(preset, capture, ctx);
          finish(null, capture);
        }
      } catch (e) {
        console.error(`[${preset.provider}] Error during login navigation:`, e);
      }
    };

    win.webContents.on('did-navigate', onNavigate);
    win.webContents.on('did-navigate-in-page', onNavigate); // SPA 站内跳转

    win.on('closed', () => {
      if (!settled) {
        settled = true;
        loginStates.delete(preset.provider);
        clearTimeout(timeout);
        reject(new Error('登录窗口已关闭'));
      }
    });
  });
}

// ---- 抓取 ----

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultIsReady(result) {
  return result !== null && result !== undefined && result !== '';
}

async function fetchPage(preset, monitor, ctx) {
  const auth = (monitor && monitor.auth) || {};
  const capture = readCapture(preset, ctx);
  const url =
    auth.targetUrl || (typeof preset.targetUrl === 'function' ? preset.targetUrl(capture, monitor) : preset.targetUrl);
  if (!url) throw new Error(`${preset.provider}: 未配置抓取地址（auth.targetUrl）`);
  const extractJs = auth.extractJs || preset.buildExtractJs(monitor);
  const isReady = preset.isReady || defaultIsReady;
  const { BrowserWindow } = electron();

  return new Promise((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 900,
      height: 700,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: partitionOf(preset),
        webSecurity: true,
      },
    });
    win.webContents.setUserAgent(CHROME_UA);

    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!win.isDestroyed()) {
        try {
          win.destroy();
        } catch {
          // ignore
        }
      }
      if (err) reject(err);
      else resolve(data);
    };

    const timeout = setTimeout(
      () => finish(new Error(`${preset.provider}: 抓取超时（${FETCH_TIMEOUT_MS / 1000}s）`)),
      FETCH_TIMEOUT_MS
    );

    win.webContents.on('did-fail-load', (_event, code, desc, validatedURL) => {
      finish(new Error(`加载失败 ${validatedURL}: ${code} ${desc}`));
    });

    win.webContents.on('did-finish-load', async () => {
      try {
        for (let i = 0; i < POLL_MAX; i++) {
          const result = await win.webContents.executeJavaScript(extractJs);
          if (preset.shouldThrow) {
            const err = preset.shouldThrow(result, monitor);
            if (err) throw err;
          }
          if (isReady(result, monitor)) {
            finish(null, preset.parse(result, monitor));
            return;
          }
          await sleep(POLL_INTERVAL_MS);
        }
        throw new Error(
          `${preset.provider}: 页面加载后 ${POLL_MAX}s 内未提取到数据，可在设置中自定义提取脚本（auth.extractJs）或检查 auth.targetUrl`
        );
      } catch (err) {
        finish(err);
      }
    });

    win.loadURL(url);
  });
}

// ---- 适配器工厂 ----

function makeAdapter(preset) {
  const checkKind = (monitor) => {
    const kind = monitor.kind === 'balance' ? 'balance' : 'usage';
    if (!preset.supportedKinds.includes(kind)) {
      throw new Error(`适配器 ${preset.provider} 不支持 ${kind} 类型`);
    }
  };
  return {
    kind: preset.supportedKinds[0], // 兼容字段，主类型
    supportedKinds: preset.supportedKinds,
    fetchUsage: (monitor, ctx) => {
      checkKind(monitor);
      return fetchPage(preset, monitor, ctx);
    },
    fetchBalance: (monitor, ctx) => {
      checkKind(monitor);
      return fetchPage(preset, monitor, ctx);
    },
    login: (ctx) => login(preset, ctx),
    hasAuth: (ctx) => hasAuth(preset, ctx),
    clearAuth: (ctx) => clearAuth(preset, ctx),
    preset,
  };
}

// ---- 通用启发式提取（页面内脚本收集候选 + 纯函数归类，供后续预设复用）----
// 页面内脚本只负责收集候选：带上下文的百分比、带上下文的金额、是否登录页。
// 归类/取值逻辑在下面的纯函数里，方便单测。

const HEURISTIC_EXTRACT_JS = `(function() {
  const out = { percentCandidates: [], amountCandidates: [], isLoginPage: false, url: location.href, title: document.title };
  try {
    out.isLoginPage = !!document.querySelector('input[type="password"]');
    const seen = new Set();
    const els = document.querySelectorAll('body *');
    for (const el of els) {
      if (el.children.length > 3) continue;
      const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 60) continue;
      const prev = el.previousElementSibling ? el.previousElementSibling.textContent : '';
      const parent = el.parentElement ? el.parentElement.textContent : '';
      const label = (prev + ' ' + parent).replace(/\\s+/g, ' ').trim().slice(0, 80);
      const pm = t.match(/(\\d{1,3}(?:\\.\\d+)?)\\s*%/);
      if (pm) {
        const key = 'p:' + label + ':' + pm[1];
        if (!seen.has(key)) {
          seen.add(key);
          out.percentCandidates.push({ label: label, value: parseFloat(pm[1]) });
        }
        continue;
      }
      if (/(余额|可用|现金|balance|available|cash)/i.test(t + ' ' + label)) {
        const am = t.match(/(¥|￥|\\$|US\\$|RMB|CNY|USD)?\\s*(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)/);
        if (am) {
          const num = parseFloat(am[2].replace(/,/g, ''));
          if (isFinite(num)) {
            const key = 'a:' + label + ':' + num;
            if (!seen.has(key)) {
              seen.add(key);
              out.amountCandidates.push({ label: (t + ' ' + label).slice(0, 80), amount: num, symbol: am[1] || '' });
            }
          }
        }
      }
    }
    out.percentCandidates = out.percentCandidates.slice(0, 50);
    out.amountCandidates = out.amountCandidates.slice(0, 50);
  } catch (e) {
    out.error = String(e);
  }
  return out;
})()`;

function clampPercent(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// 纯函数：百分比候选 → periods。label 含 5小时/5h → fiveHours，周/week → week，月/month → month
function parseUsageCandidates(candidates) {
  if (!Array.isArray(candidates)) return null;
  const rules = [
    ['fiveHours', /(五\s*小时|5\s*个?\s*小时|5\s*-?\s*h(ours?)?\b)/i],
    ['week', /(周|星期|week(ly)?)/i],
    ['month', /(月|month(ly)?)/i],
  ];
  const periods = {};
  for (const [key, re] of rules) {
    const hit = candidates.find((c) => c && typeof c.value === 'number' && re.test(c.label || ''));
    if (hit) periods[key] = { percent: clampPercent(hit.value) };
  }
  return Object.keys(periods).length ? { periods } : null;
}

// 纯函数：金额候选 → {balance, currency}。优先"可用"，其次"余额/balance"
function parseBalanceCandidates(candidates, currencyHint) {
  if (!Array.isArray(candidates)) return null;
  const score = (c) => {
    const label = c.label || '';
    if (/可用/.test(label)) return 0;
    if (/余额/.test(label)) return 1;
    if (/(available|balance)/i.test(label)) return 2;
    return 3;
  };
  const sorted = candidates.filter((c) => c && typeof c.amount === 'number').sort((a, b) => score(a) - score(b));
  const hit = sorted[0];
  if (!hit) return null;
  const currency = /(\$|US\$|USD)/i.test(hit.symbol || '') ? 'USD' : normalizeCurrency(currencyHint);
  return { balance: hit.amount, currency };
}

// 纯函数：启发式/自定义 extractJs 结果 → 标准数据。
// 自定义脚本可直接返回 {fiveHours,week,month}（usage）或 {balance,currency?}（balance）
function parseHeuristicResult(result, monitor) {
  if (!result || typeof result !== 'object') return null;
  if (monitor.kind === 'balance') {
    if (typeof result.balance === 'number' && Number.isFinite(result.balance)) {
      return { balance: result.balance, currency: result.currency || normalizeCurrency(monitor.currency) };
    }
    return parseBalanceCandidates(result.amountCandidates, monitor.currency);
  }
  const direct = {};
  for (const k of ['fiveHours', 'week', 'month']) {
    if (typeof result[k] === 'number' && Number.isFinite(result[k])) direct[k] = { percent: clampPercent(result[k]) };
  }
  if (Object.keys(direct).length) return { periods: direct };
  return parseUsageCandidates(result.percentCandidates);
}

// 启发式预设共用的轮询判定：登录页提前报错；有任一类候选或直给数值即可解析
function heuristicShouldThrow(result) {
  return result && result.isLoginPage ? new Error('登录已过期或未完成登录，请重新执行官网同步登录') : null;
}

function heuristicIsReady(result, monitor) {
  if (!result || typeof result !== 'object' || result.isLoginPage) return false;
  if (monitor.kind === 'balance') {
    return typeof result.balance === 'number' || (result.amountCandidates || []).length > 0;
  }
  return ['fiveHours', 'week', 'month'].some((k) => typeof result[k] === 'number') ||
    (result.percentCandidates || []).length > 0;
}

module.exports = {
  makeAdapter,
  login,
  fetchPage,
  hasAuth,
  clearAuth,
  readCapture,
  saveCapture,
  HEURISTIC_EXTRACT_JS,
  parseUsageCandidates,
  parseBalanceCandidates,
  parseHeuristicResult,
  heuristicShouldThrow,
  heuristicIsReady,
  clampPercent,
  CHROME_UA,
};
