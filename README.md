# VigilAI

大模型订阅用量 / 余额桌面悬浮监控。Electron 28 + 原生 JS/CSS，透明毛玻璃悬浮窗，黑白灰主题，仅 Windows。

灵感与原型来自 [Yotsuki2213/OpenCode-Glance](https://github.com/Yotsuki2213/OpenCode-Glance)——一个面向 opencode TUI 的桌面悬浮指令面板，其中包含 OpenCode Go 用量圆盘。本项目取其用量圆盘与透明悬浮窗机制，在此基础上扩展为多厂商、多账号的用量 / 余额监控。

## 功能

- 透明无边框悬浮窗：置顶切换、CSS 透明度调节、位置记忆、全局紧凑模式、全局快捷键 `Ctrl+Shift+U` 显隐
- 订阅用量圆盘：五小时/本周/本月三圆环（按厂商实际返回的周期渲染），环中心百分比
- 余额卡片：自定义名 + 余额（¥/$）+ 刷新时间
- 卡片头部：自定义名称、上次刷新时间、手动刷新按钮（自动刷新时隐藏）
- 刷新规则：手动 / 每 1/5/10/30 分钟
- 多厂商、同厂商多账号并存
- 两种取数方式：标准 API（apiKey / 火山 AK/SK 签名）+ 官网同步（登录窗口 + 页面抓取）
- 三档预警：色球（颜色/分界自定义）或自定义图案（静态图/gif，每档一张）
- 外观自定义：边框粗细、透明度、背景色、圆盘底色/已用色、字体颜色/字号
- i18n：中文 / English 即时切换
- 已适配厂商：OpenCode Go（用量）、DeepSeek（余额）、Kimi（余额）、MiniMax（用量/余额，官方 API）、火山方舟（余额），另支持 custom-usage / custom-balance 通用自配
- 面向 agent 的配置说明：见 [skill/SKILL.md](skill/SKILL.md)

## 下载使用（普通用户）

- 到本仓库 **Releases** 页面下载最新版便携版 exe（文件名形如 `VigilAI 便携版 exe`），双击即可运行，无需安装 Node.js。
- 配置（监控项、外观、预警、语言等）都在应用内 ⚙ 设置面板完成；数据保存在 `%APPDATA%\VigilAI\`（`config.json` / `monitors.json`）。
- 需要修改或排查厂商配置时，可以让 agent 参考 [skill/SKILL.md](skill/SKILL.md)。

## 从源码运行（开发者）

```bash
git clone <仓库地址>
cd PlanUsage
npm install    # .npmrc 已配 npmmirror 镜像与 electron 镜像
npm start      # 启动应用
```

## 测试与打包

```bash
npm test       # 纯 node 测试（config / 适配器解析 / 签名 / 调度器 / i18n）
npm run build          # electron-builder 打包（nsis + portable）
npm run build:portable # 仅 portable 打包
```

## 目录结构

```
main.js / preload.js     入口与 contextBridge
src/main/                主进程：window/config/monitor/ipc/shortcuts
src/main/adapters/       厂商适配器（API / 火山签名 / 官网同步 web-sync）
src/renderer/            渲染层（ESM 无框架）：卡片、设置面板、i18n
src/index.html style.css 界面与主题
skill/SKILL.md           面向 agent 的厂商配置说明
test/run-tests.js        纯 node 测试
ARCHITECTURE.md          架构设计与配置 schema
```

## 架构要点

详见 [ARCHITECTURE.md](ARCHITECTURE.md)。要点：主进程 CommonJS、渲染进程 ESM；config.js / monitor.js / 适配器解析函数均不依赖 electron，可在纯 node 下测试；官网同步类适配器共用 `web-sync` 引擎，凭证按厂商隔离存储（safeStorage 加密）。

## 灵感来源

本项目最初灵感来自 [Yotsuki2213/OpenCode-Glance](https://github.com/Yotsuki2213/OpenCode-Glance)。它原本是一个 opencode TUI 桌面悬浮指令面板，附带 OpenCode Go 用量圆盘（支持官网同步与本地估算双数据源）；本项目沿袭了其中的用量圆盘与透明悬浮窗机制，并扩展为多厂商、多账号的订阅用量与余额监控。
