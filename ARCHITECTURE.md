# Plan Usage 架构设计

大模型订阅用量 / 余额桌面悬浮监控。Electron 28 + 原生 JS/CSS（渲染进程 ESM，主进程 CommonJS），仅 Windows。原型为 OpenCode-Glance（仅取其用量圆盘模块与窗口机制，剥离指令面板）。

## 目录结构

```
main.js                  入口：app.whenReady → createWindow → setupIPC → registerShortcuts
preload.js               contextBridge 暴露 api
src/main/
  window.js              透明无边框窗口、位置记忆、置顶、全局紧凑模式
  config.js              config.json（外观/窗口/语言）+ monitors.json（监控项 CRUD）读写
  monitor.js             监控调度：按每个 monitor 的刷新规则定时取数，30s 缓存，推送渲染层
  ipc.js                 全部 ipcMain.handle
  shortcuts.js           Ctrl+Shift+U 显隐窗口
  adapters/
    index.js             适配器注册表：provider id → adapter（supportedKinds 声明支持的类型）
    web-sync.js          官网同步通用引擎：登录窗口 + 隐藏窗口抓页面执行提取脚本（opencode-go 预设）
    opencode-go.js       官网同步预设（DOM 抓 [data-slot="usage-value"]，保留既有凭证存储键）
    minimax.js           MiniMax 官方 API：token_plan/remains + account/query_balance（usage + balance）
    volcengine.js        火山签名 OpenAPI：QueryBalanceAcct（内置 HMAC-SHA256 签名，纯函数 signVolc）
    api-usage.js         通用 API 订阅用量查询（baseUrl+apiKey+解析映射，可配）
    api-balance.js       通用 API 余额查询（内置 deepseek/kimi 预设 + custom-balance）
src/renderer/
  app.js  state.js  dom.js  toast.js  i18n.js
  monitor-card.js        用量圆盘卡片（三圆环条件渲染、预警色球/自定义图案、刷新时间+手动刷新按钮）
  balance-card.js        余额卡片（自定义名+余额+币种+刷新时间+手动刷新）
  settings.js            设置面板（监控项 CRUD、刷新规则、外观调节、i18n 切换）
src/index.html  src/style.css
skill/SKILL.md           面向 agent 的配置说明
test/                    纯 node 测试（不依赖 electron 的模块全部可测）
```

## config.json（userData/config.json）

```jsonc
{
  "alwaysOnTop": true,
  "opacity": 0.92,            // 窗口整体不透明度 0.3~1（CSS opacity 实现）
  "x": 0, "y": 0, "width": 420, "height": 580,   // 位置记忆
  "locale": "zh",             // zh | en
  "appearance": {
    "borderWidth": 8,             // 边框粗细 px
    "bgColor": "rgba(33,30,30,0.76)",      // 背景色
    "cardBgColor": "rgba(43,40,40,0.82)",  // 监控项卡片背景色
    "ringTrackColor": "rgba(255,255,255,0.12)", // 圆盘底色
    "ringUsedColor": "rgba(255,255,255,0.92)",  // 圆盘已使用部分颜色
    "fontColor": "#F1ECEC",       // 统一字体颜色
    "fontSize": 11                // 统一字体大小 px
  },
  "alert": {
    "mode": "dot",                // dot=色球 | image=自定义图案
    "threshold1": 50,             // 用量：安全/关注 分界百分比（0<t1<t2<100）
    "threshold2": 85,             // 用量：关注/危险 分界百分比
    "balanceThreshold1": 50,      // 余额：安全/关注 分界（余额越高越安全，bt1>bt2≥0）
    "balanceThreshold2": 20,      // 余额：关注/危险 分界
    "colors": { "safe": "#7ed6a5", "warning": "#e6c860", "danger": "#e06c75" },
    "images": { "safe": "", "warning": "", "danger": "" }  // 本地文件路径，静态图或 gif
  }
}
```

全局 alert 是默认值；每条 monitor 可带同名 `alert` 对象做单独覆盖（深合并到全局上，
缺省字段回落全局；usage 型用 mode/threshold1/threshold2/colors/images，balance 型用
mode/balanceThreshold1/balanceThreshold2/colors/images——余额卡按落档显示色球或档位图）。
渲染层 `getAlertCfg(monitor)` 负责合并；`updateMonitor(id, {alert: null})` 可清除覆盖。

## monitors.json（userData/monitors.json）

```jsonc
{
  "monitors": [
    {
      "id": "uuid",
      "kind": "usage",                // usage=订阅用量圆盘 | balance=余额卡片
      "name": "我的 OpenCode",         // 卡片左上角自定义显示名
      "provider": "opencode-go",      // 适配器 id
      "enabled": true,
      "refresh": { "mode": "interval", "minutes": 5 },  // manual | interval(1/5/10/30)
      "auth": {
        "apiKey": "",                 // API 型厂商（deepseek/kimi/custom-*）
        "baseUrl": "",                // 可覆盖默认端点（标准的查询URL填写框）
        "accessKey": "",              // volcengine 签名 OpenAPI
        "secretKey": "",              // volcengine 签名 OpenAPI
        "targetUrl": "",              // 官网同步型：覆盖抓取页面地址
        "extractJs": ""               // 官网同步型：覆盖提取脚本（usage 返回 {fiveHours,week,month}，balance 返回 {balance}）
      },
      "currency": "USD",              // 仅 balance 型：RMB | USD（展示用符号）
      "createdAt": 0, "updatedAt": 0
    }
  ]
}
```

