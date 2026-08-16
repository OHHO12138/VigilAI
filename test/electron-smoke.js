// 冒烟测试：独立 userData，注入假监控项和假数据，截图验证渲染。
// 用法：node_modules/.bin/electron test/electron-smoke.js
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SMOKE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'planusage-smoke-'));
app.setPath('userData', SMOKE_DIR);

const { initConfig, addMonitor, patchConfig } = require('../src/main/config');
const { createWindow, getMainWindow } = require('../src/main/window');
const { setupIPC } = require('../src/main/ipc');
const monitor = require('../src/main/monitor');
const adapters = require('../src/main/adapters');

app.whenReady().then(async () => {
  initConfig(SMOKE_DIR);

  // 种子数据：一个 usage（三档全有）+ 一个 usage（缺 month）+ 一个 balance
  const m1 = addMonitor({
    kind: 'usage', name: 'OpenCode Go 主号', provider: 'opencode-go',
    refresh: { mode: 'manual' },
  });
  const m2 = addMonitor({
    kind: 'usage', name: 'MiniMax Coding', provider: 'minimax',
    refresh: { mode: 'interval', minutes: 5 },
  });
  const m3 = addMonitor({
    kind: 'balance', name: 'DeepSeek 余额', provider: 'deepseek',
    refresh: { mode: 'manual' }, currency: 'RMB',
    auth: { apiKey: 'fake-key-for-smoke' },
  });
  // 低余额 → 危险色球
  const m4 = addMonitor({
    kind: 'balance', name: 'Kimi 余额（低）', provider: 'kimi',
    refresh: { mode: 'manual' }, currency: 'RMB',
    auth: { apiKey: 'fake-key-for-smoke' },
  });

  // m1 加单监控预警覆盖：阈值收紧到 30/60（全局 50/85）
  const { updateMonitor } = require('../src/main/config');
  updateMonitor(m1.id, { alert: { threshold1: 30, threshold2: 60, colors: { safe: '#7ed6a5', warning: '#e6c860', danger: '#e06c75' } } });

  monitor.initMonitor({
    adapters,
    ctx: { app, safeStorage },
    broadcast: (payload) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('monitor:data', payload);
    },
  });

  createWindow();
  setupIPC();

  const win = getMainWindow();
  win.webContents.on('did-finish-load', () => {
    // 模拟适配器返回的数据推送
    const now = Date.now();
    const push = (payload) => win.webContents.send('monitor:data', payload);
    setTimeout(() => {
      push({ id: m1.id, ok: true, updatedAt: now, data: { periods: {
        fiveHours: { percent: 32 }, week: { percent: 61.5 }, month: { percent: 92.3 },
      } } });
      push({ id: m2.id, ok: true, updatedAt: now, data: { periods: {
        fiveHours: { percent: 88 }, week: { percent: 45 },
      } } });
      push({ id: m3.id, ok: true, updatedAt: now, data: { balance: 110.5, currency: 'CNY' } });
      push({ id: m4.id, ok: true, updatedAt: now, data: { balance: 15.2, currency: 'CNY' } });
    }, 800);

    // 截屏流程：dot → image → settings → edit → 粗边框
    const shot = (name) => win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SMOKE_DIR, name), img.toPNG()));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const sendConfig = () => win.webContents.send('init-state', { config: require('../src/main/config').getConfig() });

    setTimeout(async () => {
      try {
        await wait(800);
        await shot('shot-dot.png');

        // 图片预警模式
        const gifDir = path.resolve(__dirname, '../../动图示例');
        patchConfig({ alert: { mode: 'image', images: {
          safe: path.join(gifDir, '正常.gif'), warning: path.join(gifDir, '注意.gif'), danger: path.join(gifDir, '危险.gif'),
        } } });
        sendConfig();
        push({ id: m1.id, ok: true, updatedAt: now, data: { periods: { fiveHours: { percent: 32 }, week: { percent: 61.5 }, month: { percent: 92.3 } } } });
        await wait(800);
        await shot('shot-image.png');
        patchConfig({ alert: { mode: 'dot' } });
        sendConfig();

        // 设置面板
        await win.webContents.executeJavaScript(`document.querySelector('#btn-settings').click()`);
        await wait(600);
        await shot('shot-settings.png');

        // 编辑表单（第一个监控项）
        await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b => b.textContent === '编辑' || b.textContent === 'Edit').click()`);
        await wait(600);
        await shot('shot-edit.png');

        // 16px 粗边框 + 圆角验证（关掉设置面板）
        await win.webContents.executeJavaScript(`document.querySelector('.settings-header .title-btn-close').click()`);
        patchConfig({ appearance: { borderWidth: 16 } });
        sendConfig();
        await wait(500);
        await shot('shot-border.png');

        console.log('SMOKE_DIR=' + SMOKE_DIR);
        app.exit(0);
      } catch (e) {
        console.log('SMOKE FAIL:', e.message);
        app.exit(1);
      }
    }, 1200);
  });
});

setTimeout(() => { console.log('SMOKE TIMEOUT'); app.exit(1); }, 25000);
