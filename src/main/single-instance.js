const net = require('net');
const crypto = require('crypto');

// Windows 命名管道单实例互斥。
// 背景：Electron 28 在 Windows 上存在已知问题（electron/electron#35680），
// 第二个实例调用 app.requestSingleInstanceLock() 也可能返回 true，导致能再开一个窗口。
// 这里用“userData 目录哈希”作为管道名，同一用户数据目录只允许一个实例成为主实例；
// 后启动的实例连接管道成功后发送 FOCUS，然后退出。
function pipePathFor(userData) {
  const hash = crypto.createHash('sha1').update(userData).digest('hex').slice(0, 16);
  return '\\\\.\\pipe\\vigilai-' + hash;
}

/**
 * 尝试成为唯一主实例。
 * @param {Electron.App} app
 * @param {Function} onFocusRequest 已有实例收到“唤醒窗口”请求时回调
 * @returns {Promise<{primary: boolean, close: Function}>}
 */
function acquireSingleInstance(app, onFocusRequest) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ primary: true, close: () => {} });
      return;
    }

    const pipePath = pipePathFor(app.getPath('userData'));
    let done = false;

    const finish = (primary, server) => {
      if (done) return;
      done = true;
      resolve(
        primary
          ? { primary: true, close: () => { if (server) server.close(); } }
          : { primary: false, close: () => {} }
      );
    };

    // 先尝试连接：如果已有主实例在监听，说明自己是后来者。
    const client = net.connect({ path: pipePath });
    client.once('connect', () => {
      try {
        client.write('FOCUS\n');
      } catch (e) { /* 忽略 */ }
      client.end();
      finish(false);
    });

    client.once('error', () => {
      // 没有主实例在监听，尝试自己成为主实例。
      const server = net.createServer((sock) => {
        sock.once('data', () => {
          try {
            onFocusRequest();
          } catch (e) { /* 忽略 */ }
        });
        sock.end();
      });

      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          // 竞态：另一实例刚成为主实例，连接它并退出。
          const retry = net.connect({ path: pipePath });
          retry.once('connect', () => {
            try {
              retry.write('FOCUS\n');
            } catch (e) { /* 忽略 */ }
            retry.end();
            finish(false);
          });
          retry.once('error', () => finish(false));
        } else {
          finish(false);
        }
      });

      server.once('listening', () => finish(true, server));
      server.listen(pipePath);
    });
  });
}

module.exports = { acquireSingleInstance };
