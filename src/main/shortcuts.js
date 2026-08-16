const { globalShortcut } = require('electron');
const { getMainWindow } = require('./window');

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+U', () => {
    const win = getMainWindow();
    if (!win) return;

    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

module.exports = { registerShortcuts, unregisterShortcuts };
