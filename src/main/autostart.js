// 开机自启：注册稳定可执行路径，并清理历史遗留的错误注册表项。
// 背景：setLoginItemSettings 默认用 process.execPath——
//  - 便携版（electron-builder portable）：每次启动解压到临时目录，注册的临时路径重启后失效；
//  - 开发模式（electron .）：注册的是 electron.exe 且不带应用目录参数，开机启动的是裸 Electron。
const { execFileSync } = require('child_process');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

// 历史遗留的错误自启键：
//  - electron.app.Electron：未设置 AppUserModelID 时的旧键名（便携版曾注册临时解压路径）
//  - com.vigilai.app：设置 AppUserModelID 后 Electron 使用的键名（开发模式曾注册裸 electron.exe）
const LEGACY_RUN_VALUES = ['electron.app.Electron', 'com.vigilai.app'];

function deleteRunValue(name) {
  try {
    execFileSync('reg', ['delete', RUN_KEY, '/v', name, '/f'], { stdio: 'ignore' });
  } catch {
    // 键不存在等场景忽略
  }
}

// 自启目标：
//  便携版 → PORTABLE_EXECUTABLE_FILE（electron-builder 注入的稳定 exe 路径）
//  开发模式 → electron.exe + 应用目录参数
//  安装版   → process.execPath
function autoStartTarget(app) {
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return { path: process.env.PORTABLE_EXECUTABLE_FILE, args: [] };
  }
  if (!app.isPackaged) {
    return { path: process.execPath, args: [app.getAppPath()] };
  }
  return { path: process.execPath, args: [] };
}

// 应用启动时同步：先清掉历史错误项，再按配置重写（幂等）
function syncAutoStart(app, enabled) {
  for (const name of LEGACY_RUN_VALUES) deleteRunValue(name);
  if (!enabled) return;
  const target = autoStartTarget(app);
  app.setLoginItemSettings({ openAtLogin: true, path: target.path, args: target.args });
}

// 设置面板切换时调用
function setAutoStart(app, enabled) {
  syncAutoStart(app, enabled);
}

module.exports = { syncAutoStart, setAutoStart, autoStartTarget, deleteRunValue };
