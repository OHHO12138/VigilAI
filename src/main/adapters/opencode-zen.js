// OpenCode Zen 官网同步：workspace 账单页抓余额（USD credits，按请求计费）。
// 账单页 https://opencode.ai/workspace/<ID>/billing 的 DOM 钩子：
//   [data-slot="balance-value"] 文本形如 "$15.00"（formatBalance 后的美元数）。
// 数据接口走 SolidJS server action（cookie + RPC），无法直连，故取 DOM。
// 凭证与 opencode-go 同一 OpenCode 账号：workspaceId 捕获文件沿用 opencode-go-workspace.json，
// 登录任一预设后另一预设可直接用（session partition 各自独立，首次仍需各登录一次）。
const websync = require('./web-sync');

// 纯函数："$15.00" / "15.00" / "$1,234.56" → 美元数值；解析失败返回 null
function parseBalanceText(text) {
  const m = String(text || '')
    .replace(/,/g, '')
    .match(/\$\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

const preset = {
  provider: 'opencode-zen',
  supportedKinds: ['balance'],
  loginTitle: '登录 OpenCode 以同步 Zen 余额',
  loginUrl: 'https://opencode.ai/auth',
  origin: 'https://opencode.ai',
  cookieName: 'auth',
  captureFile: 'opencode-go-workspace.json', // 沿用既有存储键，与 opencode-go 共享 workspaceId
  successUrlPattern: /^https:\/\/opencode\.ai\/workspace\/[^/]+/,
  captureFromUrl(url) {
    try {
      const m = new URL(url).pathname.match(/\/workspace\/([^/]+)/);
      return m ? { workspaceId: m[1] } : null;
    } catch {
      return null;
    }
  },
  // 落点不是 /workspace/xxx 时（如首页），从页面链接里找 workspaceId
  captureJs: `(function() {
    const links = Array.from(document.querySelectorAll('a[href*="/workspace/"]')).map(a => a.getAttribute('href'));
    for (const href of links) {
      const m = String(href).match(/\\/workspace\\/([^/"]+)/);
      if (m) return { workspaceId: m[1] };
    }
    return null;
  })()`,
  targetUrl(capture) {
    if (!capture) {
      throw new Error('未登录：请先在设置中完成官网同步登录');
    }
    if (!capture.workspaceId) {
      throw new Error(
        '未获取到工作区 ID：请在设置的"高级（覆盖抓取配置）"里填入你的账单页地址（https://opencode.ai/workspace/<工作区ID>/billing）'
      );
    }
    return `https://opencode.ai/workspace/${capture.workspaceId}/billing`;
  },
  buildExtractJs() {
    return `(function() {
      // 未登录会被重定向到 OpenAuth 授权页
      const isLoginPage = /\\/auth(\\/|$)/.test(location.pathname) || /auth\\.opencode\\.ai/.test(location.host);
      const el = document.querySelector('[data-slot="balance-value"]');
      return { text: el ? el.textContent.trim() : '', isLoginPage };
    })()`;
  },
  shouldThrow: (result) => (result && result.isLoginPage ? new Error('登录已过期，请重新登录') : null),
  isReady: (result) => !!result && !result.isLoginPage && parseBalanceText(result.text) !== null,
  parse: (result) => {
    const balance = parseBalanceText(result && result.text);
    if (balance === null) return null;
    return { balance, currency: 'USD' };
  },
};

const adapter = websync.makeAdapter(preset);

module.exports = Object.assign(adapter, { parseBalanceText });
