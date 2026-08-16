// Qwen（阿里云百炼）官网同步：基于 web-sync 引擎 + 通用启发式提取。
// 阿里云控制台登录跳转较多，登录成功后回落到 bailian.console.aliyun.com 即视为成功。
// 余额/用量在控制台页面自动收集；提取不理想时可用设置里的 targetUrl / extractJs 覆盖。
const websync = require('./web-sync');

const preset = {
  provider: 'qwen',
  supportedKinds: ['balance'],
  loginTitle: '登录阿里云百炼',
  loginUrl: 'https://bailian.console.aliyun.com/',
  origin: 'https://bailian.console.aliyun.com',
  successUrlPattern: /^https:\/\/bailian\.console\.aliyun\.com\//,
  targetUrl: 'https://bailian.console.aliyun.com/',
  buildExtractJs() {
    return websync.HEURISTIC_EXTRACT_JS;
  },
  parse: (result, monitor) => websync.parseHeuristicResult(result, monitor),
  shouldThrow: websync.heuristicShouldThrow,
  isReady: websync.heuristicIsReady,
};

module.exports = websync.makeAdapter(preset);
