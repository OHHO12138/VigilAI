---
name: vigilai-setup
description: 当用户要在 VigilAI 桌面悬浮监控应用中添加、修改或排查大模型厂商的订阅用量/余额监控配置时使用。各厂商取数方式不同（API Key、火山 AK/SK 签名、官网同步登录、自定义提取脚本），按本说明可正确生成 monitors.json 记录或引导用户在设置面板完成配置。
---

# VigilAI 配置指引（面向 agent）

VigilAI 是一个 Electron 桌面悬浮窗应用，用大模型厂商的 API 或官网同步方式，监控订阅用量（圆盘：五小时/本周/本月百分比）和账户余额。

## 配置文件位置

- `%APPDATA%\VigilAI\config.json` — 外观/窗口/预警/语言（一般引导用户在设置面板改，不必直接编辑）
- `%APPDATA%\VigilAI\monitors.json` — 监控项列表，agent 主要操作这个文件

完整字段结构见项目根目录 `ARCHITECTURE.md`。一条 monitor 记录的结构：

```jsonc
{
  "monitors": [
    {
      "id": "uuid",                      // 新增时用 UUID v4 生成
      "kind": "usage",                   // usage=订阅用量圆盘 | balance=余额卡片
      "name": "我的 DeepSeek",            // 卡片左上角显示名，用户自定义
      "provider": "deepseek",            // 厂商 id，见下方各节
      "enabled": true,
      "refresh": { "mode": "interval", "minutes": 5 },  // manual | interval(1/5/10/30)
      "auth": {                          // 各厂商用到的字段不同，见各节
        "apiKey": "", "baseUrl": "",
        "accessKey": "", "secretKey": "",
        "targetUrl": "", "extractJs": "",
        "balancePath": "", "paths": {},
        "method": "", "headers": {}
      },
      "currency": "RMB",                 // 仅 balance 型：RMB | USD
      "createdAt": 0, "updatedAt": 0     // 毫秒时间戳
    }
  ]
}
```

## 两种配置途径

**(a) 设置面板（优先推荐）**：让用户点窗口标题栏的 ⚙ 打开设置 → 监控项 → 新增/编辑。面板会按厂商动态显示所需字段，改完立即生效，无需重启。

**(b) agent 直接编辑 monitors.json**：适合批量添加或用户授权代操作。**应用没有配置热重载**——改完文件必须提醒用户重启应用（关掉重开）才会生效。编辑前先备份原文件（复制为 `monitors.json.bak`）。编辑后建议用 `node -e "JSON.parse(require('fs').readFileSync('.../monitors.json','utf8'))"` 校验 JSON 合法。

## 各厂商配置

### opencode-go（usage，官网同步）

OpenCode Go 无公开查询接口，用量来自 opencode.ai 官网页面抓取，periods 固定返回 `fiveHours`/`week`/`month` 三档。

- 凭证：**无需 apiKey**。让用户在设置面板的监控项表单里点「官网同步登录」，在弹出的窗口里完成 opencode.ai 登录即可（登录态存在本地加密的 session 里）。
- 模板：

```json
{
  "kind": "usage",
  "name": "我的 OpenCode",
  "provider": "opencode-go",
  "enabled": true,
  "refresh": { "mode": "interval", "minutes": 5 },
  "auth": {}
}
```

- 备注：登录过期后取数会报「登录已过期」，让用户重新点一次「官网同步登录」。登录成功的判定是"落到 opencode.ai 任意非 /auth 页面且 auth cookie 已写入"；正常情况下会自动从 URL 或页面链接捕获 workspaceId。如果登录成功但取数报「未获取到工作区 ID」，让用户在官网打开自己的用量页（`https://opencode.ai/workspace/<工作区ID>/go`），把完整地址填进设置的「高级（覆盖抓取配置）」里的抓取地址（`auth.targetUrl`）即可。高级用户也可用 `auth.extractJs` 覆盖提取脚本（自定义脚本需返回 `{"values": ["12%","34%","56%"]}` 形状）。
- 注意：内置提取脚本（抓 `[data-slot="usage-value"]`）**尚未在真实官网页面实测**。取数失败时先让用户确认官网页面结构，再用 `auth.targetUrl` / `auth.extractJs` 覆盖；确认脚本可用后再回填到应用内。

