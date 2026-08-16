// 适配器注册表：provider id → adapter
// usage 型：async fetchUsage(monitor, ctx) => { periods: { fiveHours?, week?, month? } }
// balance 型：async fetchBalance(monitor, ctx) => { balance, currency }
// supportedKinds 声明支持的类型，monitor.provider + monitor.kind 决定走哪条路。
// ctx: { app, safeStorage }（官网同步类适配器用于 session/凭证）
const opencodeGo = require('./opencode-go');
const minimax = require('./minimax');
const volcengine = require('./volcengine');
const mimo = require('./mimo');
const packyapi = require('./packyapi');
const qwen = require('./qwen');
const apiBalance = require('./api-balance');
const apiUsage = require('./api-usage');

const adapters = {
  'opencode-go': opencodeGo, // 官网同步，usage
  deepseek: apiBalance, // API，balance
  kimi: apiBalance, // API，balance
  volcengine, // 签名 OpenAPI，balance
  minimax, // API，usage + balance
  mimo, // 官网同步（启发式），balance
  packyapi, // 官网同步（启发式），balance
  qwen, // 官网同步（启发式），balance
  'custom-usage': apiUsage,
  'custom-balance': apiBalance,
};

function getAdapter(provider) {
  return adapters[provider] || null;
}

// 渲染层设置面板用的厂商元信息；supportedKinds 与适配器实现保持一致（测试保证）。
// siteUrl：卡片"打开官网"按钮的默认地址；custom 系列为空，由用户在表单里填写。
const PROVIDER_META = [
  { id: 'opencode-go', isWebSync: true, siteUrl: 'https://opencode.ai' },
  { id: 'deepseek', needsApiKey: true, defaultBaseUrl: 'https://api.deepseek.com', siteUrl: 'https://platform.deepseek.com' },
  { id: 'kimi', needsApiKey: true, defaultBaseUrl: 'https://api.moonshot.cn', siteUrl: 'https://platform.moonshot.cn' },
  { id: 'minimax', needsApiKey: true, defaultBaseUrl: 'https://www.minimaxi.com', siteUrl: 'https://platform.minimaxi.com' },
  { id: 'volcengine', needsAkSk: true, siteUrl: 'https://console.volcengine.com/ark' },
  { id: 'mimo', isWebSync: true, siteUrl: 'https://platform.xiaomimimo.com/' },
  { id: 'packyapi', isWebSync: true, siteUrl: 'https://www.packyapi.com/console' },
  { id: 'qwen', isWebSync: true, siteUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'custom-usage', needsApiKey: true, needsBaseUrl: true, siteUrl: '' },
  { id: 'custom-balance', needsApiKey: true, needsBaseUrl: true, siteUrl: '' },
];

function listProviderMeta() {
  return PROVIDER_META.map((m) => ({
    needsApiKey: false,
    needsAkSk: false,
    needsBaseUrl: false,
    isWebSync: false,
    defaultBaseUrl: '',
    ...m,
    supportedKinds: (adapters[m.id] && adapters[m.id].supportedKinds) || [],
  }));
}

module.exports = Object.assign(adapters, { getAdapter, listProviderMeta });
