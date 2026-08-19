// PackyAPI 官网同步：基于 web-sync 引擎 + PackyAPI 控制台专用提取脚本。
// 采用全量关键词扫描 + 排除导航区域，比 CSS 选择器更通用可靠。
const websync = require('./web-sync');

const PACKYAPI_EXTRACT_JS = `(function() {
  const out = { amountCandidates: [], isLoginPage: false, url: location.href, title: document.title };
  try {
    out.isLoginPage = !!document.querySelector('input[type="password"]');
    if (out.isLoginPage) return out;

    const skip = 'nav,header,footer,aside,.nav,.sidebar,.header,.footer,.menu,.toolbar,.breadcrumb';
    // 干扰词：已用/花费/赠送/充值/次数等都不是余额（页面常出现"已用 $0.31""请求 0 次"等）
    const bad = /已用|花费|消耗|赠送|奖励|充值|优惠|本次|今日|本周|本月|次数|请求|token|used|cost|spend|gift|reward|recharge|topup|coupon|request|剩余\\s*[^\\d]{0,6}(次|天|小时)/i;
    const seen = new Set();
    const els = document.querySelectorAll('span,p,div,td,dd,strong,em,h1,h2,h3,h4');

    for (const el of els) {
      if (el.children.length > 3) continue;
      if (el.closest(skip)) continue;
      const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 60) continue;
      if (bad.test(t)) continue;
      if (!/(余额|可用|剩余|现金|balance|available|remain|credit|cash)/i.test(t)) continue;
      const m = t.match(/(US\\$|\\$|USD|RMB|CNY|¥|￥)?\\s*(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)/);
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