### deepseek（balance，API）

- apiKey 获取：https://platform.deepseek.com/api_keys
- 端点（内置默认）：`GET https://api.deepseek.com/user/balance`，`Authorization: Bearer {apiKey}`
- 响应里按 `currency` 匹配 `balance_infos` 项取 `total_balance`；`currency` 填 `RMB`（匹配 CNY 项）或 `USD`
- 模板：

```json
{
  "kind": "balance",
  "name": "DeepSeek",
  "provider": "deepseek",
  "enabled": true,
  "refresh": { "mode": "interval", "minutes": 30 },
  "auth": { "apiKey": "sk-xxxxxxxx" },
  "currency": "RMB"
}
```

### kimi（balance，API）

- apiKey 获取：https://platform.moonshot.cn/console/api-keys
- 端点（内置默认）：`GET https://api.moonshot.cn/v1/users/me/balance`，取 `data.available_balance`
- `currency` 填 `RMB`
- 模板同 deepseek，`provider` 改为 `"kimi"`，`currency` 为 `"RMB"`。

### volcengine（balance，签名 OpenAPI）

火山方舟余额无 Bearer 接口，走火山引擎签名 OpenAPI（应用内置签名实现，无需额外配置端点）。

- AK/SK 获取：https://console.volcengine.com/iam/keymanage/
- 该 AK 需要有账单服务权限（billing 服务 `QueryBalanceAcct`，Version 2022-01-01）；建议用子账号最小授权
- `currency` 填 `RMB`
- 模板：

```json
{
  "kind": "balance",
  "name": "火山方舟",
  "provider": "volcengine",
  "enabled": true,
  "refresh": { "mode": "interval", "minutes": 30 },
  "auth": { "accessKey": "AKxxxxxxxx", "secretKey": "xxxxxxxx" },
  "currency": "RMB"
}
```

### minimax（usage + balance，官方 API）

MiniMax 有官方 API（来自官方 CLI 源码）。两种 key 用途不同，**配置时注意区分**：

- **usage（Token Plan 订阅用量）**：用 Token Plan 的 key。端点（内置默认）：`GET https://www.minimaxi.com/v1/token_plan/remains`。periods 返回 `fiveHours`（5 小时滚动窗口）和 `week`，**没有 month**（卡片自动只显示两个圆环）。
- **balance（按量付费账户余额）**：用 `sk-api-` 开头的 key。端点（内置默认）：`GET https://www.minimaxi.com/account/query_balance`，取 `available_amount`（CNY）。
- apiKey 获取：https://platform.minimaxi.com 的 API Keys 管理页。
- 国际站用户在 `auth.baseUrl` 填 `https://www.minimax.io`。
- 模板（usage）：

```json
{
  "kind": "usage",
  "name": "MiniMax Token Plan",
  "provider": "minimax",
  "enabled": true,
  "refresh": { "mode": "interval", "minutes": 5 },
  "auth": { "apiKey": "token-plan-key-xxx" }
}
```

模板（balance）：同上，`"kind": "balance"`，`auth.apiKey` 填 `sk-api-` 开头的 key，加 `"currency": "RMB"`。

### custom-usage / custom-balance（其他有 API 的厂商自配）

任何「一个 GET 请求 + JSON 响应」的厂商都能接入：

