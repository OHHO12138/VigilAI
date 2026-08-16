// OpenCode Go 官网同步：基于 web-sync 引擎的预设。
// 凭证存储键沿用既有约定：opencode-go-auth.enc（safeStorage 加密的 auth cookie）+
// opencode-go-workspace.json（workspaceId）。
const websync = require('./web-sync');

// 纯函数：DOM 里抓到的 [data-slot="usage-value"] 文本数组 → periods
// 顺序与官网一致：5小时 / 本周 / 本月
function parseUsageValues(values) {
  if (!Array.isArray(values) || values.length < 3) return null;
  const first3 = values.slice(0, 3).map((v) => String(v).trim());
  if (!first3.every((v) => /^\d+%$/.test(v))) return null;
  return {
    periods: {
      fiveHours: { percent: parseInt(first3[0], 10) },
      week: { percent: parseInt(first3[1], 10) },
      month: { percent: parseInt(first3[2], 10) },
    },
  };
}

const preset = {
  provider: 'opencode-go',
  supportedKinds: ['usage'],
  loginTitle: '登录 OpenCode 以同步用量',
  loginUrl: 'https://opencode.ai/auth',
  origin: 'https://opencode.ai',
  cookieName: 'auth',
  captureFile: 'opencode-go-workspace.json', // 沿用既有存储键
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
      throw new Error('未获取到工作区 ID：请在设置的"高级（覆盖抓取配置）"里填入你的用量页地址（https://opencode.ai/workspace/<工作区ID>/go）');
    }
    return `https://opencode.ai/workspace/${capture.workspaceId}/go`;
  },
  // 注意：内置提取脚本尚未在真实官网页面实测，DOM 选择器 [data-slot="usage-value"] 以官网实际结构为准；
  // 取数失败时优先让用户验证官网页面，再考虑用 auth.targetUrl / auth.extractJs 覆盖。
  buildExtractJs() {
    return `(function() {
      const values = Array.from(document.querySelectorAll('[data-slot="usage-value"]')).map(el => el.textContent.trim());
      // 未登录会被重定向到 OpenAuth 授权页（auth.opencode.ai/authorize 或 /auth/authorize）
      const isLoginPage = /\\/auth(\\/|$)/.test(location.pathname) || /auth\\.opencode\\.ai/.test(location.host)
        || !!document.querySelector('[data-component="root"] a[href="/github/authorize"]');
      return { values, isLoginPage };
    })()`;
  },
  shouldThrow: (result) => (result && result.isLoginPage ? new Error('登录已过期，请重新登录') : null),
  isReady: (result) => !!result && !result.isLoginPage && parseUsageValues(result.values) !== null,
  parse: (result) => parseUsageValues(result.values),
};

const adapter = websync.makeAdapter(preset);

module.exports = Object.assign(adapter, { parseUsageValues });
