// MiMo 官网同步：基于 web-sync 引擎 + MiMo 余额页专用提取脚本。
// 专用脚本聚焦余额页核心区域，排除导航/侧栏干扰，比通用启发式更稳定。
const websync = require('./web-sync');

// MiMo 余额页专用提取：聚焦 #app 主内容区，排除 header/sidebar/nav 干扰
const MIMO_EXTRACT_JS = `(function() {
  const out = { amountCandidates: [], isLoginPage: false, url: location.href, title: document.title };
  try {
    out.isLoginPage = !!document.querySelector('input[type="password"]');
    if (out.isLoginPage) return out;

    // 等待 SPA 内容渲染（Vue/React 框架）
    const appRoot = document.querySelector('#app') || document.querySelector('[id="app"]') || document.body;

    // 策略1：查找常见余额展示容器（class/id 含 balance/remain/available/amount/billing/credit）
    const containers = appRoot.querySelectorAll(
      '[class*="balance" i],[class*="remain" i],[class*="available" i],' +
      '[class*="amount" i],[class*="billing" i],[class*="credit" i],' +
      '[class*="quota" i],[class*="usage" i],[class*="summary" i],' +
      '[id*="balance" i],[id*="remain" i],[id*="available" i]'
    );

    const seen = new Set();
    for (const c of containers) {
      const t = (c.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 80) continue;
      const m = t.match(/(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)/);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ''));
        if (isFinite(num) && num > 0) {
          const key = num + ':' + t.slice(0, 40);
          if (!seen.has(key)) {
            seen.add(key);
            out.amountCandidates.push({ label: t.slice(0, 80), amount: num, symbol: '' });
          }
        }
      }
    }

    // 策略2：查找包含余额关键词的小元素（补充）
    if (out.amountCandidates.length < 2) {
      const main = appRoot.querySelector('main,[role="main"],.main-content,.content,.page-content') || appRoot;
      const els = main.querySelectorAll('span,p,div,td,dd,strong,em');
      for (const el of els) {
        if (el.children.length > 3) continue;
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
    }

    out.amountCandidates = out.amountCandidates.slice(0, 20);
  } catch (e) {
    out.error = String(e);
  }
  return out;
})()`;

const preset = {
  provider: 'mimo',
  supportedKinds: ['balance'],
  loginTitle: '登录 MiMo',
  loginUrl: 'https://platform.xiaomimimo.com/',
  origin: 'https://platform.xiaomimimo.com',
  // SPA 站点，登录成功后落在 #/console/xxx（did-navigate-in-page 也会触发判定）
  successUrlPattern: /^https:\/\/platform\.xiaomimimo\.com\/#\/console\//,
  targetUrl: 'https://platform.xiaomimimo.com/#/console/balance',
  buildExtractJs() {
    return MIMO_EXTRACT_JS;
  },
  parse: (result, monitor) => websync.parseHeuristicResult(result, monitor),
  shouldThrow: websync.heuristicShouldThrow,
  isReady: websync.heuristicIsReady,
};

module.exports = websync.makeAdapter(preset);