- `auth.baseUrl`：完整查询 URL（必填）
- `auth.apiKey`：自动带 `Authorization: Bearer {apiKey}` 头（可选）
- `auth.method` / `auth.headers`：覆盖请求方法、追加自定义请求头（可选）
- custom-balance 用 `auth.balancePath` 指定余额数字的 JSON 路径（`.` 分隔）
- custom-usage 用 `auth.paths` 指定各周期百分比的路径，缺省的周期不显示

示例（custom-balance）：

```json
{
  "kind": "balance",
  "name": "某厂商",
  "provider": "custom-balance",
  "enabled": true,
  "refresh": { "mode": "manual", "minutes": 5 },
  "auth": {
    "baseUrl": "https://api.example.com/v1/balance",
    "apiKey": "key-xxx",
    "balancePath": "data.available_balance"
  },
  "currency": "USD"
}
```

示例（custom-usage）：`auth.paths` 形如 `{"fiveHours": "data.usage.5h_percent", "week": "data.usage.week_percent"}`。

## 常见操作菜谱

- **同厂商第二个账号**：复制该厂商的记录，改 `name` 和 `auth.apiKey`（或 AK/SK），生成新的 `id`，`createdAt`/`updatedAt` 填当前毫秒时间戳。
- **改刷新规则**：`refresh.mode` 为 `"manual"`（手动）或 `"interval"`，`minutes` 取 `1/5/10/30`。手动模式下卡片上有刷新按钮；interval 模式按钮自动隐藏。
- **配三档预警**：设置面板 → 预警（全局默认），或在监控项表单里勾选「为此监控项单独设置预警」做单项覆盖。`alert.mode` 为 `dot`（色球）或 `image`（图案）；用量分界 `threshold1`/`threshold2` 是百分比（0<t1<t2<100）；余额分界 `balanceThreshold1`/`balanceThreshold2` 是金额（bt1>bt2≥0，余额越高越安全，余额卡右侧显示色球）；`alert.colors.safe/warning/danger` 为三个十六进制颜色；`alert.images.safe/warning/danger` 为三张本地图片路径（静态图或 gif，图案模式下每个圆环按自身百分比落档换图）。monitors.json 里给某条 monitor 加同名 `alert` 对象即覆盖（只需写要改的字段，其余回落全局）；删除该键即恢复跟随全局。
- **切英文界面**：设置面板 → 语言 → English（或 config.json 里 `"locale": "en"`）。

## 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| balance 卡报 401/403 | apiKey 错误或无权限 | 重新生成 key 填入 |
| 火山方舟报签名错误/403 | AK/SK 错误或缺 billing 权限 | 核对 AK/SK，到 IAM 确认 QueryBalanceAcct 权限 |
| 官网同步型报「登录已过期」 | 官网登录态失效 | 设置里重新点「官网同步登录」 |
| MiniMax 报「错误 1004」 | key 错误或未开通对应产品 | 核对 key；注意用量监控用 Token Plan key、余额监控用 sk-api- 开头的 key |
| MiniMax 报「错误 1008」 | 账户余额不足 | 这是账户状态提示，非配置错误 |
| 报「未配置查询地址」 | custom-* 缺 baseUrl | 补 auth.baseUrl |
| 报「未能从响应解析」 | JSON 路径写错 | 核对接口实际响应，修正 balancePath/paths |
| 改了 monitors.json 不生效 | 无热重载 | 重启应用 |

## 边界声明

- **不要替用户编造或猜测 apiKey/AK/SK**；没有凭证就引导用户去对应平台创建，或改用官网同步。
- 直接编辑 monitors.json 前**先备份**原文件；编辑后校验 JSON 合法并提醒用户重启应用。
- 用户的 apiKey、AK/SK、登录 cookie 都属于敏感信息：**不要**把它们打印到公开输出、提交到 git、或上传到任何第三方服务；monitors.json 只存在本机 userData 目录。
- 厂商 id 只有这 7 个可用：`opencode-go` / `deepseek` / `kimi` / `minimax` / `volcengine` / `custom-usage` / `custom-balance`，其他值会导致「未知适配器」错误。
