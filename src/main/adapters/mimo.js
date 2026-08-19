// MiMo 官网同步：小米账号登录 + 官方 API 直取余额。
// 登录成功后 session 写入 httpOnly cookie（api-platform_serviceToken / userId），
// 隐藏窗口同源请求 /api/v1/balance 会自动携带，无需手动拼接 Cookie。
// 接口与响应格式参考 CodexBar / opencode-quota 对 MiMo 官方 API 的实现。
const websync = require('./web-sync');

const PROVIDER = 'mimo';
const ORIGIN = 'https://platform.xiaomimimo.com';

// MiMo 官方 API 认证需要的两个 cookie（均 httpOnly）
const REQUIRED_COOKIES = ['api-platform_serviceToken', 'userId'];

// 登录成功判定：URL 落在 platform.xiaomimimo.com（非小米账号登录域），
// 且 session 中已写入 MiMo 登录凭证 cookie。
// - 不用纯 URL 判定：未登录时首页也可能停在 platform 域，会误判成功；
// - 不用 DOM 检查登录态：did-navigate 触发时 SPA 尚未渲染，会误判未登录。
async function isLoggedIn(url, webContents) {
  try {
    const u = new URL(url);
    if (u.origin !== ORIGIN) return false;
    if (u.hostname.includes('account.xiaomi')) return false;
    const hasAuth = async () => {
      const cookies = await webContents.session.cookies.get({ url: ORIGIN });
      const names = new Set(cookies.map((c) => c.name));
      return REQUIRED_COOKIES.every((n) => names.has(n));
    };
    if (await hasAuth()) return true;
    // OAuth 跳转后 cookie 可能稍晚写入，等 2s 再确认一次
    await new Promise((r) => setTimeout(r, 2000));
    return hasAuth();
  } catch {
    return false;
  }
}

// 页面内提取脚本：优先调官方 API（失败不影响），回退 DOM 关键词扫描。
const MIMO_EXTRACT_JS = `(async function() {
  const out = { amountCandidates: [], isLoginPage: false, url: location.href, title: document.title };
  try {
    try {
      // 官方 API：GET /api/v1/balance
      // 响应形如 { code: 0, data: { balance: "25.51", currency: "usd", cashBalance: "20", giftBalance: "5.51" } }
      const resp = await fetch('/api/v1/balance', {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'x-timeZone': 'UTC+08:00'
        }
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json && json.code === 0 && json.data && json.data.balance !== undefined && json.data.balance !== null && json.data.balance !== '') {
          const bal = parseFloat(json.data.balance);
          if (Number.isFinite(bal)) {
            const cur = String(json.data.currency || '').toLowerCase();
            return { balance: bal, currency: cur === 'usd' ? 'USD' : 'CNY', url: location.href, title: document.title };
          }
        } else if (json && (json.code === 401 || json.code === 403)) {
          // 登录过期 / 凭证无效：走"登录已过期"流程（清除凭证，提示重新登录）
          out.isLoginPage = true;
          return out;
        }
      }
    } catch (e) {
      // fetch 异常（网络/拦截）：忽略，继续 DOM 兜底
    }
    // API 不可用（网络拦截/接口变更等）时回退 DOM 关键词扫描：
    // 只收带"余额/可用/剩余"上下文的元素，排除"已用/赠送/充值"等干扰项。
    const appRoot = document.querySelector('#app') || document.body;
    const skip = 'nav,header,footer,aside,.nav,.sidebar,.header,.footer,.menu';
    const bad = /已用|花费|消耗|赠送|奖励|充值|优惠|本次|今日|本周|本月|小时|token|used|cost|spend|gift|reward|recharge|topup|coupon|request/i;
    const seen = new Set();
    const els = appRoot.querySelectorAll('span,p,div,td,dd,strong,em,h1,h2,h3,h4');
    for (const el of els) {
      if (el.children.length > 3) continue;
      if (el.closest && el.closest(skip)) continue;
      const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 60) continue;
      if (bad.test(t)) continue;
      if (!/(余额|可用|剩余|balance|available|remain)/i.test(t)) continue;
      const m = t.match(/(¥|￥|\\$)?\\s*(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)/);
      if (m) {
        const num = parseFloat(m[2].replace(/,/g, ''));
        if (isFinite(num) && num >= 0 && num < 1e9) {
          const key = num + ':' + t.slice(0, 40);
          if (!seen.has(key)) {
            seen.add(key);
            out.amountCandidates.push({ label: t.slice(0, 80), amount: num, symbol: m[1] || '' });
          }
        }
      }
    }
    out.amountCandidates = out.amountCandidates.slice(0, 20);
  } catch (e) {
    out.error = String(e);
  }
  return out;
})()`;

const preset = {
  provider: PROVIDER,
  supportedKinds: ['balance'],
  loginTitle: '登录 MiMo（小米账号）',
  loginUrl: `${ORIGIN}/`,
  origin: ORIGIN,
  targetUrl: `${ORIGIN}/#/console/balance`,
  isLoggedIn,
  buildExtractJs() {
    return MIMO_EXTRACT_JS;
  },
  parse: (result, monitor) => websync.parseHeuristicResult(result, monitor),
  shouldThrow: websync.heuristicShouldThrow,
  isReady: websync.heuristicIsReady,
};

module.exports = websync.makeAdapter(preset);
