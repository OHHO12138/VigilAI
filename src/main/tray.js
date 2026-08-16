// 系统托盘（右下角小工作台）：左键单击切换悬浮窗显隐，右键菜单提供显示/隐藏与退出。
const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { getMainWindow } = require('./window');

let tray = null;

function toggleWindow() {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('VigilAI');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 / 隐藏', click: toggleWindow },
      { type: 'separator' },
      { label: '退出 VigilAI', click: () => app.quit() },
    ])
  );
  // Windows：左键单击切换悬浮窗显隐
  tray.on('click', toggleWindow);
  return tray;
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

module.exports = { createTray, destroyTray, toggleWindow };
