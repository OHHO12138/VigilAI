const { BrowserWindow } = require('electron');
const path = require('path');
const config = require('./config');

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
}

function createWindow() {
  const cfg = config.getConfig();

  mainWindow = new BrowserWindow({
    width: cfg.width || 420,
    height: cfg.height || 580,
    minWidth: 260,
    minHeight: 300,
    x: typeof cfg.x === 'number' ? cfg.x : undefined,
    y: typeof cfg.y === 'number' ? cfg.y : undefined,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    transparent: true,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: cfg.alwaysOnTop,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('init-state', {
      config: config.getConfig(),
      monitors: config.listMonitors(),
    });
  });

  // 位置记忆：close/resize/move 持久化 bounds
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      config.patchConfig(mainWindow.getBounds());
    }
  };
  mainWindow.on('close', saveBounds);
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

module.exports = {
  createWindow,
  getMainWindow,
};
