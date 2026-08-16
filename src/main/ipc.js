const { ipcMain, dialog, screen, shell } = require('electron');
const config = require('./config');
const monitor = require('./monitor');
const adapters = require('./adapters');
const { getMainWindow } = require('./window');

function setupIPC() {
  // ---- 窗口控制 ----
  ipcMain.handle('toggle-always-on-top', () => {
    const value = !config.getConfig().alwaysOnTop;
    config.patchConfig({ alwaysOnTop: value });
    const win = getMainWindow();
    if (win) win.setAlwaysOnTop(value);
    return value;
  });

  ipcMain.handle('get-always-on-top', () => config.getConfig().alwaysOnTop);

  // 透明度走渲染层 CSS opacity：透明窗口上用 setOpacity 会破坏 per-pixel alpha
  ipcMain.handle('set-opacity', (_event, opacity) => {
    const value = Math.max(0.3, Math.min(1, Number(opacity)));
    config.patchConfig({ opacity: value });
    return value;
  });

  ipcMain.handle('get-opacity', () => config.getConfig().opacity);

  ipcMain.handle('hide-window', () => {
    const win = getMainWindow();
    if (win) win.hide();
  });

  ipcMain.handle('minimize-window', () => {
    const win = getMainWindow();
    if (win) win.minimize();
  });

  ipcMain.handle('get-window-state', () => {
    const win = getMainWindow();
    if (!win) {
      return { isVisible: false, isMinimized: false, isMaximized: false };
    }
    return {
      isVisible: win.isVisible(),
      isMinimized: win.isMinimized(),
      isMaximized: win.isMaximized(),
    };
  });

  // 横排/竖排切换：按内容尺寸调整窗口，并同步 layoutMode（横向尺寸不覆盖 width/height 记忆）
  ipcMain.handle('window:set-layout-size', (_event, { width, height, minWidth, minHeight, mode } = {}) => {
    const win = getMainWindow();
    if (!win) return null;
    const mw = Math.max(1, Math.round(Number(minWidth) || 260));
    const mh = Math.max(1, Math.round(Number(minHeight) || 300));
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const w = Math.min(Math.max(mw, Math.round(Number(width) || mw)), Math.max(mw, area.width - 20));
    const h = Math.min(Math.max(mh, Math.round(Number(height) || mh)), Math.max(mh, area.height - 20));
    if (mode === 'horizontal' || mode === 'vertical') config.patchConfig({ layoutMode: mode });
    win.setMinimumSize(mw, mh);
    win.setSize(w, h);
    return { width: w, height: h, minWidth: mw, minHeight: mh };
  });

  // ---- config ----
  ipcMain.handle('config:get', () => config.getConfig());

  ipcMain.handle('config:patch', (_event, patch) => config.patchConfig(patch || {}));

  // ---- monitors CRUD ----
  ipcMain.handle('monitors:list', () => config.listMonitors());

  ipcMain.handle('monitors:providers', () => adapters.listProviderMeta());

  ipcMain.handle('monitors:add', (_event, data) => {
    const m = config.addMonitor(data || {});
    monitor.rescheduleAll();
    return m;
  });

  ipcMain.handle('monitors:update', (_event, id, patch) => {
    const m = config.updateMonitor(id, patch || {});
    monitor.rescheduleAll();
    return m;
  });

  ipcMain.handle('monitors:remove', (_event, id) => {
    const ok = config.removeMonitor(id);
    monitor.rescheduleAll();
    return ok;
  });

  ipcMain.handle('monitors:reorder', (_event, ids) => {
    const reordered = config.reorderMonitors(ids);
    return reordered || config.listMonitors();
  });

  // ---- 取数 ----
  ipcMain.handle('monitor:refresh', (_event, id) => monitor.refreshMonitor(id, { force: true }));

  ipcMain.handle('monitor:get', (_event, id) => monitor.getCached(id));

  // ---- 官网同步（按 provider 隔离） ----
  ipcMain.handle('websync:login', async (_event, provider) => {
    const adapter = adapters.getAdapter(provider);
    if (!adapter || typeof adapter.login !== 'function') {
      return { success: false, error: `该厂商不支持官网同步：${provider}` };
    }
    try {
      const result = await adapter.login();
      return { success: true, capture: result.capture };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('websync:clear', (_event, provider) => {
    const adapter = adapters.getAdapter(provider);
    if (adapter && typeof adapter.clearAuth === 'function') adapter.clearAuth();
    return true;
  });

  ipcMain.handle('websync:has-auth', (_event, provider) => {
    const adapter = adapters.getAdapter(provider);
    return !!(adapter && typeof adapter.hasAuth === 'function' && adapter.hasAuth());
  });

  // ---- 打开官网（卡片"打开官网"按钮） ----
  ipcMain.handle('open-site', (_event, url) => {
    if (typeof url !== 'string' || !url.trim()) return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    shell.openExternal(parsed.toString());
    return true;
  });

  // ---- 文件选择 ----
  ipcMain.handle('dialog:pick-image', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      title: '选择图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
}

module.exports = { setupIPC };
