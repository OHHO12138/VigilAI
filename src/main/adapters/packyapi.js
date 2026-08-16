// PackyAPI 官网同步：基于 web-sync 引擎 + 通用启发式提取。
// 登录后进入 /console 控制台，余额页自动收集页面上的金额候选（USD）。
// 提取不理想时，可在设置"高级（覆盖抓取配置）"里填 auth.targetUrl / auth.extractJs。
const websync = require('./web-sync');

const preset = {
  provider: 'packyapi',
  supportedKinds: ['balance'],
  loginTitle: '登录 PackyAPI',
  loginUrl: 'https://www.packyapi.com/login',
  origin: 'https://www.packyapi.com',
  successUrlPattern: /^https:\/\/www\.packyapi\.com\/console(?:\/|$)/,
  targetUrl: 'https://www.packyapi.com/console',
  buildExtractJs() {
    return websync.HEURISTIC_EXTRACT_JS;
  },
  parse: (result, monitor) => websync.parseHeuristicResult(result, monitor),
  shouldThrow: websync.heuristicShouldThrow,
  isReady: websync.heuristicIsReady,
};

module.exports = websync.makeAdapter(preset);
