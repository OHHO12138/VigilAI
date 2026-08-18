// i18n 字典与 t()。纯 ESM、不依赖 window/document，纯 node 可加载（字典一致性有测试）。
// t(key, vars) 支持 {var} 插值；setLocale 触发订阅回调，由 app.js 统一重渲染。

const zh = {
  'app.title': 'VigilAI',
  'title.settings': '设置',
  'title.layoutHorizontal': '横向排列',
  'title.layoutVertical': '恢复竖排',
  'title.pin': '窗口置顶',
  'title.opacity': '透明度',
  'title.minimize': '最小化',
  'title.close': '隐藏',
  'title.refresh': '刷新全部',
  'empty.text': '暂无监控项',
  'empty.hint': '点击右上角 ⚙ 添加',
  'empty.allDisabled': '全部监控项已停用',
  'empty.allDisabledHint': '在设置里勾选即可重新显示',

  'period.fiveHours': '五小时',
  'period.week': '本周',
  'period.month': '本月',

  'card.refresh': '刷新',
  'card.retry': '重试',
  'card.never': '未刷新',
  'card.loading': '加载中…',
  'card.failed': '获取失败',
  'card.disabled': '已停用',
  'card.site': '打开官网（系统浏览器）',

  'settings.title': '设置',
  'settings.monitors': '监控项',
  'settings.appearance': '外观',
  'settings.alert': '预警',
  'settings.language': '语言',
  'settings.autoStart': '开机自启',
  'settings.close': '关闭',

  'monitor.add': '新增监控项',
  'monitor.drag': '拖动排序',
  'monitor.edit': '编辑',
  'monitor.delete': '删除',
  'monitor.confirmDelete': '确认删除「{name}」？',
  'monitor.name': '名称',
  'monitor.namePlaceholder': '例如：我的 DeepSeek',
  'monitor.provider': '厂商',
  'monitor.kind': '类型',
  'monitor.kindUsage': '订阅用量',
  'monitor.kindBalance': '余额',
  'monitor.apiKey': 'API Key',
  'monitor.baseUrl': '查询 URL',
  'monitor.baseUrlOptional': '查询 URL（可选覆盖）',
  'monitor.siteUrl': '官网地址（打开官网按钮）',
  'monitor.accessKey': 'Access Key',
  'monitor.secretKey': 'Secret Key',
  'monitor.currency': '币种',
  'monitor.refreshRule': '刷新规则',
  'monitor.manual': '手动',
  'monitor.intervalMinutes': '每 {n} 分钟',
  'monitor.enabled': '启用',
  'monitor.alertOverride': '为此监控项单独设置预警',
  'monitor.websyncLogin': '官网同步登录',
  'monitor.websyncLoggedIn': '已登录',
  'monitor.websyncNotLoggedIn': '未登录',
  'monitor.websyncLoggingIn': '登录中…',
  'monitor.advanced': '高级（覆盖抓取配置）',
  'monitor.targetUrl': '抓取地址 targetUrl',
  'monitor.extractJs': '提取脚本 extractJs',
  'monitor.save': '保存',
  'monitor.cancel': '取消',
  'monitor.refreshManual': '手动',
  'monitor.refreshInterval': '每 {n} 分钟',

  'appearance.borderWidth': '边框粗细',
  'appearance.opacity': '透明度',
  'appearance.bgColor': '背景色',
  'appearance.cardBgColor': '卡片背景色',
  'appearance.ringTrackColor': '圆盘底色',
  'appearance.ringUsedColor': '圆盘已用色',
  'appearance.fontColor': '字体颜色',
  'appearance.fontSize': '字体大小',

  'alert.mode': '预警模式',
  'alert.modeDot': '色球',
  'alert.modeImage': '图案',
  'alert.threshold1': '安全/关注分界',
  'alert.threshold2': '关注/危险分界',
  'alert.thresholdError': '需满足 0 < 分界1 < 分界2 < 100',
  'alert.balanceThreshold1': '安全/关注分界（余额）',
  'alert.balanceThreshold2': '关注/危险分界（余额）',
  'alert.balanceThresholdError': '需满足 安全/关注分界 > 关注/危险分界 ≥ 0',
  'alert.levelSafe': '安全',
  'alert.levelWarning': '关注',
  'alert.levelDanger': '危险',
  'alert.pickImage': '选择图片',
  'alert.clearImage': '清除',
  'alert.noImage': '未设置',

  'lang.zh': '中文',
  'lang.en': 'English',

  'provider.opencode-go': 'OpenCode Go',
  'provider.deepseek': 'DeepSeek',
  'provider.kimi': 'Kimi',
  'provider.minimax': 'MiniMax',
  'provider.volcengine': '火山方舟',
  'provider.mimo': 'MiMo',
  'provider.packyapi': 'PackyAPI',
  'provider.qwen': 'Qwen 百炼',
  'provider.custom-usage': '自定义用量',
  'provider.custom-balance': '自定义余额',

  'toast.saved': '已保存',
  'toast.enabled': '已启用',
  'toast.disabled': '已停用',
  'toast.deleted': '已删除',
  'toast.refreshFailed': '刷新失败',
  'toast.loginSuccess': '登录成功',
  'toast.loginFailed': '登录失败',
  'toast.invalidForm': '请填写必填项',
};

