const { app, globalShortcut, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { initConfig } = require('./src/main/config');
const { createWindow, getMainWindow } = require('./src/main/window');
const { setupIPC } = require('./src/main/ipc');
const { registerShortcuts, unregisterShortcuts } = require('./src/main/shortcuts');
const { acquireSingleInstance } = require('./src/main/single-instance');
const { createTray, destroyTray } = require('./src/main/tray');
const monitor = require('./src/main/monitor');
const adapters = require('./src/main/adapters');

// 固定用户数据目录为 %APPDATA%\VigilAI（与产品名一致），不受应用名命名规则影响。
// 旧目录 %APPDATA%\plan-usage 已有数据时，首次启动复制迁移，避免配置丢失。
function pinUserData() {
  const appData = app.getPath('appData');
  const newDir = path.join(appData, 'VigilAI');
  const oldDir = path.join(appData, 'plan-usage');
  if (oldDir !== newDir && fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
    try {
      fs.cpSync(oldDir, newDir, { recursive: true });
    } catch (e) {
      console.error('Failed to migrate user data:', e);
    }
  }
  app.setPath('userData', newDir);
}
pinUserData();

let singleInstanceClose = null;
let pendingFocus = false;

function focusMainWindow() {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    // 窗口还没创建（比如第二个实例与首个实例几乎同时启动），先记下，创建后再唤醒。
    pendingFocus = true;
  }
}

// 单实例锁：同一用户数据目录只允许一个实例，后启动的实例直接退出，
// 并把已存在的窗口恢复到前台（包括之前被“隐藏”的窗口）。
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  async function startApp() {
    // Electron 28 在 Windows 上可能对第二个实例也返回 true（#35680），
    // 所以再用命名管道做一次权威判断；拿到主实例身份后才开始启动界面。
    const acquired = await acquireSingleInstance(app, focusMainWindow);
    if (!acquired.primary) {
      app.quit();
      return;
    }
    singleInstanceClose = acquired.close;

    app.whenReady().then(() => {
      initConfig(app.getPath('userData'));

      monitor.initMonitor({
        adapters,
        ctx: { app, safeStorage },
        broadcast: (payload) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('monitor:data', payload);
        },
      });

      createWindow();
      if (pendingFocus) focusMainWindow();
      setupIPC();
      registerShortcuts();
      createTray();
      monitor.startAll();
    });
  }

  startApp();

  app.on('window-all-closed', () => {
    unregisterShortcuts();
    monitor.stopAll();
    app.quit();
  });

  app.on('will-quit', () => {
    if (singleInstanceClose) singleInstanceClose();
    globalShortcut.unregisterAll();
    destroyTray();
    monitor.stopAll();
  });
}
