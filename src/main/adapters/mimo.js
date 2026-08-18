// MiMo 官网同步：基于 web-sync 引擎 + API 直取余额。
// 登录用小米账号（account.xiaomimimo.com），登录成功后用 session cookie 调 /api/v1/user/balance。
const websync = require('./web-sync');
const { requestJson, toNumber, normalizeCurrency } = require('./api-balance');

const PROVIDER = 'mimo';
const ORIGIN = 'https://platform.xiaomimimo.com';
const BALANCE_API = `${ORIGIN}/api/v1/user/balance`;

// 小米账号登录成功判定：落在 platform.xiaomimimo.com 任意页面（非登录页即可）
// 小米账号 OAuth 登录后回调 URL 可能是 /#/console/ 也可能是 /#/ 等，
// 用 isLoggedIn 函数做宽松判定比 successUrlPattern 更可靠。
function isLoggedIn(url, webContents) {
  try {
    const u = new URL(url);
    if (u.origin !== ORIGIN) return false;
    // 排除小米账号登录页本身
    if (u.hostname === 'account.xiaomimimo.com') return false;
    // 在 platform.xiaomimimo.com 的任何页面都算登录成功
    return true;
  } catch {
    return false;
  }
}

const preset = {
  provider: PROVIDER,
  supportedKinds: ['balance'],
  loginTitle: '登录 MiMo（小米账号）',
  loginUrl: `${ORIGIN}/`,
  origin: ORIGIN,
  isLoggedIn,
  // 不设 successUrlPattern，用 isLoggedIn 函数判定
  // 也不设 cookieName（小米 STS 用 httpOnly cookie，JS 读不到）
  buildExtractJs() {
    // 从 session 中提取所有 cookies，拼成 Cookie header 用于 API 调用
    return `(async function() {
      try {
        // 通过 document.cookie 获取非 httpOnly cookies
        const cookies = document.cookie || '';
        // 也在页面上找余额 DOM（SPA 余额页可能已渲染）
        const out = { amountCandidates: [], isLoginPage: false, url: location.href, cookies: cookies };

        // 检查是否在登录页
        out.isLoginPage = !!document.querySelector('input[type="password"]') ||
          location.hostname === 'account.xiaomimimo.com';

        if (out.isLoginPage) return out;

        // 尝试从页面 DOM 提取余额
        const els = document.querySelectorAll('span,p,div,td,dd,strong,em,h1,h2,h3,h4');
        const skip = 'nav,header,footer,aside';
        const seen = new Set();
        for (const el of els) {
          if (el.children.length > 3) continue;
          if (el.closest && el.closest(skip)) continue;
          const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
          if (!t || t.length > 60) continue;
          if (!/(余额|可用|剩余|balance|available|remain)/i.test(t)) continue;
          const m = t.match(/(¥|￥|\\$)?\\s*(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)/);
          if (m) {
            const num = parseFloat(m[2].replace(/,/g, ''));
            if (isFinite(num) && num >= 0) {
              const key = num + ':' + t.slice(0, 40);
              if (!seen.has(key)) {
                seen.add(key);
                out.amountCandidates.push({ label: t.slice(0, 80), amount: num, symbol: m[1] || '' });
              }
            }
          }
        }
        out.amountCandidates = out.amountCandidates.slice(0, 20);
        return out;
      } catch (e) {
        return { error: String(e), isLoginPage: false, amountCandidates: [] };
      }
    })()`;
  },
  parse(result, monitor) {
    // 先尝试 API 方式（用 cookies 调 /api/v1/user/balance）
    // 如果 DOM 提取到了候选，也作为 fallback
    if (result && result.apiBalance !== undefined) {
      return { balance: toNumber(result.apiBalance, 'balance'), currency: normalizeCurrency(monitor.currency) };
    }
    return websync.parseHeuristicResult(result, monitor);
  },
  shouldThrow: websync.heuristicShouldThrow,
  isReady(result, monitor) {
    if (!result || typeof result !== 'object' || result.isLoginPage) return false;
    if (result.apiBalance !== undefined) return true;
    return websync.heuristicIsReady(result, monitor);
  },
};

module.exports = websync.makeAdapter(preset);