const en = {
  'app.title': 'VigilAI',
  'title.settings': 'Settings',
  'title.layoutHorizontal': 'Horizontal layout',
  'title.layoutVertical': 'Vertical layout',
  'title.pin': 'Always on top',
  'title.opacity': 'Opacity',
  'title.minimize': 'Minimize',
  'title.close': 'Hide',
  'title.refresh': 'Refresh all',
  'empty.text': 'No monitors yet',
  'empty.hint': 'Click ⚙ in the title bar to add one',
  'empty.allDisabled': 'All monitors are disabled',
  'empty.allDisabledHint': 'Re-enable in settings to show again',

  'period.fiveHours': '5H',
  'period.week': 'Week',
  'period.month': 'Month',

  'card.refresh': 'Refresh',
  'card.retry': 'Retry',
  'card.never': 'Never',
  'card.loading': 'Loading…',
  'card.failed': 'Fetch failed',
  'card.disabled': 'Disabled',
  'card.site': 'Open website (system browser)',

  'settings.title': 'Settings',
  'settings.monitors': 'Monitors',
  'settings.appearance': 'Appearance',
  'settings.alert': 'Alert',
  'settings.language': 'Language',
  'settings.autoStart': 'Start on boot',
  'settings.close': 'Close',

  'monitor.add': 'Add monitor',
  'monitor.drag': 'Drag to reorder',
  'monitor.edit': 'Edit',
  'monitor.delete': 'Delete',
  'monitor.confirmDelete': 'Delete "{name}"?',
  'monitor.name': 'Name',
  'monitor.namePlaceholder': 'e.g. My DeepSeek',
  'monitor.provider': 'Provider',
  'monitor.kind': 'Kind',
  'monitor.kindUsage': 'Usage',
  'monitor.kindBalance': 'Balance',
  'monitor.apiKey': 'API Key',
  'monitor.baseUrl': 'Query URL',
  'monitor.baseUrlOptional': 'Query URL (optional override)',
  'monitor.siteUrl': 'Website URL (open-site button)',
  'monitor.accessKey': 'Access Key',
  'monitor.secretKey': 'Secret Key',
  'monitor.currency': 'Currency',
  'monitor.refreshRule': 'Refresh rule',
  'monitor.manual': 'Manual',
  'monitor.intervalMinutes': 'Every {n} min',
  'monitor.enabled': 'Enabled',
  'monitor.alertOverride': 'Override alert settings for this monitor',
  'monitor.websyncLogin': 'Login via website',
  'monitor.websyncLoggedIn': 'Logged in',
  'monitor.websyncNotLoggedIn': 'Not logged in',
  'monitor.websyncLoggingIn': 'Logging in…',
  'monitor.advanced': 'Advanced (override scraping)',
  'monitor.targetUrl': 'Target URL',
  'monitor.extractJs': 'Extract script (extractJs)',
  'monitor.save': 'Save',
  'monitor.cancel': 'Cancel',
  'monitor.refreshManual': 'manual',
  'monitor.refreshInterval': 'every {n} min',

  'appearance.borderWidth': 'Border width',
  'appearance.opacity': 'Opacity',
  'appearance.bgColor': 'Background',
  'appearance.cardBgColor': 'Card background',
  'appearance.ringTrackColor': 'Ring track',
  'appearance.ringUsedColor': 'Ring used',
  'appearance.fontColor': 'Font color',
  'appearance.fontSize': 'Font size',

  'alert.mode': 'Alert mode',
  'alert.modeDot': 'Dot',
  'alert.modeImage': 'Image',
  'alert.threshold1': 'Safe below',
  'alert.threshold2': 'Warning below',
  'alert.thresholdError': 'Must satisfy 0 < t1 < t2 < 100',
  'alert.balanceThreshold1': 'Safe above (balance)',
  'alert.balanceThreshold2': 'Warning above (balance)',
  'alert.balanceThresholdError': 'Must satisfy safe/warning > warning/danger ≥ 0',
  'alert.levelSafe': 'Safe',
  'alert.levelWarning': 'Warning',
  'alert.levelDanger': 'Danger',
  'alert.pickImage': 'Pick image',
  'alert.clearImage': 'Clear',
  'alert.noImage': 'Not set',

  'lang.zh': '中文',
  'lang.en': 'English',

  'provider.opencode-go': 'OpenCode Go',
  'provider.deepseek': 'DeepSeek',
  'provider.kimi': 'Kimi',
  'provider.minimax': 'MiniMax',
  'provider.volcengine': 'Volcengine',
  'provider.mimo': 'MiMo',
  'provider.packyapi': 'PackyAPI',
  'provider.qwen': 'Qwen (Bailian)',
  'provider.custom-usage': 'Custom usage',
  'provider.custom-balance': 'Custom balance',

  'toast.saved': 'Saved',
  'toast.enabled': 'Enabled',
  'toast.disabled': 'Disabled',
  'toast.deleted': 'Deleted',
  'toast.refreshFailed': 'Refresh failed',
  'toast.loginSuccess': 'Login success',
  'toast.loginFailed': 'Login failed',
  'toast.invalidForm': 'Please fill required fields',
};

const dicts = { zh, en };
let locale = 'zh';
const listeners = new Set();

function getLocale() {
  return locale;
}

function setLocale(next) {
  if (!dicts[next] || next === locale) return;
  locale = next;
  for (const fn of listeners) fn(locale);
}

function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function t(key, vars) {
  let s = (dicts[locale] && dicts[locale][key]) ?? dicts.zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

export { dicts, t, getLocale, setLocale, onLocaleChange };
