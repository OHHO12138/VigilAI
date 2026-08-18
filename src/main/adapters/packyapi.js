// PackyAPI 官网同步：基于 web-sync 引擎 + PackyAPI 控制台专用提取脚本。
// 专用脚本聚焦余额展示区域，排除导航干扰，比通用启发式更稳定。
const websync = require('./web-sync');

// PackyAPI 控制台专用提取：聚焦主要内容区，排除 header/nav/sidebar 干扰
const PACKYAPI_EXTRACT_JS = `(function() {
  const out = { amountCandidates: [], isLoginPage: false, url: location.href, title: document.title };
  try {
    out.isLoginPage = !!document.querySelector('input[type="password"]');
    if (out.isLoginPage) return out;

    // 策略1：查找余额相关容器（class/id 含 balance/remain/credit/quota/amount/billing）
    const containers = document.querySelectorAll(
      '[class*="balance" i],[class*="remain" i],[class*="credit" i],' +
      '[class*="quota" i],[class*="amount" i],[class*="billing" i],' +
      '[class*="available" i],[class*="summary" i],[class*="usage" i],' +
      '[id*="balance" i],[id*="remain" i],[id*="credit" i]'
    );

    const seen = new Set();
    for (const c of containers) {
      const t = (c.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 80) continue;
      const m = t.match(/(\\$|US\\$|USD)?\\s*(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)/);
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

    // 策略2：查找包含余额关键词的小元素（补充）
    if (out.amountCandidates.length < 2) {
      const main = document.querySelector('main,[role="main"],.main-content,.content,.page-content,.dashboard') || document.body;
      const els = main.querySelectorAll('span,p,div,td,dd,strong,em');
      for (const el of els) {
        if (el.children.length > 3) continue;
        const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!t || t.length > 60) continue;
        if (!/(余额|可用|剩余|balance|available|remain|credit)/i.test(t)) continue;
        const m = t.match(/(\\$|US\\$|USD|¥|￥)?\\s*(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)/);
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
  provider: 'packyapi',
  supportedKinds: ['balance'],
  loginTitle: '登录 PackyAPI',
  loginUrl: 'https://www.packyapi.com/login',
  origin: 'https://www.packyapi.com',
  successUrlPattern: /^https:\/\/www\.packyapi\.com\/console(?:\/|$)/,
  targetUrl: 'https://www.packyapi.com/console',
  buildExtractJs() {
    return PACKYAPI_EXTRACT_JS;
  },
  parse: (result, monitor) => websync.parseHeuristicResult(result, monitor),
  shouldThrow: websync.heuristicShouldThrow,
  isReady: websync.heuristicIsReady,
};

module.exports = websync.makeAdapter(preset);
