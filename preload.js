const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 窗口控制
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  setOpacity: (opacity) => ipcRenderer.invoke('set-opacity', opacity),
  getOpacity: () => ipcRenderer.invoke('get-opacity'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  setLayoutSize: (payload) => ipcRenderer.invoke('window:set-layout-size', payload),

  // config
  getConfig: () => ipcRenderer.invoke('config:get'),
  patchConfig: (patch) => ipcRenderer.invoke('config:patch', patch),

  // monitors CRUD
  listMonitors: () => ipcRenderer.invoke('monitors:list'),
  listProviders: () => ipcRenderer.invoke('monitors:providers'),
  addMonitor: (data) => ipcRenderer.invoke('monitors:add', data),
  updateMonitor: (id, patch) => ipcRenderer.invoke('monitors:update', id, patch),
  removeMonitor: (id) => ipcRenderer.invoke('monitors:remove', id),
  reorderMonitors: (ids) => ipcRenderer.invoke('monitors:reorder', ids),

  // 取数
  refreshMonitor: (id) => ipcRenderer.invoke('monitor:refresh', id),
  getMonitor: (id) => ipcRenderer.invoke('monitor:get', id),

  // 打开官网（系统浏览器）
  openSite: (url) => ipcRenderer.invoke('open-site', url),

  // 官网同步（按 provider 隔离）
  websyncLogin: (provider) => ipcRenderer.invoke('websync:login', provider),
  websyncClear: (provider) => ipcRenderer.invoke('websync:clear', provider),
  websyncHasAuth: (provider) => ipcRenderer.invoke('websync:has-auth', provider),

  // 文件选择
  pickImage: () => ipcRenderer.invoke('dialog:pick-image'),

  // 推送
  onMonitorData: (callback) => {
    ipcRenderer.on('monitor:data', (_event, payload) => callback(payload));
  },
  onInitState: (callback) => {
    ipcRenderer.on('init-state', (_event, state) => callback(state));
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
