// MiMo 官网同步：基于 web-sync 引擎 + 通用启发式提取。
// 登录后进入 #/console 控制台，余额页自动收集页面上的金额候选（"余额 ¥xx"）。
// 提取不理想时，可在设置"高级（覆盖抓取配置）"里填 auth.targetUrl / auth.extractJs。
const websync = require('./web-sync');

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
    return websync.HEURISTIC_EXTRACT_JS;
  },
  parse: (result, monitor) => websync.parseHeuristicResult(result, monitor),
  shouldThrow: websync.heuristicShouldThrow,
  isReady: websync.heuristicIsReady,
};

module.exports = websync.makeAdapter(preset);