同一厂商不同账号 = 多条 monitor 记录，provider 相同、apiKey 不同。

## 适配器接口（src/main/adapters/index.js）

```js
// 每个适配器声明 supportedKinds，monitor.provider + monitor.kind 决定走哪条路
// usage 型适配器
async fetchUsage(monitor, ctx) => {
  periods: { fiveHours?: {percent}, week?: {percent}, month?: {percent} },
  // percent: 0~100 已使用百分比；厂商没有某档就缺省该键，渲染层不显示该圆环
}
// balance 型适配器
async fetchBalance(monitor, ctx) => { balance: 12.34, currency: "CNY"|"USD" }
// ctx: { app, safeStorage } ；官网同步类适配器用 ctx 管 session/凭证
```

厂商现状（API 调研结论）：

| provider | 类型 | 取数方式 | 凭证字段 |
|---|---|---|---|
| opencode-go | usage | 官网同步（web-sync 预设，DOM 抓 [data-slot="usage-value"]） | 登录窗口，cookie 加密存 userData |
| deepseek | balance | ✅ API：`GET {base}/user/balance`（金额是 string，已 Number 转换） | apiKey |
| kimi | balance | ✅ API：`GET {base}/v1/users/me/balance`，取 data.available_balance | apiKey |
| volcengine | balance | ✅ 签名 OpenAPI：`QueryBalanceAcct`（adapters/volcengine.js，内置 HMAC-SHA256 签名，无第三方依赖，官方测试向量验证） | accessKey + secretKey |
| minimax | usage+balance | ✅ 官方 API：`GET {base}/v1/token_plan/remains`（5小时+每周，无 month）/ `GET {base}/account/query_balance` | apiKey（余额用 sk-api- 开头的 key） |
| custom-usage / custom-balance | 通用 | 用户自填 baseUrl+apiKey+JSON 路径映射 | apiKey |

API 型都允许在设置里改 baseUrl 和 apiKey。

## 官网同步（adapters/web-sync.js）

opencode-go 以 preset 配置接入 web-sync 引擎：

- `login(preset)`：登录窗口加载 `loginUrl`（session partition 按 provider 隔离 `persist:planusage-{provider}`，伪装 Chrome UA），`successUrlPattern` 命中导航 URL 即视为登录成功；成功后可选 `captureFromUrl`/`captureJs` 抓取标识（如 workspaceId）存 userData，可选存指定 cookie（safeStorage 加密，文件名 `{provider}-auth.enc`；capture JSON 默认 `websync-{provider}-capture.json`，opencode-go 沿用 `opencode-go-workspace.json`）。
- `fetchPage(preset, monitor, ctx)`：隐藏 BrowserWindow 加载 `targetUrl`（`monitor.auth.targetUrl` 可覆盖），`executeJavaScript` 执行提取脚本（`monitor.auth.extractJs` 可覆盖），轮询最多 30×1s 直到 `isReady` 返回真。
- 内置通用启发式提取（纯函数可测）：收集带上下文标签的百分比/金额候选，由纯函数 `parseUsageCandidates` / `parseBalanceCandidates` 归类取值（5小时→fiveHours、周→week、月→month；优先"可用"再"余额"标签）。自定义 extractJs 可直接返回 `{fiveHours,week,month}` 或 `{balance}` 跳过启发式。
- 登录状态按 provider 隔离：`websync:login/clear/has-auth` 通道均带 provider 参数。

## 监控调度（monitor.js）

- 每个 enabled monitor 按 refresh.mode 调度：manual 不定时；interval 每 N 分钟。
- `getMonitorData(id, {force})`：30s 内存缓存；失败返回上次数据+error。
- 数据变化/刷新完成后 `webContents.send('monitor:data', {id, data, updatedAt, error, source})` 推送。
- 渲染层启动时拉全量 `monitors:list` + 每项 `monitor:get`。

## 渲染层要点

- 卡片头部：左=name（自定义），右=上次刷新时间 `HH:MM` + 手动刷新按钮（refresh.mode=interval 时隐藏按钮）。
- usage 卡：圆环按 periods 实际返回的键渲染（五小时/本周/本月），环下方只有标签文字；alert.mode=dot 时标签前放色球（颜色按该环百分比落档）；alert.mode=image 时每个周期的圆环替换为对应档位图片（按该环百分比落档取图，未配图则回退圆环），百分比数字显示在标签后面。
- balance 卡：name + 余额（币种符号）+ 刷新时间 + 手动刷新按钮。
- 统一字体：所有文字用 appearance.fontColor / fontSize。
- 设置面板：modal 全屏覆盖。监控项列表 CRUD（表单含 kind/provider/name/apiKey/baseUrl/refresh/currency + opencode-go 的"官网同步登录"按钮）；外观区（边框粗细/透明度/背景色/圆盘底色/已用色/字体色/字号）；预警区（模式、两个阈值、三色/三图）；语言切换。
- 窗口特性沿用原方案：CSS opacity 调透明度（不能用 setOpacity）、`-webkit-app-region: drag` 拖拽、close/resize/move 持久化 bounds、backdrop-filter 毛玻璃。

## i18n

`src/renderer/i18n.js`：字典 `{zh:{...}, en:{...}}`，`t(key)`，切换后重渲染。圆环标签：五小时/5H、本周/Week、本月/Month。

## 测试

`test/run-tests.js` 纯 node：config 读写迁移、monitors CRUD、适配器解析函数（mock fetch 响应）、阈值分档、i18n 字典完整性。主进程模块中依赖 electron 的部分要可注入（config.js 接受 userData 路径参数）。
