// 验证"打开官网"UI：卡片 .card-site 按钮渲染（预设厂商回落 meta、custom 用 auth.siteUrl、无 siteUrl 不显示）+ 设置表单 siteUrl 字段。
// 用法：node_modules/.bin/electron test/verify-site-button.js
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'planusage-verify-'));
app.setPath('userData', DIR);

const { initConfig, addMonitor } = require('../src/main/config');
const { createWindow, getMainWindow } = require('../src/main/window');
const { setupIPC } = require('../src/main/ipc');
const monitor = require('../src/main/monitor');
const adapters = require('../src/main/adapters');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'ok' : 'FAIL'} - ${name}`);
  if (!cond) failures++;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  initConfig(DIR);
  const m1 = addMonitor({ kind: 'balance', name: 'DS', provider: 'deepseek', refresh: { mode: 'manual' } });
  const m2 = addMonitor({
    kind: 'balance', name: 'relay', provider: 'custom-balance', refresh: { mode: 'manual' },
    auth: { apiKey: 'k', baseUrl: 'https://api.example.com/v1/usage', siteUrl: 'https://console.example.com' },
  });
  const m3 = addMonitor({ kind: 'balance', name: 'relay2', provider: 'custom-balance', refresh: { mode: 'manual' } });

  monitor.initMonitor({ adapters, ctx: { app }, broadcast: () => {} });
  createWindow();
  setupIPC();

  const win = getMainWindow();
  win.webContents.on('did-finish-load', async () => {
    try {
      // 等卡片渲染（异步 getConfig → listProviders → listMonitors → getMonitor）
      let n = 0;
      for (let i = 0; i < 20 && n < 3; i++) {
        await wait(300);
        n = await win.webContents.executeJavaScript(`document.querySelectorAll('.card').length`);
      }
      check('3 张卡片已渲染', n === 3);

      // m1(deepseek 回落 meta)、m2(auth.siteUrl) 有按钮；m3 无 → 2 个
      const btns = await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.card-site')].map(b => ({ title: b.title, text: b.textContent }))`
      );
      check('.card-site 按钮数量 = 2', btns.length === 2);

      // 打开设置 → 编辑 m2 → siteUrl 输入框带值
      await win.webContents.executeJavaScript(`document.querySelector('#btn-settings').click()`);
      await wait(400);
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find(b => (b.textContent === '编辑' || b.textContent === 'Edit') && b.closest('[data-id]') && b.closest('[data-id]').dataset.id === '${m2.id}').click()`
      );
      await wait(400);
      const siteInput = await win.webContents.executeJavaScript(
        `(() => { const i = document.querySelector('input[data-field="siteUrl"]'); return i ? { v: i.value } : null; })()`
      );
      check('编辑表单有 siteUrl 输入框', !!siteInput);
      check('siteUrl 输入框带已有值', !!siteInput && siteInput.v === 'https://console.example.com');

      console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
      app.exit(failures === 0 ? 0 : 1);
    } catch (e) {
      console.log('VERIFY FAIL:', e.message);
      app.exit(1);
    }
  });
});

setTimeout(() => { console.log('VERIFY TIMEOUT'); app.exit(1); }, 25000);
